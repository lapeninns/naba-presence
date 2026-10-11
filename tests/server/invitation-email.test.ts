import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Invitation email (plan P06-6): what the email says, and what the delivery
 * queue does with a claimed row before and after the provider call. The
 * queue's database is a fake that answers the claim and records the settle;
 * the routes, RLS and the job tick are covered end to end by
 * tests/integration/routes/invitation-delivery.test.ts.
 */

const settings = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  paused: false,
  claimed: [] as Record<string, unknown>[],
  queries: [] as { text: string; values: unknown[] }[],
}))

vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => settings.env,
}))
vi.mock("@/lib/server/pause-controls", () => ({
  isScopeEnabled: vi.fn(async () => !settings.paused),
}))
vi.mock("@/lib/server/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: (value: Buffer) => value.toString("utf8"),
}))
vi.mock("@/lib/server/db", () => {
  function sql(strings: TemplateStringsArray, ...values: unknown[]) {
    const text = strings.join("?")
    settings.queries.push({ text, values })
    return Promise.resolve(text.includes("with due as") ? settings.claimed : [])
  }
  return {
    getDatabase: () => sql,
    withTenant: (
      _organisationId: string,
      callback: (s: typeof sql) => unknown
    ) => callback(sql),
  }
})

import { deliverInvitationEmails } from "@/lib/server/invitations/delivery"
import { renderInvitationEmail } from "@/lib/server/notifications/messages"

const ORG = "00000000-0000-4000-8000-000000000001"
const DELIVERY = "00000000-0000-4000-8000-0000000000d1"
const TOKEN = "invite-token-value"

function configuredEnv(overrides: Record<string, unknown> = {}) {
  return {
    NEXTAUTH_URL: "https://app.nabapresence.test",
    EMAIL_PROVIDER: "resend",
    EMAIL_API_KEY: "test-only-email-key",
    EMAIL_FROM: "NabaPresence <hello@nabapresence.test>",
    EMAIL_API_BASE_URL: "https://email.stub.test",
    TENANT_EMAIL_ENABLED: true,
    ...overrides,
  }
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DELIVERY,
    attempts: 1,
    createdAt: new Date(),
    mayHaveSent: false,
    invitationId: "00000000-0000-4000-8000-0000000000a1",
    email: "chef@example.test",
    role: "member",
    tokenCiphertext: Buffer.from(TOKEN, "utf8"),
    expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    acceptedAt: null,
    organisationName: "The Old Crown",
    timeZone: "Europe/London",
    ...overrides,
  }
}

function settled() {
  const settle = settings.queries.find((query) =>
    query.text.includes("may_have_sent = may_have_sent or")
  )
  return settle
    ? { status: settle.values[0], errorCode: settle.values[1] }
    : null
}

const fetchMock = vi.fn()

beforeEach(() => {
  settings.env = configuredEnv()
  settings.paused = false
  settings.claimed = [claimedRow()]
  settings.queries = []
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: "email-1" }), { status: 200 })
  )
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe("renderInvitationEmail", () => {
  const expiresAt = new Date("2026-10-18T09:00:00Z")

  it("names the organisation, the role, the link and the expiry", () => {
    const email = renderInvitationEmail({
      organisationName: "The Old Crown",
      role: "admin",
      inviteUrl: "https://app.test/invite/abc",
      expiresAt,
    })
    expect(email.subject).toBe(
      "You're invited to join The Old Crown on NabaPresence"
    )
    expect(email.text).toContain("as an admin")
    expect(email.text).toContain("https://app.test/invite/abc")
    expect(email.text).toContain("expires on 18 October 2026")
  })

  it("keeps the link out of the subject and flattens a multi-line name", () => {
    const email = renderInvitationEmail({
      organisationName: "Evil\r\nBcc: someone@example.test",
      role: "viewer",
      inviteUrl: "https://app.test/invite/secret-token",
      expiresAt,
    })
    expect(email.subject).not.toMatch(/[\r\n]/)
    expect(email.subject).not.toContain("secret-token")
    expect(email.text).toContain("as a viewer")
  })

  it("falls back to London time for a timezone Intl does not know", () => {
    const email = renderInvitationEmail({
      organisationName: "Crown",
      role: "member",
      inviteUrl: "https://app.test/invite/abc",
      expiresAt,
      timeZone: "Not/AZone",
    })
    expect(email.text).toContain("18 October 2026")
  })
})

describe("deliverInvitationEmails", () => {
  it("sends the link built from NEXTAUTH_URL under the row's idempotency key", async () => {
    const outcome = await deliverInvitationEmails(ORG, { deliveryId: DELIVERY })

    expect(outcome).toMatchObject({ sent: 1, paused: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe("https://email.stub.test/emails")
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(
      `invitation-delivery/${DELIVERY}`
    )
    const body = JSON.parse(String(init.body)) as {
      to: string[]
      text: string
    }
    expect(body.to).toEqual(["chef@example.test"])
    expect(body.text).toContain(`https://app.nabapresence.test/invite/${TOKEN}`)
    expect(settled()).toEqual({ status: "sent", errorCode: null })
  })

  it("is suppressed, with nothing sent, when no provider is configured", async () => {
    settings.env = configuredEnv({ EMAIL_PROVIDER: "none" })
    const outcome = await deliverInvitationEmails(ORG)
    expect(outcome.suppressed).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(settled()).toEqual({
      status: "suppressed",
      errorCode: "provider_not_configured",
    })
  })

  it("is suppressed when tenant email is switched off", async () => {
    settings.env = configuredEnv({ TENANT_EMAIL_ENABLED: false })
    await deliverInvitationEmails(ORG)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(settled()).toEqual({
      status: "suppressed",
      errorCode: "tenant_email_disabled",
    })
  })

  it("is suppressed without an application URL to link to", async () => {
    settings.env = configuredEnv({ NEXTAUTH_URL: undefined })
    await deliverInvitationEmails(ORG)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(settled()).toEqual({
      status: "suppressed",
      errorCode: "app_url_not_configured",
    })
  })

  it("does not email an invitation accepted or expired since it was queued", async () => {
    settings.claimed = [claimedRow({ acceptedAt: new Date() })]
    await deliverInvitationEmails(ORG)
    expect(settled()).toEqual({
      status: "suppressed",
      errorCode: "invitation_accepted",
    })

    settings.queries = []
    settings.claimed = [claimedRow({ expiresAt: new Date(Date.now() - 1000) })]
    await deliverInvitationEmails(ORG)
    expect(settled()).toEqual({
      status: "suppressed",
      errorCode: "invitation_expired",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("keeps a provider 5xx pending for a retry and fails a 4xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 503 }))
    await deliverInvitationEmails(ORG)
    expect(settled()).toEqual({
      status: "pending",
      errorCode: "email_http_503",
    })

    settings.queries = []
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 422 }))
    await deliverInvitationEmails(ORG)
    expect(settled()).toEqual({ status: "failed", errorCode: "email_http_422" })
  })

  it("claims nothing while the invitation_email scope is paused", async () => {
    settings.paused = true
    const outcome = await deliverInvitationEmails(ORG)
    expect(outcome.paused).toBe(true)
    expect(settings.queries).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
