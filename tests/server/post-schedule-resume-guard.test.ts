import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import { PATCH } from "@/app/api/locations/[id]/post-schedules/[scheduleId]/route"
import { getDatabase } from "@/lib/server/db"
import { MFA_PROOF_MINUTES } from "@/lib/server/mfa"
import { actOnPublicationSchedule } from "@/lib/server/publication-schedules"
import type { Session } from "@/lib/server/session"
import { cookies } from "next/headers"

/**
 * PATCH /api/locations/[id]/post-schedules/[scheduleId] is entitlement-exempt
 * and needs no step-up for pausing and cancelling (they stop queued work),
 * but resuming re-arms an approved publication, so it is held like retrying
 * a bulk batch: a recent two-step verification, then paid access. The
 * schedule logic itself is in tests/integration/routes/post-schedules.test.ts.
 */

vi.mock("next/headers", () => ({ cookies: vi.fn() }))
vi.mock("@/lib/server/db", () => ({
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/publication-schedules", () => ({
  actOnPublicationSchedule: vi.fn(async () => ({ id: "schedule" })),
  revisePublicationSchedule: vi.fn(),
}))

const NOW = new Date("2026-10-12T12:00:00.000Z")
const LOCATION = "11111111-1111-4111-8111-111111111111"
const SCHEDULE = "22222222-2222-4222-8222-222222222222"

const aal1: Session = {
  sessionId: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-000000000001",
  organisationName: "Org",
  workspaceMode: "business",
  displayName: "Owner",
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

const verifiedAt = new Date(NOW.getTime() - 60_000)
const stepped: Session = {
  ...aal1,
  aal: "aal2",
  mfaFactorId: "factor-1",
  mfaVerifiedAt: verifiedAt,
  mfaProofExpiresAt: new Date(
    verifiedAt.getTime() + MFA_PROOF_MINUTES * 60_000
  ),
}

const readOnly: Partial<Session> = {
  entitlementEnforced: true,
  access: {
    mode: "read_only",
    reason: "subscription_ended",
    canWrite: false,
    canUseAi: false,
    locationLimit: 0,
    pendingLocationLimit: null,
    newLinkLimit: 0,
    memberLimit: 0,
    endsAt: null,
  },
}

function signedIn(session: Session) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: "token" }),
  } as never)
  vi.mocked(getDatabase).mockReturnValue({
    begin: vi.fn(async () => session),
  } as never)
}

function act(action: "pause" | "resume" | "cancel") {
  return PATCH(
    new Request(
      `http://localhost/api/locations/${LOCATION}/post-schedules/${SCHEDULE}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      }
    ),
    { params: Promise.resolve({ id: LOCATION, scheduleId: SCHEDULE }) }
  )
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://runtime@example.test/naba")
  vi.stubEnv("NEXTAUTH_SECRET", "n".repeat(32))
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "t".repeat(32))
  vi.stubEnv("CRON_SECRET", "c".repeat(16))
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.test")
  vi.stubEnv("MFA_ENABLED", "true")
})

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("schedule pause, resume and cancel", () => {
  it("asks an aal1 owner to step up before resuming", async () => {
    signedIn(aal1)
    const response = await act("resume")
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: "mfa_step_up_required",
    })
    expect(actOnPublicationSchedule).not.toHaveBeenCalled()
  })

  it("lets an aal1 owner pause or cancel", async () => {
    signedIn(aal1)
    expect((await act("pause")).status).toBe(200)
    expect((await act("cancel")).status).toBe(200)
    expect(actOnPublicationSchedule).toHaveBeenCalledTimes(2)
  })

  it("refuses resuming while read-only, but not pausing or cancelling", async () => {
    signedIn({ ...stepped, ...readOnly })
    const response = await act("resume")
    expect(response.status).toBe(402)
    expect(await response.json()).toMatchObject({ error: "billing_read_only" })
    expect(actOnPublicationSchedule).not.toHaveBeenCalled()
    expect((await act("pause")).status).toBe(200)
    expect((await act("cancel")).status).toBe(200)
  })

  it("resumes for a stepped-up owner with write access", async () => {
    signedIn(stepped)
    expect((await act("resume")).status).toBe(200)
    expect(actOnPublicationSchedule).toHaveBeenCalledWith(
      stepped,
      LOCATION,
      SCHEDULE,
      "resume",
      expect.any(String)
    )
  })
})
