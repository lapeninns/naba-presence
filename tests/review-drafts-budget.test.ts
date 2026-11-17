import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

/**
 * The AI draft's time budget and credit ordering (W3-4 / R2B-05, WP-04),
 * with every collaborator faked: the credit is charged only in the
 * transaction that stores the draft, any throw after the provider call
 * releases it, and the semantic pass is skipped (draft left `pending`) when
 * the request deadline leaves too little time for it. The same ordering is
 * proven against Postgres in
 * tests/integration/routes/ai-draft-credit-order.test.ts.
 */

const events: string[] = []
const USAGE = { inputTokens: 100, outputTokens: 20 }

const generateReply = vi.fn()
const runSemanticVerification = vi.fn()
const verifyStoredDraft = vi.fn()
const settleDraftCredit = vi.fn()
const releaseDraftCredit = vi.fn()
const finishVerifyUsage = vi.fn()

vi.mock("@/lib/server/env", () => ({
  getServerEnv: () => ({
    OPENAI_MODEL_DRAFT: "draft-model",
    OPENAI_MODEL_VERIFY: "verify-model",
    OPENAI_TIMEOUT_MS: 30_000,
  }),
}))
vi.mock("@/lib/server/pause-controls", () => ({
  requireScopesEnabled: async () => undefined,
}))
vi.mock("@/lib/server/permissions", () => ({
  requireLocationAccess: async () => undefined,
}))
vi.mock("@/lib/server/audit", () => ({ writeAudit: async () => undefined }))
vi.mock("@/lib/server/mutation-operations", () => ({
  requestScopedKeyPart: (requestId: string) => requestId,
  intentConflict: () => new Error("intent conflict"),
}))
vi.mock("@/lib/server/ai", () => ({
  AiOutputError: class extends Error {},
  generateReply: (...args: unknown[]) => generateReply(...args),
  semanticVerificationEnabled: () => true,
}))
vi.mock("@/lib/server/ai-credits", () => ({
  reserveDraftCredit: async () => ({ kind: "reserved", id: "credit-1" }),
  settleDraftCredit: (...args: unknown[]) => {
    events.push("settle")
    return settleDraftCredit(...args)
  },
  releaseDraftCredit: (...args: unknown[]) => {
    events.push("release")
    return releaseDraftCredit(...args)
  },
}))
vi.mock("@/lib/server/ai-usage", () => ({
  reserveVerifyUsage: async () => ({ id: "verify-1" }),
  finishVerifyUsage: (...args: unknown[]) => finishVerifyUsage(...args),
}))
vi.mock("@/lib/server/drafts", () => ({
  SEMANTIC_UNAVAILABLE: { code: "semantic_verification_unavailable" },
  buildEvidenceHash: () => "evidence",
  runSemanticVerification: (...args: unknown[]) =>
    runSemanticVerification(...args),
  verifyStoredDraft: (...args: unknown[]) => verifyStoredDraft(...args),
}))

import {
  createReviewDraft,
  MIN_VERIFY_MS,
  PHASE_THREE_RESERVE_MS,
} from "@/lib/server/review-drafts"

const REVIEW_ID = "00000000-0000-4000-8000-0000000000b1"
const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1"

const reviewRow = {
  review_text: "Lovely evening.",
  rating: 5,
  reviewer_name: "Sam",
  language: "en",
  language_confidence: 0.9,
  default_language: "en",
  location_id: "00000000-0000-4000-8000-0000000000c1",
  location_name: "The Bell",
  update_time: new Date("2026-10-01T00:00:00Z"),
  restricted_at: null,
  workflow_status: "new",
}

/** A postgres.js tagged template that answers the queries this flow makes. */
const sql = (async (strings: TemplateStringsArray) => {
  const text = strings.join("?")
  if (text.includes("from review r")) return [reviewRow]
  if (text.includes("insert into draft")) {
    events.push("insert draft")
    return [{ id: DRAFT_ID }]
  }
  return []
}) as never
const tenant = (async (fn: (s: never) => unknown) => fn(sql)) as never

const session = {
  userId: "00000000-0000-4000-8000-000000000002",
  organisationId: "00000000-0000-4000-8000-00000000000a",
} as never

