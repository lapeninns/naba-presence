import { afterEach, describe, expect, it, vi } from "vitest"

const settings = vi.hoisted(() => ({ tenantEmailEnabled: false }))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({
    EMAIL_PROVIDER: "resend",
    EMAIL_API_KEY: "test-only-email-key",
    EMAIL_FROM: "NabaPresence <notifications@nabapresence.test>",
    EMAIL_API_BASE_URL: "https://mail-provider.example.test",
    TENANT_EMAIL_ENABLED: settings.tenantEmailEnabled,
  }),
}))
import { sendEmail, sendTenantEmail } from "@/lib/server/notifications/email"

afterEach(() => {
  vi.unstubAllGlobals()
  settings.tenantEmailEnabled = false
})

describe("operator-only email configuration", () => {
  it("sends an operator alert while suppressing tenant mail at the provider boundary", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "message-1" }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetcher)
    expect(
      await sendTenantEmail({
        to: "customer@example.test",
        subject: "Customer incident",
        text: "Example",
      })
    ).toEqual({ status: "suppressed", reason: "tenant_email_disabled" })
    expect(fetcher).not.toHaveBeenCalled()
    expect(
      await sendEmail({
        to: "operator@example.test",
        subject: "NabaPresence operator test",
        text: "Example",
      })
    ).toEqual({ status: "sent", providerMessageId: "message-1" })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.to).toEqual(["operator@example.test"])
    expect(body.from).toBe("NabaPresence <notifications@nabapresence.test>")
  })

  it("can explicitly restore tenant delivery", async () => {
    settings.tenantEmailEnabled = true
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "message-2" }), { status: 200 })
      )
    vi.stubGlobal("fetch", fetcher)
    expect(
      await sendTenantEmail({
        to: "customer@example.test",
        subject: "Incident",
        text: "Example",
      })
    ).toMatchObject({ status: "sent" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
