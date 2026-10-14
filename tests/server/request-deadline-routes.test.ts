import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

/**
 * The request deadline in the two routes that loop over provider work
 * inside one request (W3-4 a/b, WP-04): the manual backfill stops starting
 * locations once a whole Google call no longer fits and names the ones it
 * did not reach; the per-row bulk approve skips the rows it has no time for
 * (`bulk_time_budget_reached`) instead of being killed mid-publish.
 */

const GOOGLE_TIMEOUT_MS = 15_000
const GOOGLE_MUTATION_TIMEOUT_MS = 20_000

const syncLinkedLocation = vi.fn()
const recordApprovalDecision = vi.fn()
const completeApproval = vi.fn()

vi.mock("@/lib/server/route", () => ({
  route: (config: unknown) => config,
}))
vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({ GOOGLE_TIMEOUT_MS, GOOGLE_MUTATION_TIMEOUT_MS }),
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/server/pause-controls", () => ({
  requireScopesEnabled: async () => undefined,
}))
vi.mock("@/lib/server/mfa", () => ({ requireRecentMfa: () => undefined }))
vi.mock("@/lib/server/reviews", () => ({
  linkedLocations: async () => [
    { externalLocationId: "loc-1" },
    { externalLocationId: "loc-2" },
    { externalLocationId: "loc-3" },
  ],
  syncLinkedLocation: (...args: unknown[]) => syncLinkedLocation(...args),
}))
vi.mock("@/lib/server/bulk-reviews", () => ({
  bulkReviewEngineEnabled: async () => false,
  startBulkReviewApprovals: vi.fn(),
  startBulkTemplateReplies: vi.fn(),
}))
vi.mock("@/lib/server/review-approval", () => ({
  recordApprovalDecision: (...args: unknown[]) =>
    recordApprovalDecision(...args),
  completeApproval: (...args: unknown[]) => completeApproval(...args),
}))

import { POST as backfill } from "@/app/api/sync/backfill/route"
import { POST as bulk } from "@/app/api/reviews/bulk/route"

type Handler = (ctx: Record<string, unknown>) => Promise<unknown>
const handlerOf = (config: unknown) => (config as { handler: Handler }).handler

/** A tenant whose transaction answers every query with no rows. */
const sql = (async () => []) as never
const tenant = async (fn: (s: never) => unknown) => fn(sql)
const session = {
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-00000000000a",
  role: "owner",
}

const NOW = 1_000_000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  vi.clearAllMocks()
})

describe("manual backfill deadline", () => {
  const request = () =>
    new Request("http://localhost/api/sync/backfill", {
      method: "POST",
      body: JSON.stringify({ maxPagesPerLocation: 5 }),
    })

  it("passes a page deadline that leaves a whole Google call before the request's", async () => {
    syncLinkedLocation.mockResolvedValue({
      status: "succeeded",
      pages: 1,
      upserted: 0,
      hasMore: false,
    })
    const deadline = NOW + 55_000
    const result = (await handlerOf(backfill)({
      request: request(),
      session,
      requestId: "request-1",
      clientRequestId: null,
      tenant,
      deadline,
    })) as { notStartedExternalLocationIds: string[] }
    expect(syncLinkedLocation).toHaveBeenCalledTimes(3)
    expect(syncLinkedLocation.mock.calls[0][0]).toMatchObject({
      deadline: deadline - GOOGLE_TIMEOUT_MS,
    })
    expect(result.notStartedExternalLocationIds).toEqual([])
  })

  it("stops starting locations at the deadline and reports the rest", async () => {
    const deadline = NOW + 55_000
    // The first location uses up the time a further page would need.
    syncLinkedLocation.mockImplementation(async () => {
      vi.setSystemTime(deadline - GOOGLE_TIMEOUT_MS)
      return { status: "partial", pages: 3, upserted: 30, hasMore: true }
    })
    const result = (await handlerOf(backfill)({
      request: request(),
      session,
      requestId: "request-1",
      clientRequestId: null,
      tenant,
      deadline,
    })) as {
      batches: { externalLocationIds: string[]; status: string }[]
      notStartedExternalLocationIds: string[]
    }
    expect(syncLinkedLocation).toHaveBeenCalledTimes(1)
    expect(result.batches).toEqual([
      expect.objectContaining({
        externalLocationIds: ["loc-1"],
        status: "partial",
      }),
    ])
    expect(result.notStartedExternalLocationIds).toEqual(["loc-2", "loc-3"])
  })
})

describe("per-row bulk approve deadline", () => {
  const approvals = ["r1", "r2", "r3"].map((reviewId) => ({
    reviewId,
    draftId: "00000000-0000-4000-8000-0000000000d1",
    reviewUpdateTime: "2026-10-01T00:00:00.000Z",
  }))

  it("skips the rows a whole publish no longer fits before the deadline", async () => {
    const deadline = NOW + 115_000
    const rowBudget = GOOGLE_MUTATION_TIMEOUT_MS + GOOGLE_TIMEOUT_MS
    recordApprovalDecision.mockResolvedValue({ decision: "approve" })
    // Each publish takes long enough that only two rows fit.
    completeApproval.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + rowBudget + 10_000)
      return { status: "published" }
    })
    const result = (await handlerOf(bulk)({
      session,
      body: { action: "approve", approvals },
      requestId: "request-1",
      clientRequestId: null,
      tenant,
      deadline,
    })) as { results: { reviewId: string; status: string; code?: string }[] }
    expect(completeApproval).toHaveBeenCalledTimes(2)
    expect(result.results).toEqual([
      { reviewId: "r1", status: "ok" },
      { reviewId: "r2", status: "ok" },
      {
        reviewId: "r3",
        status: "skipped",
        code: "bulk_time_budget_reached",
      },
    ])
    // Nothing was recorded for the skipped row.
    expect(recordApprovalDecision).toHaveBeenCalledTimes(2)
  })
})
