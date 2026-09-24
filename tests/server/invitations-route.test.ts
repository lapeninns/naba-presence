import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/invitations/route"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn() }))

const ORG = "00000000-0000-4000-8000-000000000001"
const CROWN = "00000000-0000-4000-8000-00000000c001"
const EMPTY = "00000000-0000-4000-8000-00000000c003"

const owner: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: ORG,
  organisationName: "Agency",
  displayName: "Ada",
  email: "ada@example.test",
  role: "owner",
  canPublish: true,
}

function signedIn(session: Session) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => session),
  } as never)
}

/** Clients known to the fake tenant, with their listing counts. */
function fakeTenant(clients: { id: string; listings: number; name: string }[]) {
  const inserts: unknown[][] = []
  const sql = Object.assign(
    vi.fn((first: unknown, ...values: unknown[]) => {
      if (!Array.isArray(first) || !("raw" in first)) return first
      const text = (first as unknown as string[]).join("?")
      if (text.includes("from member m")) return Promise.resolve([])
      if (text.includes("count(l.id)")) {
        const wanted = values[0] as string[]
        return Promise.resolve(
          clients
            .filter((client) => wanted.includes(client.id))
            .map(({ id, listings }) => ({ id, listings }))
        )
      }
      if (text.includes("insert into invitation")) {
        inserts.push(values)
        return Promise.resolve([
          {
            id: "00000000-0000-4000-8000-0000000000e1",
            email: "ben@example.test",
            role: "member",
            canPublish: false,
            expiresAt: new Date("2026-10-01T00:00:00Z"),
            createdAt: new Date("2026-09-24T00:00:00Z"),
          },
        ])
      }
      if (text.includes("select id::text as id, name from client")) {
        return Promise.resolve(clients.map(({ id, name }) => ({ id, name })))
      }
      return Promise.resolve([])
    }),
    { array: (values: unknown[]) => ({ array: values }) }
  )
  vi.mocked(withTenant).mockImplementation(async (_org, fn) => fn(sql as never))
  return { inserts }
}

function post(body: object) {
  return POST(
    new Request("http://localhost/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/invitations client scope", () => {
  it("stores the chosen clients and audits them", async () => {
    signedIn(owner)
    const { inserts } = fakeTenant([
      { id: CROWN, listings: 3, name: "Old Crown" },
    ])
    const response = await post({
      email: "ben@example.test",
      role: "member",
      clientIds: [CROWN],
    })
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.invitation.clients).toEqual([{ id: CROWN, name: "Old Crown" }])
    expect(inserts[0]).toContainEqual({ array: [CROWN] })
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "member.invited",
        metadata: expect.objectContaining({ clientIds: [CROWN] }),
      })
    )
  })

  it("stores null (all clients) when no clients are chosen", async () => {
    signedIn(owner)
    const { inserts } = fakeTenant([])
    const response = await post({ email: "ben@example.test", role: "member" })
    expect(response.status).toBe(201)
    expect((await response.json()).invitation.clients).toBeNull()
    expect(inserts[0]).toContain(null)
  })

  it("refuses a scope on an admin invitation", async () => {
    signedIn(owner)
    const { inserts } = fakeTenant([
      { id: CROWN, listings: 3, name: "Old Crown" },
    ])
    const response = await post({
      email: "ben@example.test",
      role: "admin",
      clientIds: [CROWN],
    })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("role_sees_all_clients")
    expect(inserts).toHaveLength(0)
  })

  it("refuses a client that is not in the organisation", async () => {
    signedIn(owner)
    fakeTenant([])
    const response = await post({
      email: "ben@example.test",
      role: "viewer",
      clientIds: [CROWN],
    })
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe("client_not_found")
  })

  it("refuses clients with no listings: accepted, that would mean every client", async () => {
    signedIn(owner)
    const { inserts } = fakeTenant([{ id: EMPTY, listings: 0, name: "New" }])
    const response = await post({
      email: "ben@example.test",
      role: "member",
      clientIds: [EMPTY],
    })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("would_widen_to_all_clients")
    expect(inserts).toHaveLength(0)
  })

  it("refuses an empty client list at the schema", async () => {
    signedIn(owner)
    fakeTenant([])
    const response = await post({
      email: "ben@example.test",
      role: "member",
      clientIds: [],
    })
    expect(response.status).toBe(400)
  })
})
