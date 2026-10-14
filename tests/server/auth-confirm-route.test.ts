import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { GET, POST } from "@/app/auth/confirm/route"
import { takeAbuseBudget } from "@/lib/server/abuse-limits"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { verifyEmailToken } from "@/lib/server/password-auth"

/**
 * W6-05: the emailed confirmation link must not consume its one-time token
 * on a GET (mail scanners, link previews, login CSRF). GET hands over to the
 * interstitial; only a same-origin POST verifies the token and signs in.
 */

vi.mock("@/lib/server/abuse-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/abuse-limits")>()),
  clientIpFromRequest: () => "203.0.113.7",
  takeAbuseBudget: vi.fn(),
}))
vi.mock("@/lib/server/password-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/password-auth")>()),
  verifyEmailToken: vi.fn(),
}))
vi.mock("@/lib/server/email-auth", () => ({
  completeEmailAuthentication: vi.fn(),
}))

const APP = "https://app.example.test"
const TOKEN = "h".repeat(40)

function confirmPost(
  fields: Record<string, string>,
  headers: Record<string, string> = { origin: APP }
) {
  return POST(
    new Request(`${APP}/auth/confirm`, {
      method: "POST",
      headers,
      body: new URLSearchParams(fields),
    })
  )
}

function location(response: Response) {
  return new URL(response.headers.get("location")!)
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
  vi.stubEnv("NEXTAUTH_URL", APP)
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(takeAbuseBudget).mockResolvedValue(undefined)
  vi.mocked(verifyEmailToken).mockResolvedValue({
    identity: { subject: "sub" },
  } as never)
  vi.mocked(completeEmailAuthentication).mockResolvedValue({
    mfaRequired: false,
  } as never)
})

describe("GET /auth/confirm", () => {
  it("sends an email link to the interstitial without consuming the token", async () => {
    const response = await GET(
      new Request(
        `${APP}/auth/confirm?flow=signup&token_hash=${TOKEN}&type=email&inviteToken=inv-1`
      )
    )
    const target = location(response)
    expect(target.pathname).toBe("/confirm-email")
    expect(target.searchParams.get("token_hash")).toBe(TOKEN)
    expect(target.searchParams.get("inviteToken")).toBe("inv-1")
    expect(verifyEmailToken).not.toHaveBeenCalled()
    expect(completeEmailAuthentication).not.toHaveBeenCalled()
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("keeps sending a recovery link to the new-password form", async () => {
    const response = await GET(
      new Request(`${APP}/auth/confirm?token_hash=${TOKEN}&type=recovery`)
    )
    const target = location(response)
    expect(target.pathname).toBe("/reset-password")
    expect(target.searchParams.get("token_hash")).toBe(TOKEN)
    expect(verifyEmailToken).not.toHaveBeenCalled()
  })

  it("lands a malformed link on sign-in", async () => {
    const target = location(
      await GET(new Request(`${APP}/auth/confirm?token_hash=short&type=email`))
    )
    expect(target.pathname).toBe("/sign-in")
    expect(target.searchParams.get("status")).toBe("invalid_email_link")
  })
})

describe("POST /auth/confirm", () => {
  it("consumes the token and signs in on a same-origin POST", async () => {
    const response = await confirmPost({
      token_hash: TOKEN,
      type: "email",
      inviteToken: "inv-1",
    })
    expect(response.status).toBe(303)
    expect(location(response).toString()).toBe(`${APP}/inbox`)
    expect(takeAbuseBudget).toHaveBeenCalledWith("confirm_email", {
      ip: "203.0.113.7",
    })
    expect(verifyEmailToken).toHaveBeenCalledWith({
      tokenHash: TOKEN,
      type: "email",
    })
    expect(completeEmailAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({ inviteToken: "inv-1", authMethod: "email_link" })
    )
  })

  it("finishes on the code screen when the person has MFA", async () => {
    vi.mocked(completeEmailAuthentication).mockResolvedValue({
      mfaRequired: true,
    } as never)
    const response = await confirmPost({ token_hash: TOKEN, type: "email" })
    expect(location(response).pathname).toBe("/sign-in/verify")
  })

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["an opaque origin", { origin: "null" }],
    ["a cross-site fetch without Origin", { "sec-fetch-site": "cross-site" }],
  ])("refuses %s before looking at the token", async (_name, headers) => {
    const response = await confirmPost(
      { token_hash: TOKEN, type: "email" },
      headers
    )
    expect(response.status).toBe(303)
    const target = location(response)
    expect(target.pathname).toBe("/sign-in")
    expect(target.searchParams.get("status")).toBe("cross_origin_request")
    expect(takeAbuseBudget).not.toHaveBeenCalled()
    expect(verifyEmailToken).not.toHaveBeenCalled()
    expect(completeEmailAuthentication).not.toHaveBeenCalled()
  })

  it("refuses a recovery token, which only the new-password form may spend", async () => {
    const target = location(
      await confirmPost({ token_hash: TOKEN, type: "recovery" })
    )
    expect(target.pathname).toBe("/sign-in")
    expect(verifyEmailToken).not.toHaveBeenCalled()
  })
})
