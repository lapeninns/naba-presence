import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE as signOut } from "@/app/api/session/route"
import { POST as switchOrganisation } from "@/app/api/session/switch/route"
import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
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
