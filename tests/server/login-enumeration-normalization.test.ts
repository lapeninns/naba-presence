import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/lib/server/http"
import { signInWithPassword } from "@/lib/server/password-auth"

function gotrue(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeAll(() => {
  // providerConfiguration() requires the full server env schema to parse -
  // stub the mandatory fields plus the password-auth-specific ones so it
  // reaches the stubbed fetch instead of short-circuiting to 503.
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
  vi.stubEnv("PASSWORD_AUTH_ENABLED", "true")
  vi.stubEnv("SUPABASE_URL", "https://auth.example.test")
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "stub-publishable-key")
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("signInWithPassword — enumeration normalisation (D3)", () => {
  it("maps an unverified account to the generic invalid_credentials, not email_not_verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(403, { error_code: "email_not_confirmed" })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.code).toBe("invalid_credentials")
  })

  it("maps a token success whose user is unverified to invalid_credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(200, {
      access_token: "a", refresh_token: "r",
      user: { id: "u1", email: "real@x.test", email_confirmed_at: null, confirmed_at: null },
    })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error.status).toBe(401)
    expect(error.code).toBe("invalid_credentials")
  })

  it("maps a provider 429 to invalid_credentials (no 429 timing channel on login)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(429, { error_code: "over_request_rate_limit" })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error.status).toBe(401)
    expect(error.code).toBe("invalid_credentials")
  })

  it("still surfaces genuine availability failures (503) — not an enumeration channel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => gotrue(503, { error_code: "auth_provider_down" })))
    const error = (await signInWithPassword("real@x.test", "pw").catch((e) => e)) as ApiError
    expect(error.status).toBe(503)
  })
})
