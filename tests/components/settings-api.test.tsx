import { afterEach, describe, expect, it, vi } from "vitest"

import { startGoogleConnect, disconnectConnection } from "@/lib/api/connections"
import { fetchSettings, saveSettings } from "@/lib/api/settings"
import { fetchSettingsCapabilities } from "@/lib/api/settings-capabilities"
import { updateMember } from "@/lib/api/members"
import { createInvitation } from "@/lib/api/invitations"
import { startBackfill } from "@/lib/api/backfill"

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("settings clients", () => {
  it("fetchSettings parses the settings envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ settings: { approvalRequired: true, requireTwoPersonApproval: false, rawContentRetentionDays: 14, defaultLanguageCode: "en-GB", defaultTimezone: "Europe/London", directPublishConsentAt: null } })
    ))
    const settings = await fetchSettings()
    expect(settings.defaultTimezone).toBe("Europe/London")
    expect(settings.directPublishConsentAt).toBeNull()
  })

  it("saveSettings PATCHes the policy body and parses the result", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ settings: { approvalRequired: false, requireTwoPersonApproval: false, rawContentRetentionDays: 7, defaultLanguageCode: "en-GB", defaultTimezone: "Europe/London", directPublishConsentAt: "2026-08-02T00:00:00.000Z" } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await saveSettings({ approvalRequired: false, requireTwoPersonApproval: false, rawContentRetentionDays: 7, defaultLanguageCode: "en-GB", defaultTimezone: "Europe/London", directPublishConsent: true })
    expect(result.directPublishConsentAt).not.toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/settings")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH")
  })

  it("fetchSettingsCapabilities parses the capability envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ capabilities: { canManageTeam: true, canManageConnections: true, canEditSettings: false } })
    ))
    expect((await fetchSettingsCapabilities()).canEditSettings).toBe(false)
  })
})

describe("team clients", () => {
  it("updateMember PATCHes /api/members", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ member: { userId: "u1", role: "admin", canPublish: true, createdAt: "x" } }))
    vi.stubGlobal("fetch", fetchMock)
    const result = await updateMember({ userId: "u1", role: "admin", canPublish: true })
    expect(result.member.role).toBe("admin")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH")
  })

  it("createInvitation POSTs and returns the invite url", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse({ invitation: { id: "i1", email: "a@b.test", role: "member", canPublish: false, expiresAt: "x", createdAt: "y" }, inviteUrl: "https://app.test/invite/secret" }, 201)
    ))
    const result = await createInvitation({ email: "a@b.test", role: "member", canPublish: false })
    expect(result.inviteUrl).toContain("/invite/")
  })
})

describe("connection clients", () => {
  it("startGoogleConnect POSTs connect/start and returns the authorization url", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ authorizationUrl: "https://accounts.google.test/o/oauth2/v2/auth?x=1" }))
    vi.stubGlobal("fetch", fetchMock)
    const result = await startGoogleConnect()
    expect(result.authorizationUrl).toContain("accounts.google")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/google/connect/start")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
  })

  it("disconnectConnection POSTs the disconnect route", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ status: "disconnected" }))
    vi.stubGlobal("fetch", fetchMock)
    expect((await disconnectConnection("c1")).status).toBe("disconnected")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/google/connections/c1/disconnect")
  })

  it("startBackfill surfaces the paused error as an ApiClientError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "sync_paused", message: "Review sync is paused." }, 503)))
    await expect(startBackfill({ maxPagesPerLocation: 10 })).rejects.toMatchObject({ code: "sync_paused", status: 503 })
  })
})
