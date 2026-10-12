import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getDatabase, withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import {
  settleWithdrawal,
  withdrawReplies,
  WITHDRAWAL_OUT_OF_TIME,
} from "@/lib/server/privacy/fulfil"
import { runDuePrivacyWithdrawals } from "@/lib/server/privacy/withdrawals"
import { executeReplyDelete } from "@/lib/server/publishing"

// The background withdrawal round under the tick deadline (plan P04-5): a
// round only starts a provider call it has the time to finish, so the tick
// answers inside maxDuration and every round it starts settles.

const GOOGLE_TIMEOUT_MS = 15_000

vi.mock("@/lib/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/db")>()),
  getDatabase: vi.fn(),
  withTenant: vi.fn(),
}))
vi.mock("@/lib/server/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/env")>()),
  getServerEnv: () => ({
    PUBLISH_ENABLED: true,
    GOOGLE_TIMEOUT_MS,
    JOBS_BATCH_SIZE: 25,
    JOBS_PER_ORGANISATION: 5,
  }),
}))
vi.mock("@/lib/server/publishing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/publishing")>()),
  executeReplyDelete: vi.fn(),
}))
vi.mock("@/lib/server/authz/actor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/authz/actor")>()),
  actorScopeFromMembership: vi.fn(async () => ({
    organisationId: "org",
    userId: "owner",
    role: "owner",
  })),
  recheckAuthorisation: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }))

type Query = { text: string; values: unknown[] }

/** Each request owns two reviews whose replies are still live. */
const reviewsOf = (id: string) => [`${id}-review-a`, `${id}-review-b`]

/**
 * A tenant transaction that answers the worker's queries by shape and records
 * every one, so the test can read what was written.
 */
function fakeTenant(queries: Query[]) {
  const answer = (text: string, values: unknown[]): unknown[] => {
    if (text.includes('withdrawal_actor_id::text as "actorUserId"')) {
      return [
        {
          status: "in_progress",
          pendingReviewIds: reviewsOf(String(values[0])),
          actorUserId: "owner",
        },
      ]
    }
    if (text.includes("publish_status not in")) {
      return (values[0] as string[]).map((reviewId) => ({ reviewId }))
    }
    if (text.includes("withdrawal_attempts as attempts")) {
      return [{ status: "in_progress", attempts: 0 }]
    }
    if (text.includes("update privacy_request")) return [{ status: "x" }]
    return []
  }
  const sql = ((strings: unknown, ...values: unknown[]) => {
    if (Array.isArray(strings) && "raw" in strings) {
      const text = strings.join("?")
      queries.push({ text, values })
      return Promise.resolve(Object.assign(answer(text, values), { count: 0 }))
    }
    return { helper: strings }
  }) as unknown as Record<string, unknown>
  sql.unsafe = (fragment: string) => ({ unsafe: fragment })
  return sql
}

let queries: Query[]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"))
  queries = []
  vi.mocked(withTenant).mockImplementation((async (
    _organisationId: string,
    work: (sql: unknown) => unknown
  ) => work(fakeTenant(queries))) as never)
  vi.mocked(executeReplyDelete).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Every provider call takes the full timeout. */
function slowGoogle(result: () => unknown) {
  vi.mocked(executeReplyDelete).mockImplementation(async () => {
    vi.setSystemTime(Date.now() + GOOGLE_TIMEOUT_MS)
    return result() as never
  })
}

describe("privacy withdrawals under the tick deadline", () => {
  it("starts no provider call it cannot finish and hands back unstarted claims", async () => {
    slowGoogle(() => ({ status: "deleted" }))
    let claims = 0
    vi.mocked(getDatabase).mockReturnValue((() => {
      claims += 1
      return Promise.resolve(
        claims === 1
          ? ["one", "two", "three"].map((id) => ({
              organisationId: "org",
              privacyRequestId: id,
            }))
          : []
      )
    }) as never)

    const summary = await runDuePrivacyWithdrawals({
      budgetMs: 3 * GOOGLE_TIMEOUT_MS,
      requestId: "tick",
    })

    // one: both replies fit (t=0, t=15s). two: its first reply starts at
    // t=30s, the second would end past the deadline. three: never started.
    expect(executeReplyDelete).toHaveBeenCalledTimes(3)
    expect(summary).toMatchObject({
      claimed: 3,
      completed: 1,
      deferred: 1,
      released: 1,
      retrying: 0,
      exhausted: 0,
    })
    // No second claim once the budget is gone.
    expect(claims).toBe(1)

    const deferred = queries.find(
      ({ text, values }) =>
        text.includes("update privacy_request") &&
        values.includes(WITHDRAWAL_OUT_OF_TIME)
    )
    // Out of time costs no attempt and is picked up by the next tick.
    expect(deferred?.text).not.toContain("withdrawal_attempts =")
    expect(deferred?.values).toContainEqual(new Date(Date.now()))

    const released = queries.find(({ text }) =>
      text.includes("set withdrawal_lease_expires_at = null\n")
    )
    expect(released?.values[0]).toEqual(["three"])
  })

  it("always tries the first live reply, so a round makes progress or spends an attempt", async () => {
    vi.mocked(executeReplyDelete).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + GOOGLE_TIMEOUT_MS)
      throw new ApiError(502, "google_reply_delete_failed", "Google failed.")
    })
    const reviewIds = reviewsOf("late")
    const removal = await withdrawReplies({
      organisationId: "org",
      actor: { organisationId: "org", userId: "owner" } as never,
      requestId: "req",
      reviewIds,
      // Already past the deadline when the round starts.
      deadline: Date.now() - 1,
    })
    expect(executeReplyDelete).toHaveBeenCalledTimes(1)
    expect(removal.pending).toEqual([
      { reviewId: reviewIds[0], code: "google_reply_delete_failed" },
      { reviewId: reviewIds[1], code: WITHDRAWAL_OUT_OF_TIME },
    ])

    const settlement = await settleWithdrawal({
      organisationId: "org",
      privacyRequestId: "late",
      actorUserId: "owner",
      requestId: "req",
      source: "background",
      reviewIds,
      removal,
    })
    // A real failure in the round spends an attempt and names the failure,
    // not the deferral.
    expect(settlement.outcome).toBe("retry_scheduled")
    const update = queries.find(
      ({ text }) =>
        text.includes("update privacy_request") &&
        text.includes("withdrawal_attempts =")
    )
    expect(update?.values).toContain("google_reply_delete_failed")
    expect(update?.values).not.toContain(WITHDRAWAL_OUT_OF_TIME)
  })
})
