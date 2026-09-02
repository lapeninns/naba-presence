import { describe, expect, it } from "vitest"

import { GoogleMutationAmbiguousError } from "@/lib/server/google/transport"
import { ApiError } from "@/lib/server/http"
import {
  classifyProviderFailure,
  decideRecovery,
  executePublish,
  executeReplyDelete,
  googleReplyFromReview,
  googleReplyMatches,
  parseGoogleReply,
  parseGoogleReview,
  recoverAttempt,
  retryPublishAttempt,
  writePublishAttemptEvent,
} from "@/lib/server/publishing"

// The reply pipeline's pure phases (docs/architecture.md, "Three-phase reply
// mutation and recovery"): provider-failure classification, the recovery
// decision, and the Google reply readers. The database-backed phases are
// covered by tests/integration/routes/publish-lifecycle.test.ts.

describe("publishing barrel", () => {
  it("keeps the public pipeline entry points", () => {
    for (const fn of [
      executePublish,
      executeReplyDelete,
      retryPublishAttempt,
      recoverAttempt,
      writePublishAttemptEvent,
      googleReplyFromReview,
      googleReplyMatches,
    ]) {
      expect(typeof fn).toBe("function")
    }
  })
})

describe("classifyProviderFailure", () => {
  it("keeps an ambiguous provider write distinct from rejection", () => {
    const failure = classifyProviderFailure(
      new GoogleMutationAmbiguousError(),
      1
    )
    expect(failure.status).toBe("ambiguous")
    expect(failure.ambiguous).toBe(true)
    expect(failure.retryable).toBe(false)
    expect(failure.terminal).toBe(false)
    expect(failure.nextAttemptAt).toBeNull()
    expect(failure.httpStatus).toBe(502)
    expect(failure.errorCode).toBe("google_mutation_ambiguous")
  })

  it("schedules a 429 for retry with back-off and no local failure", () => {
    const before = Date.now()
    const failure = classifyProviderFailure(
      new ApiError(429, "google_rate_limited", "slow down"),
      2
    )
    expect(failure.status).toBe("retryable")
    expect(failure.terminal).toBe(false)
    expect(failure.httpStatus).toBe(429)
    expect(failure.errorCode).toBe("google_rate_limited")
    expect(failure.nextAttemptAt).toBeInstanceOf(Date)
    expect((failure.nextAttemptAt as Date).getTime()).toBeGreaterThan(before)
  })

  // conflicts.md C5: a reply queued behind a revoked or expired Google grant
  // must not be failed terminally -- reconnecting is a person closing a task,
  // and a terminal settle is not undone by it. It parks on its own 15-minute
  // window rather than the 500ms-30s provider back-off, which would only spin
  // the queue against a door that is not going to open inside a tick.
  it.each([
    [401, "google_reconnect_required"],
    [503, "google_token_unavailable"],
    [404, "connection_not_found"],
  ])("parks a connection-blocked %i %s instead of failing it", (status, code) => {
    const before = Date.now()
    const failure = classifyProviderFailure(new ApiError(status, code, "no"), 3)
    expect(failure.status).toBe("retryable")
    expect(failure.retryable).toBe(true)
    expect(failure.terminal).toBe(false)
    expect(failure.ambiguous).toBe(false)
    expect(failure.errorCode).toBe(code)
    const wait = (failure.nextAttemptAt as Date).getTime() - before
    // Roughly 15 minutes, and unambiguously outside the provider back-off band.
    expect(wait).toBeGreaterThan(14 * 60_000)
    expect(wait).toBeLessThanOrEqual(15 * 60_000)
  })

  it("treats any other provider rejection as terminal", () => {
    const failure = classifyProviderFailure(
      new ApiError(400, "google_invalid_argument", "bad reply"),
      1
    )
    expect(failure.status).toBe("failed")
    expect(failure.terminal).toBe(true)
    expect(failure.nextAttemptAt).toBeNull()
    expect(failure.httpStatus).toBe(400)
    expect(failure.errorCode).toBe("google_invalid_argument")
  })

  it("records non-API errors (and a missing response) as network_error", () => {
    expect(
      classifyProviderFailure(new Error("socket hang up"), 1)
    ).toMatchObject({
      status: "failed",
      terminal: true,
      httpStatus: null,
      errorCode: "network_error",
    })
    expect(classifyProviderFailure(undefined, 1)).toMatchObject({
      status: "failed",
      errorCode: "network_error",
    })
  })
})

describe("decideRecovery", () => {
  const withReply = (comment: string) =>
    parseGoogleReview({
      reviewReply: { comment, updateTime: "2026-08-20T10:00:00Z" },
    })
  const withoutReply = parseGoogleReview({ reviewId: "stub" })

  it("settles a delete by the presence of a live reply", () => {
    const context = { operation: "delete" as const, intended_body: null }
    expect(decideRecovery(context, withoutReply)).toBe("succeeded")
    expect(decideRecovery(context, withReply("hello"))).toBe("not_applied")
  })

  it("compares the intended body for a publish", () => {
    const context = { operation: "publish" as const, intended_body: "hello" }
    expect(decideRecovery(context, withReply("hello"))).toBe("succeeded")
    expect(decideRecovery(context, withoutReply)).toBe("not_applied")
    expect(decideRecovery(context, withReply("something else"))).toBe(
      "diverged"
    )
  })

  it("never treats a publish without an intended body as applied", () => {
    const context = { operation: "publish" as const, intended_body: null }
    expect(decideRecovery(context, withReply("hello"))).toBe("diverged")
    expect(decideRecovery(context, withoutReply)).toBe("not_applied")
  })
})

describe("Google reply readers", () => {
  it("narrows the reply sub-resource and ignores non-string fields", () => {
    const review = parseGoogleReview({
      reviewReply: {
        comment: "thanks",
        state: "APPROVED",
        updateTime: 42,
        policyViolation: { reason: "x" },
      },
      reviewReplyState: "APPROVED",
    })
    expect(googleReplyFromReview(review)).toEqual({
      comment: "thanks",
      state: "APPROVED",
      updateTime: undefined,
      policyViolation: { reason: "x" },
    })
    expect(review.reviewReplyState).toBe("APPROVED")
    expect(googleReplyMatches(review, "thanks")).toBe(true)
    expect(googleReplyMatches(review, "thank you")).toBe(false)
  })

  it("reads a missing or malformed reply as absent", () => {
    expect(googleReplyFromReview(parseGoogleReview({}))).toBeNull()
    expect(
      googleReplyFromReview(parseGoogleReview({ reviewReply: "nope" }))
    ).toBeNull()
    expect(parseGoogleReply(null)).toBeNull()
    expect(parseGoogleReply("text")).toBeNull()
    expect(googleReplyMatches(parseGoogleReview({}), "")).toBe(false)
  })
})
