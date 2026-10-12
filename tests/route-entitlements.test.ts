import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { deriveAccess, type BillingRecord } from "@/lib/domain/entitlements"
import { getDatabase, withTenant } from "@/lib/server/db"
import {
  ENTITLEMENT_EXEMPT_PREFIXES,
  ENTITLEMENT_EXEMPT_ROUTES,
  sessionCanWrite,
} from "@/lib/server/entitlement-policy"
import { locationLimitError } from "@/lib/server/http"
import { route, type RouteHandler } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))

/**
 * Central entitlement enforcement for routes (plan P07-S3).
 *
 * The static scan is the drift guard, like the roles matrix: every
 * session-authenticated POST/PUT/PATCH/DELETE under app/api is "write" (the
 * default) or "ai", or declares `entitlement: "exempt"` AND is listed in
 * ENTITLEMENT_EXEMPT_ROUTES (lib/server/entitlement-policy.ts). A new
 * exemption that skips the list fails here, and so does a stale list entry.
 * The behaviour through the real routes is pinned by
 * tests/integration/routes/billing-read-only.test.ts.
 */

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const apiRoot = join(repoRoot, "app/api")

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** AI work: refused on Access.canUseAi. */
const AI_ROUTES = ["POST reviews/[id]/drafts", "POST drafts/[id]/verify"]

type Handler = {
  key: string
  path: string
  auth: string
  entitlement: string | null
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === "route.ts" ? [full] : []
  })
}

function handlers(): Handler[] {
  return routeFiles(apiRoot).flatMap((file) => {
    const source = readFileSync(file, "utf8")
    const path = relative(apiRoot, file).replace(/\/?route\.ts$/, "")
    const exports = [
      ...source.matchAll(/export const (GET|HEAD|POST|PUT|PATCH|DELETE)\s*=/g),
    ]
    return exports.flatMap((match, index) => {
      const method = match[1]
      if (!MUTATING.has(method)) return []
      const block = source.slice(
        match.index,
        exports[index + 1]?.index ?? source.length
      )
      return [
        {
          key: `${method} ${path}`,
          path,
          auth: block.match(/auth:\s*"(\w+)"/)?.[1] ?? "session",
          entitlement: block.match(/entitlement:\s*"(\w+)"/)?.[1] ?? null,
        },
      ]
    })
  })
}

const exempt = new Set<string>(ENTITLEMENT_EXEMPT_ROUTES)
const exemptByPrefix = (path: string) =>
  ENTITLEMENT_EXEMPT_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix))

describe("route entitlements: static scan of app/api", () => {
  const all = handlers()
  const session = all.filter((handler) => handler.auth === "session")

  it("finds the session mutations", () => {
    expect(session.length).toBeGreaterThan(80)
  })

  it("declares exempt only on listed routes, and every listed route is exempt", () => {
    const declared = session
      .filter((handler) => handler.entitlement === "exempt")
      .map((handler) => handler.key)
    const unlisted = session
      .filter(
        (handler) =>
          handler.entitlement === "exempt" &&
          !exempt.has(handler.key) &&
          !exemptByPrefix(handler.path)
      )
      .map((handler) => handler.key)
    expect(unlisted).toEqual([])
    expect([...exempt].filter((key) => !declared.includes(key))).toEqual([])
  })

  it("declares exempt on every session mutation under an exempt prefix", () => {
    // route() cannot see its own path, so a billing route (checkout, the
    // portal) that left out `entitlement: "exempt"` would refuse exactly the
    // read-only customers who need it. The prefix is a list of routes that
    // must declare it, not an exemption by itself.
    const undeclared = session
      .filter(
        (handler) =>
          exemptByPrefix(handler.path) && handler.entitlement !== "exempt"
      )
      .map((handler) => handler.key)
    expect(undeclared).toEqual([])
    expect(exemptByPrefix("billing/checkout")).toBe(true)
    expect(exemptByPrefix("billing")).toBe(true)
    expect(exemptByPrefix("billing-history")).toBe(false)
  })

  it("keeps the billing mutations exempt and owner-only (P07-S5)", () => {
    for (const key of [
      "POST billing/checkout",
      "POST billing/portal",
      "POST billing/plan-change",
      "POST billing/cancel",
    ]) {
      const handler = session.find((entry) => entry.key === key)
      expect(handler, key).toBeDefined()
      expect(handler?.entitlement, key).toBe("exempt")
      const source = readFileSync(
        join(apiRoot, handler!.path, "route.ts"),
        "utf8"
      )
      expect(source, key).toMatch(/roles:\s*\["owner"\]/)
      expect(source, key).toContain("// INTEGRATION: mfa step_up")
      expect(source, key).toContain("refuseSupportSession(session)")
    }
  })

  it("uses only the known entitlement values", () => {
    const unknown = all.filter(
      (handler) =>
        handler.entitlement !== null &&
        !["write", "ai", "exempt"].includes(handler.entitlement)
    )
    expect(unknown).toEqual([])
  })

  it("marks the AI routes as ai", () => {
    for (const key of AI_ROUTES) {
      expect(
        session.find((handler) => handler.key === key)?.entitlement,
        key
      ).toBe("ai")
    }
  })

  it("never declares an entitlement on a cron or public route, where it would do nothing", () => {
    const misplaced = all
      .filter((handler) => handler.auth !== "session" && handler.entitlement)
      .map((handler) => handler.key)
    expect(misplaced).toEqual([])
  })

  it("keeps the read-only escape hatches exempt", () => {
    for (const key of [
      "POST session/switch",
      "POST privacy/export",
      "POST privacy/requests",
      "POST google/connections/[id]/disconnect",
      "DELETE location-links",
      "POST invitations/[token]",
    ]) {
      expect(exempt.has(key), key).toBe(true)
    }
  })

  it("leaves new work under the default write entitlement", () => {
    for (const key of [
      "PUT locations/[id]/profile",
      "POST locations/[id]/posts",
      "POST locations/[id]/posts/[postId]/publish",
      "POST location-links",
      "POST google/connect/start",
      "PATCH settings",
    ]) {
      const handler = session.find((entry) => entry.key === key)
      expect(handler, key).toBeDefined()
      expect(handler?.entitlement ?? "write", key).toBe("write")
    }
  })
})

