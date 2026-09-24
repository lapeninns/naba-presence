import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE } from "@/app/api/clients/[clientId]/report-shares/[shareId]/route"
import { GET, POST } from "@/app/api/clients/[clientId]/report-shares/route"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { requireSession } from "@/lib/server/session"

import { render } from "./helpers/pglite-sql"

// Route-level tests for /api/clients/[clientId]/report-shares: the wrapper's
// role gate, the client 404 (an id RLS hides reads as missing), the hash-only
// insert, the token returned once, and the audit events. The database is a
// scripted fake keyed on the statement text; the DB-backed version of these
// flows lives in tests/integration/routes/report-shares.test.ts.

const ORG = "00000000-0000-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-000000000002"
const CLIENT = "11111111-1111-4111-8111-111111111111"
const SHARE = "22222222-2222-4222-8222-222222222222"

vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ NEXTAUTH_URL: "https://app.example.test" }),
}))
vi.mock("@/lib/server/session", () => ({
  requireSession: vi.fn(),
  requireRole: vi.fn((session: { role: string }, roles: string[]) => {
    if (!roles.includes(session.role)) {
      throw new ApiError(403, "permission_denied", "Permission denied.")
    }
    return session
  }),
}))

type Script = {
  clientVisible: boolean
  archived?: boolean
  existing?: { id: string; revoked: boolean } | null
}

const executed: { text: string; params: unknown[] }[] = []
let script: Script

function isTagged(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && "raw" in value
}

const shareRow = (overrides: Record<string, unknown> = {}) => ({
  id: SHARE,
  createdAt: new Date("2026-09-24T10:00:00Z"),
  createdByName: "Priya Owner",
  expiresAt: new Date("2026-12-23T10:00:00Z"),
  revokedAt: null,
  lastViewedAt: null,
  viewCount: 0,
  ...overrides,
})

function respond(text: string): unknown[] {
  if (text.includes(" as visible")) {
    return script.clientVisible ? [{ visible: true }] : []
  }
  if (text.includes("as archived")) return [{ archived: !!script.archived }]
  if (text.includes("insert into report_share")) return [shareRow()]
  if (text.includes("for update"))
    return script.existing ? [script.existing] : []
  if (text.includes("update report_share")) return []
  if (text.includes("from report_share s")) {
    return [
      shareRow(),
      shareRow({
        id: "33333333-3333-4333-8333-333333333333",
        revokedAt: new Date("2026-09-20T00:00:00Z"),
      }),
      shareRow({
        id: "44444444-4444-4444-8444-444444444444",
        expiresAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ]
  }
  throw new Error(`unexpected statement: ${text}`)
}

const fakeSql = (first: unknown, ...args: unknown[]) => {
  if (isTagged(first)) {
    const query = {
      strings: first,
      args,
      then<T>(
        onFulfilled: (rows: unknown[]) => T,
        onRejected?: (e: unknown) => T
      ) {
        const rendered = render(query)
        executed.push(rendered)
        return Promise.resolve()
          .then(() => respond(rendered.text))
          .then(onFulfilled, onRejected)
      },
    }
    return query
  }
  return { first }
}

vi.mock("@/lib/server/db", () => ({
  withTenant: vi.fn(
    async (_organisationId: string, fn: (sql: unknown) => Promise<unknown>) =>
      fn(fakeSql)
  ),
}))

function asRole(role: "owner" | "admin" | "member" | "viewer") {
  vi.mocked(requireSession).mockResolvedValue({
    sessionId: "s",
    userId: USER,
    organisationId: ORG,
    organisationName: "Harbour Agency",
    displayName: "Priya Owner",
    email: "priya@example.test",
    role,
    canPublish: true,
  })
}

const listContext = (clientId = CLIENT) => ({
  params: Promise.resolve({ clientId }),
})
const shareContext = (clientId = CLIENT, shareId = SHARE) => ({
  params: Promise.resolve({ clientId, shareId }),
})

const get = (clientId = CLIENT) =>
  GET(
    new Request(`http://localhost/api/clients/${clientId}/report-shares`),
    listContext(clientId)
  )
const post = (body: unknown, clientId = CLIENT) =>
  POST(
    new Request(`http://localhost/api/clients/${clientId}/report-shares`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    listContext(clientId)
  )
const del = (clientId = CLIENT, shareId = SHARE) =>
  DELETE(
    new Request(
      `http://localhost/api/clients/${clientId}/report-shares/${shareId}`,
      { method: "DELETE" }
    ),
    shareContext(clientId, shareId)
  )

beforeEach(() => {
  vi.clearAllMocks()
  executed.length = 0
  script = { clientVisible: true, existing: { id: SHARE, revoked: false } }
  asRole("owner")
})

describe("roles", () => {
  it.each(["member", "viewer"] as const)(
    "refuses a %s with 403 before touching the database",
    async (role) => {
      asRole(role)
      for (const response of [await get(), await post({}), await del()]) {
        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toMatchObject({
          error: "permission_denied",
        })
      }
      expect(executed).toHaveLength(0)
      expect(writeAudit).not.toHaveBeenCalled()
    }
  )

  it.each(["owner", "admin"] as const)("lets an %s through", async (role) => {
    asRole(role)
    expect((await get()).status).toBe(200)
    expect((await post({})).status).toBe(201)
    expect((await del()).status).toBe(200)
  })
})

describe("another organisation's client (hidden by RLS)", () => {
  beforeEach(() => {
    script.clientVisible = false
  })

  it("is a 404 for list, create and revoke, and writes nothing", async () => {
    for (const response of [await get(), await post({}), await del()]) {
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: "client_not_found",
      })
    }
    expect(executed.some((s) => s.text.includes("insert into"))).toBe(false)
    expect(executed.some((s) => s.text.includes("update report_share"))).toBe(
      false
    )
    expect(writeAudit).not.toHaveBeenCalled()
  })
})

describe("GET", () => {
  it("lists the client's links with a status and no token", async () => {
    const response = await get()
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>
    }
    expect(body.items.map((item) => item.status)).toEqual([
      "active",
      "revoked",
      "expired",
    ])
    expect(Object.keys(body.items[0]).sort()).toEqual([
      "createdAt",
      "createdByName",
      "expiresAt",
      "id",
      "lastViewedAt",
      "revokedAt",
      "status",
      "viewCount",
    ])
    const list = executed.find((s) => s.text.includes("from report_share s"))!
    expect(list.text).not.toContain("token_hash")
    expect(list.params).toContain(CLIENT)
  })

  it("rejects a client id that is not a uuid", async () => {
    const response = await get("not-a-uuid")
    expect(response.status).toBe(400)
  })
})

