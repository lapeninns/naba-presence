import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "@/app/api/invitations/[token]/route"
import { invitationLookupSchema } from "@/lib/contracts/invitations"
import { takeAbuseBudget } from "@/lib/server/abuse-limits"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { cookies } from "next/headers"

/**
 * GET /api/invitations/[token] is public: anyone holding the token reads it
 * with no session. It answers D8 (organisation, address, role, expiry, state)
 * and nothing else, so this holds the exact key set, field by field.
 */

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/abuse-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/abuse-limits")>()),
  clientIpFromRequest: () => "203.0.113.7",
  takeAbuseBudget: vi.fn(),
}))

const TOKEN = "invite-token-value"
const FUTURE = new Date("2099-10-22T14:05:00.000Z")
const PAST = new Date("2020-01-02T03:04:05.000Z")

const KEYS = [
  "accepted",
  "email",
  "expired",
  "expiresAt",
  "organisationName",
  "role",
]

/**
 * What lookup_invitation() could hand back if it ever widened, plus the
 * invitation table's own columns: none of it may reach the response.
 */
const EXTRA_COLUMNS = {
  id: "00000000-0000-4000-8000-0000000000e1",
  organisationId: "00000000-0000-4000-8000-000000000001",
  token_hash: "deadbeef",
  tokenHash: "deadbeef",
  canPublish: true,
  invitedBy: "00000000-0000-4000-8000-000000000002",
  locationIds: ["00000000-0000-4000-8000-00000000c001"],
  clientIds: ["00000000-0000-4000-8000-00000000c002"],
}

type Row = {
  organisationName: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
  expiresAt: Date
  acceptedAt: Date | null
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    organisationName: "Lapen Inns",
    email: "invited@example.test",
    role: "member",
    expiresAt: FUTURE,
    acceptedAt: null,
    ...overrides,
  }
}

/** A tagged-template stub for the pool: records every statement it is given. */
function fakeDatabase(rows: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = []
  const sql = vi.fn((first: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: first.join("?"), values })
    return Promise.resolve(rows)
  })
  vi.mocked(getDatabase).mockReturnValue(sql as never)
  return { calls, sql }
}

function lookup(token = TOKEN) {
  return GET(new Request(`http://localhost/api/invitations/${token}`), {
    params: Promise.resolve({ token }),
  })
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
})

beforeEach(() => {
  vi.clearAllMocks()
  // No session cookie at all: the route must not need one.
  vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never)
  vi.mocked(takeAbuseBudget).mockResolvedValue(undefined as never)
})

describe("GET /api/invitations/[token]", () => {
  it("answers a live invitation with exactly the six public keys", async () => {
    fakeDatabase([{ ...EXTRA_COLUMNS, ...row({ role: "admin" }) }])
    const response = await lookup()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(KEYS)
    expect(body).toEqual({
      organisationName: "Lapen Inns",
      email: "invited@example.test",
      role: "admin",
      expiresAt: "2099-10-22T14:05:00.000Z",
      accepted: false,
      expired: false,
    })
    for (const leaked of Object.keys(EXTRA_COLUMNS)) {
      expect(body).not.toHaveProperty(leaked)
    }
    expect(JSON.stringify(body)).not.toContain("deadbeef")
  })

  it("returns expiresAt as an ISO 8601 string, not a Date or a number", async () => {
    fakeDatabase([row()])
    const { expiresAt } = await (await lookup()).json()
    expect(typeof expiresAt).toBe("string")
    expect(expiresAt).toBe(FUTURE.toISOString())
    expect(new Date(expiresAt).toISOString()).toBe(expiresAt)
  })

  it.each(["owner", "admin", "member", "viewer"] as const)(
    "returns the %s role as stored and parses with the client schema",
    async (role) => {
      fakeDatabase([row({ role })])
      const body = await (await lookup()).json()
      expect(body.role).toBe(role)
      expect(invitationLookupSchema.parse(body)).toEqual(body)
    }
  )

  it("marks an invitation past its expiry as expired, not accepted", async () => {
    fakeDatabase([row({ expiresAt: PAST })])
    const response = await lookup()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      expired: true,
      accepted: false,
      expiresAt: PAST.toISOString(),
    })
    expect(invitationLookupSchema.safeParse(body).success).toBe(true)
  })

  it("marks an accepted invitation as accepted, and never as expired", async () => {
    // Even past its expiry: an accepted invitation is finished, not lapsed.
    fakeDatabase([row({ acceptedAt: new Date("2026-10-01T00:00:00Z") })])
    const live = await (await lookup()).json()
    expect(live).toMatchObject({ accepted: true, expired: false })

    fakeDatabase([
      row({ acceptedAt: new Date("2026-10-01T00:00:00Z"), expiresAt: PAST }),
    ])
    const lapsed = await (await lookup()).json()
    expect(lapsed).toMatchObject({ accepted: true, expired: false })
    expect(Object.keys(lapsed).sort()).toEqual(KEYS)
  })

  it("answers 404 invitation_not_found for an unknown token", async () => {
    fakeDatabase([])
    const response = await lookup("nope")
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe("invitation_not_found")
    expect(body).not.toHaveProperty("role")
    expect(body).not.toHaveProperty("expiresAt")
  })

  it("is read-only: one select from lookup_invitation with the token's sha256", async () => {
    const { calls } = fakeDatabase([row()])
    await lookup()
    expect(calls).toHaveLength(1)
    const { text, values } = calls[0]!
    expect(text).toMatch(/^\s*select\b/i)
    expect(text).toMatch(/from\s+lookup_invitation\(/i)
    expect(text).not.toMatch(/\b(insert|update|delete|truncate|drop|alter)\b/i)
    // The raw token never reaches the database, only its hash.
    expect(values).toEqual([sha256(TOKEN)])
    expect(values).not.toContain(TOKEN)
  })

  it("needs no session: public, no cookie read, no tenant, limited per IP", async () => {
    const { sql } = fakeDatabase([row()])
    const response = await lookup()
    expect(response.status).toBe(200)
    expect(sql).toHaveBeenCalledTimes(1)
    expect(vi.mocked(cookies)).not.toHaveBeenCalled()
    expect(vi.mocked(takeAbuseBudget)).toHaveBeenCalledWith(
      "invitation_lookup",
      expect.objectContaining({ ip: "203.0.113.7" })
    )
  })
})