// ---------------------------------------------------------------------------
// route() behaviour
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-11T12:00:00Z")

function record(overrides: Partial<BillingRecord>): BillingRecord {
  return {
    state: "pilot",
    trialEndsAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    firstPaymentSucceeded: false,
    pendingEffectiveAt: null,
    ...overrides,
  }
}

const READ_ONLY = deriveAccess(
  record({ state: "read_only" }),
  { current: { locationLimit: 3, memberLimit: null }, pending: null },
  NOW
)
const PILOT = deriveAccess(record({}), { current: null, pending: null }, NOW)

const base: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000001",
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Test",
  email: "test@example.test",
  role: "owner",
  canPublish: true,
}

function signedIn(value: Session) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => value),
  } as never)
}

function call(handler: RouteHandler, method: string) {
  return handler(
    new Request("http://localhost/api/test", {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
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
  vi.mocked(withTenant).mockImplementation(async (_organisationId, fn) =>
    fn("sql" as never)
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("route() billing entitlement", () => {
  const ok = { handler: async () => ({ ok: true }) }

  it("refuses a write with 402 billing_read_only when enforced and read-only", async () => {
    signedIn({ ...base, access: READ_ONLY, entitlementEnforced: true })
    const handler = vi.fn(async () => ({ ok: true }))
    const response = await call(route({ handler }), "PATCH")
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      error: "billing_read_only",
      details: { reason: "read_only", mode: "read_only" },
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("refuses an ai route while read-only", async () => {
    signedIn({ ...base, access: READ_ONLY, entitlementEnforced: true })
    const response = await call(route({ ...ok, entitlement: "ai" }), "POST")
    expect(response.status).toBe(402)
  })

  it("lets an exempt route through while read-only", async () => {
    signedIn({ ...base, access: READ_ONLY, entitlementEnforced: true })
    const response = await call(route({ ...ok, entitlement: "exempt" }), "POST")
    expect(response.status).toBe(200)
  })

  it("never refuses a read", async () => {
    signedIn({ ...base, access: READ_ONLY, entitlementEnforced: true })
    const response = await call(route(ok), "GET")
    expect(response.status).toBe(200)
  })

  it("does nothing while enforcement does not apply to the organisation", async () => {
    signedIn({ ...base, access: READ_ONLY, entitlementEnforced: false })
    expect((await call(route(ok), "DELETE")).status).toBe(200)
    signedIn({ ...base, access: READ_ONLY })
    expect((await call(route(ok), "DELETE")).status).toBe(200)
  })

  it("lets a writable organisation write", async () => {
    signedIn({ ...base, access: PILOT, entitlementEnforced: true })
    expect((await call(route(ok), "PUT")).status).toBe(200)
  })

  it("fails closed when enforced with no access at all", async () => {
    signedIn({ ...base, entitlementEnforced: true })
    const response = await call(route(ok), "POST")
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      details: { reason: "billing_missing" },
    })
  })

  it("answers the capability projection the same way", () => {
    expect(
      sessionCanWrite({ access: READ_ONLY, entitlementEnforced: true })
    ).toBe(false)
    expect(
      sessionCanWrite({ access: READ_ONLY, entitlementEnforced: false })
    ).toBe(true)
    expect(sessionCanWrite({ access: PILOT, entitlementEnforced: true })).toBe(
      true
    )
    expect(sessionCanWrite({ entitlementEnforced: true })).toBe(false)
  })
})

describe("location limit refusal", () => {
  it("maps the 0223 trigger error to 402 location_limit_reached", async () => {
    signedIn({ ...base, access: PILOT, entitlementEnforced: true })
    const response = await call(
      route({
        handler: async () => {
          throw Object.assign(new Error("location_limit_reached"), {
            code: "23514",
            detail: "2",
          })
        },
      }),
      "POST"
    )
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({
      error: "location_limit_reached",
      details: { limit: 2 },
    })
  })

  it("leaves other check violations alone", () => {
    expect(
      locationLimitError(
        Object.assign(new Error("some_other_check"), { code: "23514" })
      )
    ).toBeNull()
  })
})
