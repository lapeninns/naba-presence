import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as verify } from "@/app/api/auth/mfa/verify/route"
import { POST as register } from "@/app/api/auth/password/register/route"
import { takeAbuseBudget } from "@/lib/server/abuse-limits"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { readMfaTicketCookie, takeTicketAttempt } from "@/lib/server/mfa"
import {
  challengeAndVerifyFactor,
  signUpWithPassword,
} from "@/lib/server/password-auth"
import type { RouteHandler } from "@/lib/server/route"
import { getSession } from "@/lib/server/session"

/**
 * P02-S8 review fixes: the per-account code budget on verify, and
 * registration never revealing (or half-signing-in) an enrolled identity.
 * The flows end to end are in tests/integration/routes/mfa.test.ts.
 */

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn() })),
}))
vi.mock("@/lib/server/abuse-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/abuse-limits")>()),
  clientIpFromRequest: () => "203.0.113.7",
  takeAbuseBudget: vi.fn(),
}))
vi.mock("@/lib/server/mfa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/mfa")>()),
  readMfaTicketCookie: vi.fn(),
  takeTicketAttempt: vi.fn(),
  clearMfaTicketCookie: vi.fn(),
  discardTicket: vi.fn(),
}))
vi.mock("@/lib/server/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/session")>()),
  getSession: vi.fn(),
}))
vi.mock("@/lib/server/password-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/password-auth")>()),
  challengeAndVerifyFactor: vi.fn(),
  signUpWithPassword: vi.fn(),
}))
vi.mock("@/lib/server/registration", () => ({
  requireRegistrationInvitation: vi.fn(),
}))
vi.mock("@/lib/server/email-auth", () => ({
  completeEmailAuthentication: vi.fn(),
}))

const TICKET = "t".repeat(43)

function post(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function call(handler: RouteHandler, request: Request) {
  return handler(request, { params: Promise.resolve({}) })
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.test")
  vi.stubEnv("PASSWORD_AUTH_ENABLED", "true")
  vi.stubEnv("MFA_ENABLED", "true")
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(null)
})

describe("POST /api/auth/mfa/verify", () => {
  it("counts every attempt against the ticket's account, across tickets", async () => {
    vi.mocked(readMfaTicketCookie).mockResolvedValue(TICKET)
    vi.mocked(takeTicketAttempt).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      purpose: "sign_in",
      authProvider: "supabase",
      authSubject: "subject-1",
      userId: null,
      sessionId: null,
      factorId: null,
      factors: [{ id: "factor-1", friendlyName: null }],
      completion: {},
      providerToken: "provider-token",
      attempts: 1,
    })
    vi.mocked(takeAbuseBudget).mockImplementation(async (scope) => {
      if (scope === "mfa_verify_account") {
        const { abuseLimitedError } = await vi.importActual<
          typeof import("@/lib/server/abuse-limits")
        >("@/lib/server/abuse-limits")
        throw abuseLimitedError(scope, 60)
      }
    })

    const response = await call(verify, post({ code: "123456" }))

    expect(response.status).toBe(429)
    expect(takeAbuseBudget).toHaveBeenCalledWith("mfa_verify_account", {
      account: "supabase:subject-1",
    })
    // Refused before the provider is asked to check the code.
    expect(challengeAndVerifyFactor).not.toHaveBeenCalled()
  })
})

describe("POST /api/auth/password/register", () => {
  it("answers an enrolled identity like a taken address, with no session", async () => {
    vi.mocked(signUpWithPassword).mockResolvedValue({
      identity: {
        provider: "supabase",
        subject: "subject-1",
        email: "owner@example.test",
        displayName: "Owner",
        emailVerified: true,
      },
      confirmationRequired: false,
      factors: [{ id: "factor-1", friendlyName: null }],
    })

    const response = await call(
      register,
      post({
        email: "owner@example.test",
        password: "Correct horse battery 1!",
        displayName: "Owner",
      })
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      authenticated: false,
      confirmationRequired: true,
    })
    expect(completeEmailAuthentication).not.toHaveBeenCalled()
  })

  it("still signs a new identity without factors straight in", async () => {
    vi.mocked(signUpWithPassword).mockResolvedValue({
      identity: {
        provider: "supabase",
        subject: "subject-2",
        email: "new@example.test",
        displayName: "New",
        emailVerified: true,
      },
      confirmationRequired: false,
      factors: [],
    })
    vi.mocked(completeEmailAuthentication).mockResolvedValue({
      mfaRequired: false,
      organisationId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
    })

    const response = await call(
      register,
      post({
        email: "new@example.test",
        password: "Correct horse battery 1!",
        displayName: "New",
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: true })
  })
})