describe("POST", () => {
  it("stores only the SHA-256 of a fresh token and returns the link once", async () => {
    const response = await post({ expiresInDays: 30 })
    expect(response.status).toBe(201)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = (await response.json()) as {
      url: string
      share: { status: string }
    }
    const match = body.url.match(
      /^https:\/\/app\.example\.test\/share\/report\/([A-Za-z0-9_-]{43})$/
    )
    expect(match).not.toBeNull()
    const token = match![1]
    expect(body.share.status).toBe("active")

    const insert = executed.find((s) =>
      s.text.includes("insert into report_share")
    )!
    expect(JSON.stringify(insert.params)).not.toContain(token)
    const { createHash } = await import("node:crypto")
    expect(insert.params).toContain(
      createHash("sha256").update(token).digest("hex")
    )
    expect(insert.params).toEqual(
      expect.arrayContaining([ORG, CLIENT, USER, 30])
    )
  })

  it("defaults to 90 days", async () => {
    await post({})
    const insert = executed.find((s) =>
      s.text.includes("insert into report_share")
    )!
    expect(insert.params).toContain(90)
  })

  it.each([0, 7, 180, 3650, "90"])(
    "refuses an expiry of %j days",
    async (days) => {
      const response = await post({ expiresInDays: days })
      expect(response.status).toBe(400)
      expect(executed).toHaveLength(0)
    }
  )

  it("audits report_share.created without the token", async () => {
    const response = await post({ expiresInDays: 365 })
    const { url } = (await response.json()) as { url: string }
    expect(writeAudit).toHaveBeenCalledTimes(1)
    const event = vi.mocked(writeAudit).mock.calls[0][1]
    expect(event).toMatchObject({
      organisationId: ORG,
      actorUserId: USER,
      action: "report_share.created",
      subjectType: "report_share",
      subjectId: SHARE,
      metadata: { clientId: CLIENT, expiresInDays: 365 },
    })
    expect(JSON.stringify(event)).not.toContain(url.split("/").pop()!)
  })

  it("refuses an archived client with 409", async () => {
    script.archived = true
    const response = await post({})
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: "client_archived",
    })
    expect(writeAudit).not.toHaveBeenCalled()
  })
})

describe("DELETE", () => {
  it("revokes the link within its own client and audits it", async () => {
    const response = await del()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ revoked: true })
    const lookup = executed.find((s) => s.text.includes("for update"))!
    expect(lookup.params).toEqual([SHARE, CLIENT])
    const update = executed.find((s) => s.text.includes("update report_share"))!
    expect(update.text).toContain("revoked_at = now()")
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "report_share.revoked",
        subjectId: SHARE,
        metadata: { clientId: CLIENT },
      })
    )
  })

  it("is a 404 for a link that is not this client's", async () => {
    script.existing = null
    const response = await del()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: "report_share_not_found",
    })
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("is a quiet no-op for a link already revoked", async () => {
    script.existing = { id: SHARE, revoked: true }
    const response = await del()
    expect(response.status).toBe(200)
    expect(executed.some((s) => s.text.includes("update report_share"))).toBe(
      false
    )
    expect(writeAudit).not.toHaveBeenCalled()
  })
})
