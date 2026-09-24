import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { GET, PUT } from "@/app/api/members/[userId]/client-access/route"
import { PUT as PUT_LOCATION_MEMBERS } from "@/app/api/location-members/route"
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
const TARGET = "00000000-0000-4000-8000-0000000000b1"
const CROWN = "00000000-0000-4000-8000-00000000c001"
const BELL = "00000000-0000-4000-8000-00000000c002"

const admin: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: ORG,
  organisationName: "Agency",
  displayName: "Ada",
  email: "ada@example.test",
  role: "admin",
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

type Grant = {
  locationId: string
  clientId: string | null
  canPublish: boolean
}

/**
 * A fake tenant `sql`: answers the member, grant and catalogue reads by the
 * text of the query, and records every write. `sql(rows)` (the bulk-insert
 * helper) returns the rows so the insert can be inspected.
 */
function fakeTenant(state: { role: string | null; grants: Grant[] }) {
  const writes: { text: string; values: unknown[] }[] = []
  const sql = vi.fn((first: unknown, ...values: unknown[]) => {
    if (!Array.isArray(first) || !("raw" in first)) {
      return { helperRows: first }
    }
    const text = (first as unknown as string[]).join("?")
    if (text.includes("from member where user_id")) {
      return Promise.resolve(state.role ? [{ role: state.role }] : [])
    }
    if (
      text.includes("from location_member lm") &&
      text.includes("join location l")
    ) {
      return Promise.resolve(state.grants)
    }
    if (text.includes("from client c")) {
      return Promise.resolve([
        {
          clientId: CROWN,
          name: "Old Crown",
          archived: false,
          listingIds: ["l1", "l2", "l3"],
        },
        {
          clientId: BELL,
          name: "The Bell",
          archived: false,
          listingIds: ["l6"],
        },
      ])
    }
    if (text.includes("where client_id is null")) {
      return Promise.resolve([{ listingIds: ["u1"] }])
    }
    if (text.includes("delete from location_member")) {
      writes.push({ text, values })
      state.grants = []
      return Promise.resolve([])
    }
    if (text.includes("insert into location_member")) {
      writes.push({ text, values })
      const rows = (values[0] as { helperRows: Record<string, unknown>[] })
        .helperRows
      state.grants = rows.map((row) => ({
        locationId: row.location_id as string,
        clientId: String(row.location_id).startsWith("l6") ? BELL : CROWN,
        canPublish: row.can_publish as boolean,
      }))
      return Promise.resolve([])
    }
    return Promise.resolve([])
  })
  vi.mocked(withTenant).mockImplementation(async (_org, fn) => fn(sql as never))
  return { writes, state }
}

function url() {
  return `http://localhost/api/members/${TARGET}/client-access`
}

