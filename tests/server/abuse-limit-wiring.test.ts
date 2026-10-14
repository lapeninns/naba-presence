import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { POST as login } from "@/app/api/auth/password/login/route"
import { POST as register } from "@/app/api/auth/password/register/route"
import { POST as resend } from "@/app/api/auth/password/resend/route"
import { POST as resetComplete } from "@/app/api/auth/password/reset/complete/route"
import { POST as resetRequest } from "@/app/api/auth/password/reset/request/route"
import {
  GET as lookupInvitation,
  POST as acceptInvitation,
} from "@/app/api/invitations/[token]/route"
import { POST as uploadAsset } from "@/app/api/assets/route"
import { POST as enrollMfa } from "@/app/api/auth/mfa/enroll/route"
import { POST as draft } from "@/app/api/reviews/[id]/drafts/route"
import { GET as discoverAccounts } from "@/app/api/google/accounts/route"
import { GET as discoverLocations } from "@/app/api/google/locations/route"
import { POST as impersonate } from "@/app/api/support/impersonation/route"
import { POST as confirmEmail } from "@/app/auth/confirm/route"
import { abuseLimitedError, takeAbuseBudget } from "@/lib/server/abuse-limits"
import { getDatabase } from "@/lib/server/db"
import { verifyEmailToken } from "@/lib/server/password-auth"
import type { RawParams, RouteHandler } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

/**
 * Each limited entry point names its scope and keys (lib/server/abuse-limits.ts)
 * and answers 429 when refused, before any handler work. The limiter itself
 * is covered by tests/abuse-limits.test.ts and the integration suite; this
 * only proves the wiring, so a route that drops its `limits` line fails here.
 */

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/abuse-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/abuse-limits")>()),
  clientIpFromRequest: () => IP,
  takeAbuseBudget: vi.fn(),
}))
vi.mock("@/lib/server/password-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/password-auth")>()),
  signInWithPassword: vi.fn(),
  verifyEmailToken: vi.fn(),
}))

const IP = "203.0.113.7"
const SECRET = "s".repeat(32)
const REVIEW = "00000000-0000-4000-8000-000000000003"

const session: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000001",
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Test",
  email: "test@example.test",
  role: "owner",
  canPublish: true,
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

function get(path: string) {
  return new Request(`http://localhost${path}`)
}

function call(handler: RouteHandler, req: Request, params: RawParams = {}) {
  return handler(req, { params: Promise.resolve(params) })
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.test")
  vi.stubEnv("PASSWORD_AUTH_ENABLED", "true")
  vi.stubEnv("SUPPORT_IMPERSONATION_ENABLED", "true")
  vi.stubEnv("SUPPORT_IMPERSONATION_SECRET", SECRET)
  vi.stubEnv("MFA_ENABLED", "true")
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => session),
  } as never)
  vi.mocked(takeAbuseBudget).mockImplementation(async (scope) => {
    throw abuseLimitedError(scope, 42)
  })
})

const email = "owner@example.test"

