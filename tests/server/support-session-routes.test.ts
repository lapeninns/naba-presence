import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE as signOut } from "@/app/api/session/route"
import { POST as switchOrganisation } from "@/app/api/session/switch/route"
import { POST as startImpersonation } from "@/app/api/support/impersonation/route"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { requireSession, type Session } from "@/lib/server/session"
import { cookies } from "next/headers"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
// Only the fields these routes read; each test sets the support flag.
const testEnv = {
  SUPPORT_IMPERSONATION_ENABLED: false,
  SUPPORT_IMPERSONATION_SECRET: "s".repeat(32) as string | undefined,
  SESSION_IDLE_DAYS: 14,
}
vi.mock("@/lib/server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/env")>()),
  getServerEnv: () => testEnv,
}))
vi.mock("@/lib/server/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/audit")>()),
  writeAudit: vi.fn(),
}))

const ORG = "00000000-0000-4000-8000-000000000001"
const OTHER_ORG = "00000000-0000-4000-8000-000000000009"

const customer: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: ORG,
  organisationName: "Agency",
  workspaceMode: "business",
  displayName: "Ada",
  email: "ada@example.test",
  role: "owner",
  canPublish: true,
}

const impersonated: Session = {
  ...customer,
  supportActor: "support@nabapresence.test",
  impersonationReason: "Ticket 42",
}

/** Every session lookup answers `session`; the cookie store can be cleared. */
function signedIn(session: Session) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
    delete: vi.fn(),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => session),
  } as never)
}

beforeEach(() => {
  testEnv.SUPPORT_IMPERSONATION_ENABLED = false
  testEnv.SUPPORT_IMPERSONATION_SECRET = "s".repeat(32)
  vi.mocked(withTenant).mockReset()
  vi.mocked(writeAudit).mockReset()
  vi.mocked(withTenant).mockImplementation((async (
    _organisationId: string,
    fn: (sql: unknown) => Promise<unknown>
  ) => fn(vi.fn(async () => []))) as never)
})

describe("POST /api/session/switch", () => {
  // A switch mints an ordinary session (createSession with no support
  // options), so allowing it would turn a one-hour, attributed impersonation
  // into a long-lived session audited as the customer.
  it("refuses a support impersonation session", async () => {
    signedIn(impersonated)
    const response = await switchOrganisation(
      new Request("http://localhost/api/session/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId: OTHER_ORG }),
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe("support_session_forbidden")
    expect(withTenant).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/session", () => {
  function callSignOut() {
    return signOut(
      new Request("http://localhost/api/session", { method: "DELETE" }),
      { params: Promise.resolve({}) }
    )
  }

  it("records the end of an impersonation when support signs out", async () => {
    signedIn(impersonated)
    const response = await callSignOut()
    expect(response.status).toBe(204)
    expect(writeAudit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeAudit).mock.calls[0][1]).toMatchObject({
      organisationId: ORG,
      action: "support.impersonation.ended",
      subjectType: "user",
      subjectId: customer.userId,
      supportActor: "support@nabapresence.test",
      metadata: { via: "sign_out", reason: "Ticket 42" },
    })
  })

  it("writes no audit for an ordinary sign-out", async () => {
    signedIn(customer)
    const response = await callSignOut()
    expect(response.status).toBe(204)
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("still signs out when the audit write fails", async () => {
    signedIn(impersonated)
    vi.mocked(writeAudit).mockRejectedValueOnce(new Error("db down"))
    const response = await callSignOut()
    expect(response.status).toBe(204)
  })
})

describe("POST /api/support/impersonation", () => {
  function start(secret = testEnv.SUPPORT_IMPERSONATION_SECRET) {
    return startImpersonation(
      new Request("http://localhost/api/support/impersonation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secret}`,
          "x-support-actor": "support@nabapresence.test",
          "x-support-reason": "Ticket 42: customer cannot see reviews",
        },
        body: JSON.stringify({
          organisationId: ORG,
          userId: customer.userId,
        }),
      }),
      { params: Promise.resolve({}) }
    )
  }

  // The secret alone used to switch impersonation on. Off is now the default,
  // and a valid secret does not get past it.
  it("is a 404 with the flag off, even with a valid secret", async () => {
    const response = await start()
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe(
      "support_impersonation_disabled"
    )
    expect(withTenant).not.toHaveBeenCalled()
  })

  it("is a 404 with the flag on and no secret configured", async () => {
    testEnv.SUPPORT_IMPERSONATION_ENABLED = true
    testEnv.SUPPORT_IMPERSONATION_SECRET = undefined
    const response = await start("x".repeat(32))
    expect(response.status).toBe(404)
    expect(withTenant).not.toHaveBeenCalled()
  })

  it("checks the secret once the flag is on", async () => {
    testEnv.SUPPORT_IMPERSONATION_ENABLED = true
    const response = await start("x".repeat(32))
    expect(response.status).toBe(401)
    expect((await response.json()).error).toBe("invalid_support_credential")
    expect(withTenant).not.toHaveBeenCalled()
  })
})

describe("support session resolution", () => {
  /**
   * A transaction double for lookupSession: the identity read answers
   * `identity`, the full read answers `session`, everything else nothing.
   */
  function presenting(identity: { isSupport: boolean }) {
    const statements: string[] = []
    const sql = vi.fn(async (strings: TemplateStringsArray) => {
      const text = strings.join("$")
      statements.push(text)
      if (text.includes('support_actor is not null as "isSupport"')) {
        return [
          {
            sessionId: customer.sessionId,
            userId: customer.userId,
            organisationId: ORG,
            isSupport: identity.isSupport,
          },
        ]
      }
      if (text.includes('o.name as "organisationName"')) {
        return [identity.isSupport ? impersonated : customer]
      }
      return []
    })
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value: "token" }),
      delete: vi.fn(),
    } as never)
    vi.mocked(getDatabase).mockReturnValue({
      begin: vi.fn(async (fn: (tx: typeof sql) => unknown) => fn(sql)),
    } as never)
    return statements
  }

  const deletes = (statements: string[]) =>
    statements.filter((text) => /delete from app_session/.test(text))

  it("answers 401 for a support cookie with the flag off and deletes its row", async () => {
    const statements = presenting({ isSupport: true })
    await expect(requireSession()).rejects.toMatchObject({ status: 401 })
    expect(deletes(statements)).toHaveLength(1)
    expect(deletes(statements)[0]).toMatch(/support_actor is not null/)
    // Nothing past the identity read: no organisation lookup, no slide.
    expect(statements.some((text) => text.includes("organisationName"))).toBe(
      false
    )
  })

  it("resolves a support session with the flag on", async () => {
    testEnv.SUPPORT_IMPERSONATION_ENABLED = true
    const statements = presenting({ isSupport: true })
    await expect(requireSession()).resolves.toMatchObject({
      supportActor: "support@nabapresence.test",
    })
    expect(deletes(statements)).toHaveLength(0)
  })

  it("leaves an ordinary session alone with the flag off", async () => {
    const statements = presenting({ isSupport: false })
    await expect(requireSession()).resolves.toMatchObject({
      userId: customer.userId,
    })
    expect(deletes(statements)).toHaveLength(0)
  })
})
