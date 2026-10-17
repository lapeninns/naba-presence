import { createHash } from "node:crypto"

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as login } from "@/app/api/auth/password/login/route"
import { POST as register } from "@/app/api/auth/password/register/route"
import { POST as resetComplete } from "@/app/api/auth/password/reset/complete/route"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import {
  signInWithPassword,
  signUpWithPassword,
  updatePasswordWithToken,
  verifyEmailToken,
} from "@/lib/server/password-auth"
import type { RouteHandler } from "@/lib/server/route"

/**
 * The register route (sign-up and invitation registration) and the reset
 * route refuse a breached new password before the provider is asked, and fail
 * open when Pwned Passwords is down. Sign-in never checks: existing passwords
 * keep working. The checker itself is in tests/server/breached-password.test.ts.
 */

vi.mock("@/lib/server/password-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/password-auth")>()),
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  verifyEmailToken: vi.fn(),
  updatePasswordWithToken: vi.fn(),
}))
vi.mock("@/lib/server/email-auth", () => ({
  completeEmailAuthentication: vi.fn(),
}))

const PASSWORD = "correct horse battery staple"
const SUFFIX = createHash("sha1")
  .update(PASSWORD, "utf8")
  .digest("hex")
  .toUpperCase()
  .slice(5)
const BREACHED = () => new Response(`${SUFFIX}:42\r\n`, { status: 200 })

function post(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function call(handler: RouteHandler, req: Request) {
  return handler(req, { params: Promise.resolve({}) })
}

const registration = {
  email: "owner@example.test",
  password: PASSWORD,
  displayName: "Owner",
}
const reset = { tokenHash: "h".repeat(40), password: PASSWORD }

let fetchMock: ReturnType<typeof vi.fn>

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.test")
  vi.stubEnv("PASSWORD_AUTH_ENABLED", "true")
  vi.stubEnv("ABUSE_LIMITS_ENABLED", "false")
  // BREACHED_PASSWORD_CHECK_ENABLED left unset: the check is on by default.
})

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.mocked(signUpWithPassword).mockResolvedValue({
    identity: null,
    confirmationRequired: true,
    factors: [],
  })
  vi.mocked(verifyEmailToken).mockResolvedValue({
    identity: {
      provider: "supabase",
      subject: "subject",
      email: "owner@example.test",
      displayName: "Owner",
      emailVerified: true,
    },
    accessToken: "access",
    factors: [],
  })
  vi.mocked(completeEmailAuthentication).mockResolvedValue({
    mfaRequired: false,
  } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function expectBreachedFieldError(response: Response) {
  expect(response.status).toBe(400)
  const body = await response.json()
  expect(body.error).toBe("invalid_request")
  expect(body.fieldErrors.password).toMatch(/known data breach/)
  expect(body.details).toEqual([
    expect.objectContaining({ path: ["password"], code: "password_breached" }),
  ])
}

describe("registration", () => {
  it("refuses a breached password before the provider creates anything", async () => {
    fetchMock.mockResolvedValue(BREACHED())
    await expectBreachedFieldError(await call(register, post(registration)))
    expect(signUpWithPassword).not.toHaveBeenCalled()
  })

  it("fails open: an unavailable check lets sign-up go ahead", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"))
    const response = await call(register, post(registration))
    expect(response.status).toBe(202)
    expect(signUpWithPassword).toHaveBeenCalledTimes(1)
  })

  it("refuses 14 characters and accepts 15 (code points)", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }))
    const short = await call(
      register,
      post({ ...registration, password: "a".repeat(14) })
    )
    expect(short.status).toBe(400)
    expect((await short.json()).fieldErrors.password).toBe(
      "Use at least 15 characters."
    )
    const enough = await call(
      register,
      post({ ...registration, password: "🚀".repeat(15) })
    )
    expect(enough.status).toBe(202)
  })
})

describe("password reset", () => {
  it("refuses a breached password before spending the link", async () => {
    fetchMock.mockResolvedValue(BREACHED())
    await expectBreachedFieldError(await call(resetComplete, post(reset)))
    expect(verifyEmailToken).not.toHaveBeenCalled()
    expect(updatePasswordWithToken).not.toHaveBeenCalled()
  })

  it("fails open: an unavailable check lets the reset go ahead", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 503 }))
    const response = await call(resetComplete, post(reset))
    expect(response.status).toBe(200)
    expect(updatePasswordWithToken).toHaveBeenCalledWith("access", PASSWORD)
  })
})

describe("sign-in", () => {
  it("never checks an existing password, however short or breached", async () => {
    vi.mocked(signInWithPassword).mockRejectedValue(new Error("stop here"))
    await call(
      login,
      post({ email: "owner@example.test", password: "Password!12" })
    )
    expect(signInWithPassword).toHaveBeenCalledWith(
      "owner@example.test",
      "Password!12"
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