describe.each([
  {
    name: "password login",
    send: () => call(login, post("/x", { email, password: "Password!1" })),
    scope: "login",
    keys: { ip: IP, email },
  },
  {
    name: "registration",
    send: () =>
      call(
        register,
        post("/x", {
          email,
          password: "Correct horse battery 1!",
          displayName: "Owner",
        })
      ),
    scope: "register",
    keys: { ip: IP, email },
  },
  {
    name: "confirmation resend",
    send: () => call(resend, post("/x", { email })),
    scope: "resend_confirmation",
    keys: { ip: IP, email },
  },
  {
    name: "reset request",
    send: () => call(resetRequest, post("/x", { email })),
    scope: "reset_request",
    keys: { ip: IP, email },
  },
  {
    name: "reset completion",
    send: () =>
      call(
        resetComplete,
        post("/x", {
          tokenHash: "h".repeat(40),
          password: "Correct horse battery 1!",
        })
      ),
    scope: "reset_complete",
    keys: { ip: IP, token: "h".repeat(40) },
  },
  {
    name: "invitation lookup",
    send: () =>
      call(lookupInvitation, new Request("http://localhost/x"), {
        token: "invite-token",
      }),
    scope: "invitation_lookup",
    keys: { ip: IP },
  },
  {
    name: "invitation accept",
    send: () =>
      call(acceptInvitation, post("/x", {}), { token: "invite-token" }),
    scope: "invitation_accept",
    keys: { ip: IP, user: session.userId },
  },
  {
    name: "AI draft",
    send: () => call(draft, post("/x", {}), { id: REVIEW }),
    scope: "ai_draft",
    code: "draft_rate_limited",
    keys: {
      ip: IP,
      user: session.userId,
      organisation: session.organisationId,
    },
  },
  {
    name: "MFA enrollment",
    send: () => call(enrollMfa, post("/x", { password: "Password!1" })),
    scope: "mfa_enroll",
    keys: { ip: IP, user: session.userId },
  },
  {
    name: "photo upload start",
    send: () =>
      call(
        uploadAsset,
        post("/x", {
          fileName: "front.jpg",
          contentType: "image/jpeg",
          byteLength: 20_000,
          sha256: "a".repeat(64),
        })
      ),
    scope: "asset_upload",
    code: "asset_rate_limited",
    keys: { user: session.userId, organisation: session.organisationId },
  },
  {
    name: "Google account discovery",
    send: () => call(discoverAccounts, get("/x")),
    scope: "google_discovery",
    code: "discovery_rate_limited",
    keys: { user: session.userId, organisation: session.organisationId },
  },
  {
    name: "Google location discovery",
    send: () => call(discoverLocations, get("/x?account_name=accounts/1")),
    scope: "google_discovery",
    code: "discovery_rate_limited",
    keys: { user: session.userId, organisation: session.organisationId },
  },
])("$name", ({ send, scope, keys, code = "auth_rate_limited" }) => {
  it(`counts against ${scope} and answers 429 when refused`, async () => {
    const response = await send()
    // A body the schema rejects would answer 400 before the limit is taken.
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("42")
    expect(await response.json()).toMatchObject({ error: code })
    expect(takeAbuseBudget).toHaveBeenCalledTimes(1)
    expect(takeAbuseBudget).toHaveBeenCalledWith(
      scope,
      expect.objectContaining(keys)
    )
  })
})

describe("support impersonation", () => {
  const wrongSecret = () =>
    call(
      impersonate,
      post(
        "/x",
        { organisationId: session.organisationId, userId: session.userId },
        { authorization: `Bearer ${"x".repeat(32)}` }
      )
    )

  it("is refused by the limit before the secret is compared", async () => {
    const response = await wrongSecret()
    expect(response.status).toBe(429)
    expect(takeAbuseBudget).toHaveBeenCalledWith("support_impersonation", {
      ip: IP,
    })
  })

  it("counts a wrong secret that is within the limit", async () => {
    vi.mocked(takeAbuseBudget).mockResolvedValue(undefined)
    const response = await wrongSecret()
    expect(response.status).toBe(401)
    expect(takeAbuseBudget).toHaveBeenCalledTimes(1)
  })
})

describe("POST /auth/confirm", () => {
  it("is limited per IP before the token is verified", async () => {
    const response = await confirmEmail(
      new Request("http://localhost/auth/confirm", {
        method: "POST",
        body: new URLSearchParams({ token_hash: "h".repeat(40), type: "email" }),
      })
    )
    expect(takeAbuseBudget).toHaveBeenCalledWith("confirm_email", { ip: IP })
    expect(verifyEmailToken).not.toHaveBeenCalled()
    const location = new URL(response.headers.get("location")!)
    expect(location.pathname).toBe("/sign-in")
    expect(location.searchParams.get("status")).toBe("auth_rate_limited")
  })
})
