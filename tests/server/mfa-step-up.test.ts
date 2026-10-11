import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { getDatabase, withTenant } from "@/lib/server/db"
import {
  authorisationAssurance,
  MFA_PROOF_MINUTES,
  mfaStepUpRefusal,
  requireRecentMfa,
} from "@/lib/server/mfa"
import { route, type RouteHandler } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

/**
 * P02-S9 step-up: the rule (owners and admins need an aal2 proof from the
 * last 15 minutes before a sensitive action) and `route({ mfa: "step_up" })`.
 * The routes end to end are in tests/integration/routes/mfa-step-up.test.ts;
 * which routes declare it is pinned by tests/mfa-step-up-contract.test.ts.
 */

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))

const NOW = new Date("2026-10-11T12:00:00.000Z")
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000)

const base: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000001",
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Test",
  email: "owner@example.test",
  role: "owner",
  canPublish: true,
  aal: "aal1",
  mfaFactorId: null,
  mfaVerifiedAt: null,
  mfaProofExpiresAt: null,
  securityVersion: 1,
  mfaFactorCount: 1,
}

function verified(minutes: number, overrides: Partial<Session> = {}): Session {
  const verifiedAt = minutesAgo(minutes)
  return {
    ...base,
    aal: "aal2",
    mfaFactorId: "factor-1",
    mfaVerifiedAt: verifiedAt,
    mfaProofExpiresAt: new Date(
      verifiedAt.getTime() + MFA_PROOF_MINUTES * 60_000
    ),
    ...overrides,
  }
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.test")
  vi.stubEnv("MFA_ENABLED", "true")
})

describe("mfaStepUpRefusal", () => {
  const at = { now: NOW }

  it("asks an unenrolled owner or admin to enroll", () => {
    expect(mfaStepUpRefusal({ ...base, mfaFactorCount: 0 }, at)).toBe(
      "mfa_enrollment_required"
    )
    expect(
      mfaStepUpRefusal({ ...base, role: "admin", mfaFactorCount: 0 }, at)
    ).toBe("mfa_enrollment_required")
  })

  it("asks an enrolled manager on an aal1 session to step up", () => {
    // Every session from before 0200 is aal1.
    expect(mfaStepUpRefusal(base, at)).toBe("mfa_step_up_required")
    expect(mfaStepUpRefusal({ ...base, aal: undefined }, at)).toBe(
      "mfa_step_up_required"
    )
  })

  it("accepts a code verified within the last 15 minutes", () => {
    expect(mfaStepUpRefusal(verified(0), at)).toBeNull()
    expect(mfaStepUpRefusal(verified(14), at)).toBeNull()
  })

  it("refuses an aal2 proof older than 15 minutes", () => {
    expect(mfaStepUpRefusal(verified(16), at)).toBe("mfa_step_up_required")
    // The session's own expiry counts even when the age would pass.
    expect(
      mfaStepUpRefusal(verified(1, { mfaProofExpiresAt: minutesAgo(0) }), at)
    ).toBe("mfa_step_up_required")
    // A caller may ask for a shorter window.
    expect(mfaStepUpRefusal(verified(6), { ...at, maxAgeMinutes: 5 })).toBe(
      "mfa_step_up_required"
    )
  })

  it("refuses an aal2 session missing its proof timestamps", () => {
    expect(mfaStepUpRefusal({ ...verified(1), mfaVerifiedAt: null }, at)).toBe(
      "mfa_step_up_required"
    )
    expect(
      mfaStepUpRefusal({ ...verified(1), mfaProofExpiresAt: null }, at)
    ).toBe("mfa_step_up_required")
  })

  it("refuses a verification dated in the future", () => {
    expect(
      mfaStepUpRefusal(
        verified(0, { mfaVerifiedAt: new Date(NOW.getTime() + 10 * 60_000) }),
        at
      )
    ).toBe("mfa_step_up_required")
  })

  it("never holds members or viewers to it", () => {
    for (const role of ["member", "viewer"] as const) {
      expect(
        mfaStepUpRefusal({ ...base, role, mfaFactorCount: 0 }, at)
      ).toBeNull()
    }
  })

  it("throws the 403 the step-up prompt keys on", () => {
    expect(() => requireRecentMfa(base, at)).toThrow(
      expect.objectContaining({ status: 403, code: "mfa_step_up_required" })
    )
    expect(() => requireRecentMfa({ ...base, mfaFactorCount: 0 }, at)).toThrow(
      expect.objectContaining({
        status: 403,
        code: "mfa_enrollment_required",
        details: { enrollPath: "/settings/security" },
      })
    )
    expect(() => requireRecentMfa(verified(2), at)).not.toThrow()
  })
})

describe("authorisationAssurance", () => {
  it("records aal2 with its verification time", () => {
    const session = verified(3)
    expect(authorisationAssurance(session)).toEqual({
      aal: "aal2",
      mfaVerifiedAt: session.mfaVerifiedAt,
      securityVersion: 1,
    })
  })

  it("records aal1 without a verification time, and no version when unknown", () => {
    expect(
      authorisationAssurance({
        aal: "aal1",
        mfaVerifiedAt: minutesAgo(1),
        securityVersion: undefined,
      })
    ).toEqual({ aal: "aal1", mfaVerifiedAt: null, securityVersion: null })
  })
})

describe('route({ mfa: "step_up" })', () => {
  function signedIn(value: Session) {
    vi.mocked(cookies).mockResolvedValue({
      get: () => ({ value: "token" }),
    } as never)
    vi.mocked(getDatabase).mockReturnValue({
      begin: vi.fn(async () => value),
    } as never)
  }

  function call(handler: RouteHandler, method = "POST") {
    return handler(
      new Request("http://localhost/api/test", {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      }),
      { params: Promise.resolve({}) }
    )
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
    vi.mocked(withTenant).mockImplementation(async (_org, fn) =>
      fn("sql" as never)
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("refuses an aal1 owner before the handler runs", async () => {
    signedIn(base)
    const handler = vi.fn(async () => ({ ok: true }))
    const response = await call(route({ mfa: "step_up", handler }))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "mfa_step_up_required",
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it("refuses a stale aal2 owner and admits a fresh one", async () => {
    signedIn(verified(20))
    expect(
      (await call(route({ mfa: "step_up", handler: () => ({ ok: true }) })))
        .status
    ).toBe(403)
    signedIn(verified(5))
    expect(
      (await call(route({ mfa: "step_up", handler: () => ({ ok: true }) })))
        .status
    ).toBe(200)
  })

  it("leaves routes without it, and members, alone", async () => {
    signedIn(base)
    expect(
      (await call(route({ handler: () => ({ ok: true }) }), "GET")).status
    ).toBe(200)
    signedIn({ ...base, role: "member" })
    expect(
      (await call(route({ mfa: "step_up", handler: () => ({ ok: true }) })))
        .status
    ).toBe(200)
  })

  it("is checked after the role gate", async () => {
    signedIn({ ...base, role: "viewer" })
    const response = await call(
      route({
        roles: ["owner", "admin"],
        mfa: "step_up",
        handler: () => ({ ok: true }),
      })
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: "permission_denied" })
  })
})

describe("with MFA_ENABLED off", () => {
  it("never refuses", async () => {
    vi.resetModules()
    vi.stubEnv("MFA_ENABLED", "false")
    const mfa = await import("@/lib/server/mfa")
    expect(
      mfa.mfaStepUpRefusal({ ...base, mfaFactorCount: 0 }, { now: NOW })
    ).toBeNull()
    expect(mfa.mfaStepUpRefusal(base, { now: NOW })).toBeNull()
  })
})