function draft(deadline?: number) {
  return createReviewDraft({
    session,
    reviewId: REVIEW_ID,
    input: {} as never,
    requestId: "request-1",
    tenant,
    draftId: DRAFT_ID,
    deadline,
  })
}

const NOW = 1_000_000

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  events.length = 0
  vi.clearAllMocks()
  generateReply.mockResolvedValue({
    reply: "Thank you, Sam.",
    language: "en",
    usage: USAGE,
    model: "draft-model",
  })
  runSemanticVerification.mockResolvedValue({ status: "ran", reasons: [] })
  verifyStoredDraft.mockResolvedValue({
    id: "verification-1",
    verdict: "pass",
    reasons: [],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("createReviewDraft time budget and credit ordering", () => {
  it("charges the credit after the draft is stored, in the same transaction", async () => {
    const result = await draft(NOW + 55_000)
    expect(result.draftId).toBe(DRAFT_ID)
    expect(events).toEqual(["insert draft", "settle"])
    expect(settleDraftCredit).toHaveBeenCalledWith(sql, {
      id: "credit-1",
      usage: USAGE,
      model: "draft-model",
      draftId: DRAFT_ID,
    })
    expect(releaseDraftCredit).not.toHaveBeenCalled()
  })

  it("sizes each provider call to the deadline, keeping phase three's time back", async () => {
    const deadline = NOW + 55_000
    await draft(deadline)
    expect(generateReply.mock.calls[0][1]).toEqual({
      deadline,
      reserveMs: PHASE_THREE_RESERVE_MS,
    })
    expect(runSemanticVerification.mock.calls[0][1]).toEqual({
      deadline,
      reserveMs: PHASE_THREE_RESERVE_MS,
    })
  })

  it("releases the held credit, with its tokens, when phase three throws", async () => {
    verifyStoredDraft.mockRejectedValue(new Error("connection reset"))
    await expect(draft(NOW + 55_000)).rejects.toThrow("connection reset")
    expect(settleDraftCredit).not.toHaveBeenCalled()
    expect(releaseDraftCredit).toHaveBeenCalledWith(tenant, {
      id: "credit-1",
      usage: USAGE,
    })
  })

  it("releases the held credit when verification throws after generation", async () => {
    runSemanticVerification.mockRejectedValue(new Error("schema drift"))
    await expect(draft(NOW + 55_000)).rejects.toThrow("schema drift")
    expect(events).toEqual(["release"])
    expect(releaseDraftCredit).toHaveBeenCalledWith(tenant, {
      id: "credit-1",
      usage: USAGE,
    })
  })

  it("skips verification and stores the draft pending when time is short", async () => {
    const deadline = NOW + 55_000
    // Generation returns with less than phase three plus a verify pass left.
    generateReply.mockImplementation(async () => {
      vi.setSystemTime(deadline - (PHASE_THREE_RESERVE_MS + MIN_VERIFY_MS) + 1)
      return {
        reply: "Thank you, Sam.",
        language: "en",
        usage: USAGE,
        model: "draft-model",
      }
    })
    verifyStoredDraft.mockResolvedValue({
      id: "verification-1",
      verdict: "pending",
      reasons: [],
    })
    const result = await draft(deadline)
    expect(result.draftId).toBe(DRAFT_ID)
    expect(runSemanticVerification).not.toHaveBeenCalled()
    expect(verifyStoredDraft.mock.calls[0][1].semantic).toEqual({
      status: "unavailable",
      reasons: [{ code: "semantic_verification_unavailable" }],
    })
    // The verify reservation is released (no usage); the draft is charged once.
    expect(finishVerifyUsage).toHaveBeenCalledWith(tenant, {
      id: "verify-1",
      usage: undefined,
      model: undefined,
    })
    expect(events).toEqual(["insert draft", "settle"])
  })
})

describe("createReviewDraft corrects a reply the checks refuse", () => {
  const blocked = {
    status: "ran",
    usage: { inputTokens: 50, outputTokens: 5 },
    model: "verify-model",
    reasons: [
      {
        code: "unsupported_claim",
        severity: "fail",
        message: "“the lamb shank”: The review does not say this.",
      },
    ],
  }
  const clean = {
    status: "ran",
    usage: { inputTokens: 50, outputTokens: 5 },
    model: "verify-model",
    reasons: [],
  }

  it("rewrites with the findings, charges one credit and stores the corrected reply", async () => {
    generateReply
      .mockResolvedValueOnce({
        reply: "Thanks, Sam. Glad the lamb shank went down well.",
        language: "en",
        usage: USAGE,
        model: "draft-model",
      })
      .mockResolvedValueOnce({
        reply: "Thanks, Sam. Glad you had a good evening with us.",
        language: "en",
        usage: USAGE,
        model: "draft-model",
      })
    runSemanticVerification
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(clean)
    const result = await draft(NOW + 55_000)
    expect(result.body).toBe(
      "Thanks, Sam. Glad you had a good evening with us."
    )
    expect(generateReply).toHaveBeenCalledTimes(2)
    // The correction pass is told what was wrong with the first reply.
    expect(generateReply.mock.calls[0][0].correction).toBeNull()
    expect(generateReply.mock.calls[1][0].correction).toEqual({
      previousReply: "Thanks, Sam. Glad the lamb shank went down well.",
      problems: ["“the lamb shank”: The review does not say this."],
    })
    // One credit, carrying the tokens of both generations.
    expect(settleDraftCredit).toHaveBeenCalledTimes(1)
    expect(settleDraftCredit.mock.calls[0][1].usage).toEqual({
      inputTokens: 200,
      outputTokens: 40,
    })
    expect(finishVerifyUsage).toHaveBeenCalledWith(tenant, {
      id: "verify-1",
      usage: { inputTokens: 100, outputTokens: 10 },
      model: "verify-model",
    })
    expect(verifyStoredDraft.mock.calls[0][1].semantic.reasons).toEqual([])
  })

  it("stops after three attempts and stores the reply with its failing verdict", async () => {
    runSemanticVerification.mockResolvedValue(blocked)
    verifyStoredDraft.mockResolvedValue({
      id: "verification-1",
      verdict: "fail",
      reasons: blocked.reasons,
    })
    const result = await draft(NOW + 600_000)
    expect(generateReply).toHaveBeenCalledTimes(3)
    expect(runSemanticVerification).toHaveBeenCalledTimes(3)
    // Never shown as passed: the stored verdict is the failing one.
    expect(verifyStoredDraft.mock.calls[0][1].semantic.reasons).toEqual(
      blocked.reasons
    )
    expect(result.verification.verdict).toBe("fail")
    expect(settleDraftCredit).toHaveBeenCalledTimes(1)
  })

  it("does not start a correction it has no time to finish", async () => {
    runSemanticVerification.mockResolvedValue(blocked)
    await draft(NOW + 20_000)
    expect(generateReply).toHaveBeenCalledTimes(1)
  })

  it("rewrites a reply the rule checks refuse without paying for the AI pass", async () => {
    generateReply
      .mockResolvedValueOnce({
        reply: "The reviewer enjoyed a lovely evening and will return soon.",
        language: "en",
        usage: USAGE,
        model: "draft-model",
      })
      .mockResolvedValueOnce({
        reply: "Thanks, Sam. Glad you had a good evening with us.",
        language: "en",
        usage: USAGE,
        model: "draft-model",
      })
    runSemanticVerification.mockResolvedValue(clean)
    const result = await draft(NOW + 55_000)
    expect(result.body).toBe(
      "Thanks, Sam. Glad you had a good evening with us."
    )
    expect(runSemanticVerification).toHaveBeenCalledTimes(1)
    expect(generateReply.mock.calls[1][0].correction.problems[0]).toContain(
      "talks about the guest instead of to them"
    )
  })

  it("answers a rating-only review from the template, still through the AI pass", async () => {
    const original = reviewRow.review_text
    reviewRow.review_text = null as never
    try {
      runSemanticVerification.mockResolvedValue(clean)
      const result = await draft(NOW + 55_000)
      expect(result.body).toBe(
        "Hi Sam, thank you for the rating. Good to know you enjoyed your visit."
      )
      expect(generateReply).not.toHaveBeenCalled()
      // A template is never rewritten by the model, and is never exempt
      // from verification.
      expect(runSemanticVerification).toHaveBeenCalledTimes(1)
      expect(verifyStoredDraft.mock.calls[0][1].semantic.status).toBe("ran")
    } finally {
      reviewRow.review_text = original
    }
  })
})