function put(body: object) {
  return PUT(
    new Request(url(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId: TARGET }) }
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

describe("GET /api/members/[userId]/client-access", () => {
  it("returns per-client totals and grants, unfiled listings as their own group", async () => {
    signedIn(admin)
    fakeTenant({
      role: "member",
      grants: [
        { locationId: "l1", clientId: CROWN, canPublish: true },
        { locationId: "l2", clientId: CROWN, canPublish: false },
      ],
    })
    const response = await GET(new Request(url()), {
      params: Promise.resolve({ userId: TARGET }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      userId: TARGET,
      role: "member",
      allClients: false,
      clients: [
        {
          clientId: CROWN,
          name: "Old Crown",
          archived: false,
          total: 3,
          granted: 2,
          publishing: "some",
        },
        {
          clientId: BELL,
          name: "The Bell",
          archived: false,
          total: 1,
          granted: 0,
          publishing: "none",
        },
        {
          clientId: "unfiled",
          name: "Unfiled listings",
          archived: false,
          total: 1,
          granted: 0,
          publishing: "none",
        },
      ],
    })
  })

  it("refuses a member", async () => {
    signedIn({ ...admin, role: "member" })
    const response = await GET(new Request(url()), {
      params: Promise.resolve({ userId: TARGET }),
    })
    expect(response.status).toBe(403)
    expect(vi.mocked(withTenant)).not.toHaveBeenCalled()
  })
})

describe("PUT /api/members/[userId]/client-access", () => {
  it("replaces the rows with exactly the chosen clients' listings and audits it", async () => {
    signedIn(admin)
    const { writes } = fakeTenant({
      role: "member",
      grants: [{ locationId: "l6", clientId: BELL, canPublish: false }],
    })
    const response = await put({
      clients: [{ clientId: CROWN, canPublish: true }],
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.allClients).toBe(false)
    expect(body.clients[0]).toMatchObject({
      clientId: CROWN,
      granted: 3,
      publishing: "all",
    })

    expect(
      writes.map((write) =>
        write.text.trim().split(/\s+/).slice(0, 3).join(" ")
      )
    ).toEqual(["delete from location_member", "insert into location_member"])
    const inserted = (writes[1].values[0] as { helperRows: unknown[] })
      .helperRows
    expect(inserted).toEqual(
      ["l1", "l2", "l3"].map((locationId) => ({
        organisation_id: ORG,
        location_id: locationId,
        user_id: TARGET,
        can_publish: true,
      }))
    )
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "member.client_access_changed",
        subjectId: TARGET,
        metadata: expect.objectContaining({
          before: {
            allClients: false,
            grants: [{ locationId: "l6", canPublish: false }],
          },
          after: expect.objectContaining({ allClients: false }),
        }),
      })
    )
  })

  it("refuses an empty client list: zero rows would mean every client", async () => {
    signedIn(admin)
    const { writes } = fakeTenant({
      role: "member",
      grants: [{ locationId: "l6", clientId: BELL, canPublish: false }],
    })
    const response = await put({ clients: [] })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(
      "would_widen_to_all_clients"
    )
    expect(writes).toHaveLength(0)
    expect(vi.mocked(writeAudit)).not.toHaveBeenCalled()
  })

  it("clears every row only when allClients: true is sent", async () => {
    signedIn(admin)
    const { writes } = fakeTenant({
      role: "viewer",
      grants: [{ locationId: "l6", clientId: BELL, canPublish: false }],
    })
    const response = await put({ allClients: true })
    expect(response.status).toBe(200)
    expect((await response.json()).allClients).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0].text).toContain("delete from location_member")
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          after: { allClients: true, grants: [] },
        }),
      })
    )
  })

  it("refuses to scope an owner or admin", async () => {
    signedIn(admin)
    const { writes } = fakeTenant({ role: "admin", grants: [] })
    const response = await put({ clients: [{ clientId: CROWN }] })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("role_sees_all_clients")
    expect(writes).toHaveLength(0)
  })

  it("refuses a client outside the organisation", async () => {
    signedIn(admin)
    fakeTenant({ role: "member", grants: [] })
    const response = await put({
      clients: [{ clientId: "00000000-0000-4000-8000-0000000000ff" }],
    })
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe("client_not_found")
  })

  it("404s an unknown member", async () => {
    signedIn(admin)
    fakeTenant({ role: null, grants: [] })
    const response = await put({ allClients: true })
    expect(response.status).toBe(404)
  })

  it("refuses a member actor", async () => {
    signedIn({ ...admin, role: "member" })
    const response = await put({ allClients: true })
    expect(response.status).toBe(403)
    expect(vi.mocked(withTenant)).not.toHaveBeenCalled()
  })

  it("refuses an ambiguous body", async () => {
    signedIn(admin)
    fakeTenant({ role: "member", grants: [] })
    const response = await put({ allClients: false })
    expect(response.status).toBe(400)
  })
})

describe("PUT /api/location-members zero-rows guard", () => {
  function putLegacy(body: object) {
    return PUT_LOCATION_MEMBERS(
      new Request("http://localhost/api/location-members", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) }
    )
  }

  it("refuses clearing every assignment without allClients: true", async () => {
    signedIn(admin)
    const { writes } = fakeTenant({ role: "member", grants: [] })
    const response = await putLegacy({ userId: TARGET, assignments: [] })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe(
      "would_widen_to_all_clients"
    )
    expect(writes).toHaveLength(0)
  })

  it("clears them when allClients: true says so", async () => {
    signedIn(admin)
    const { writes } = fakeTenant({ role: "member", grants: [] })
    const response = await putLegacy({
      userId: TARGET,
      assignments: [],
      allClients: true,
    })
    expect(response.status).toBe(200)
    expect(writes[0].text).toContain("delete from location_member")
  })
})
