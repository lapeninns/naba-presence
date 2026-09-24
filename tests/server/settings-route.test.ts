import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { PATCH } from "@/app/api/settings/route"
import { requiresDirectPublishConsent } from "@/lib/contracts/settings"
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

const baseSession: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: ORG,
  organisationName: "Org",
  displayName: "Test",
  email: "test@example.test",
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

/** A fake tagged-template `sql` that answers the lock read with `stored`. */
function fakeTenant(stored: { approvalRequired: boolean }) {
  const updates: string[] = []
  const sql = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?")
    if (text.includes("for update")) return Promise.resolve([stored])
    if (text.includes("update organisation")) {
      updates.push(text)
      return Promise.resolve([
        {
          approvalRequired: false,
          requireTwoPersonApproval: false,
          rawContentRetentionDays: 14,
          defaultLanguageCode: "en",
          defaultTimezone: "Europe/London",
          directPublishConsentAt: null,
        },
      ])
    }
    return Promise.resolve([])
  })
  vi.mocked(withTenant).mockImplementation(async (_org, fn) => fn(sql as never))
  return { updates }
}

function patch(body: object) {
  return PATCH(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
}

const directPublishing = {
  approvalRequired: false,
  rawContentRetentionDays: 14,
  defaultLanguageCode: "en",
  defaultTimezone: "Europe/London",
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

describe("requiresDirectPublishConsent", () => {
  it("is true only when approval goes from on to off", () => {
    expect(
      requiresDirectPublishConsent(true, { approvalRequired: false })
    ).toBe(true)
    expect(
      requiresDirectPublishConsent(false, { approvalRequired: false })
    ).toBe(false)
    expect(requiresDirectPublishConsent(true, { approvalRequired: true })).toBe(
      false
    )
    expect(
      requiresDirectPublishConsent(false, { approvalRequired: true })
    ).toBe(false)
  })
})

describe("PATCH /api/settings direct-publish consent", () => {
  it("lets an admin save other fields while direct publishing is already on", async () => {
    signedIn(baseSession)
    const { updates } = fakeTenant({ approvalRequired: false })
    const response = await patch(directPublishing)
    expect(response.status).toBe(200)
    expect(updates).toHaveLength(1)
  })

  it("still refuses an admin turning approval off", async () => {
    signedIn(baseSession)
    const { updates } = fakeTenant({ approvalRequired: true })
    const response = await patch({
      ...directPublishing,
      directPublishConsent: true,
    })
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(
      "direct_publish_consent_required"
    )
    expect(updates).toHaveLength(0)
  })

  it("refuses an owner turning approval off without consent", async () => {
    signedIn({ ...baseSession, role: "owner" })
    const { updates } = fakeTenant({ approvalRequired: true })
    const response = await patch(directPublishing)
    expect(response.status).toBe(403)
    expect(updates).toHaveLength(0)
  })

  it("lets an owner turn approval off with consent", async () => {
    signedIn({ ...baseSession, role: "owner" })
    const { updates } = fakeTenant({ approvalRequired: true })
    const response = await patch({
      ...directPublishing,
      directPublishConsent: true,
    })
    expect(response.status).toBe(200)
    expect(updates).toHaveLength(1)
  })
})
