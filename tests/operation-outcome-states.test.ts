import { describe, expect, it } from "vitest"

import { replyStatusPill } from "@/components/inbox/situation-tone"
import { ApiClientError } from "@/lib/api/client"
import { gbpMutationResultSchema } from "@/lib/contracts/gbp-management"
import { publishFoodMenusResultSchema } from "@/lib/contracts/location-food-menus"
import { publishHoursResponseSchema } from "@/lib/contracts/location-hours"
import { industryMutationResultSchema } from "@/lib/contracts/location-industry"
import { mediaMutationOutcomeSchema } from "@/lib/contracts/location-media"
import { placeActionMutationOutcomeSchema } from "@/lib/contracts/location-place-actions"
import { postPublishOutcomeSchema } from "@/lib/contracts/location-posts"
import { profileOperationResponseSchema } from "@/lib/contracts/location-profile"
import {
  isUnsettledOutcome,
  OPERATION_OUTCOMES,
  operationSummarySchema,
} from "@/lib/contracts/mutation-operations"
import {
  googlePostStateOutcome,
  localPostOutcome,
} from "@/lib/domain/post-outcome"
import { answerOutcome } from "@/lib/editors/outcome"
import { errorOutcome, isUnconfirmedFailure } from "@/lib/errors/action-errors"
import { describeReplyState } from "@/lib/inbox/review-situation"
import { postStatus } from "@/lib/locations/post-display"

const operation = { operationId: "op-1", outcome: "awaiting_confirmation" }

describe("listing mutation responses carry the operation outcome", () => {
  // One sample answer per route (P03-S7): each parses with its `operation`
  // and keeps it, and each refuses an outcome outside the shared vocabulary.
  const ROUTES = [
    [
      "hours",
      publishHoursResponseSchema,
      { status: "published", attemptId: "a", idempotent: false },
    ],
    [
      "profile",
      profileOperationResponseSchema,
      { status: "published", attemptId: "a", idempotent: false },
    ],
    [
      "food menus",
      publishFoodMenusResultSchema,
      { status: "published", attemptId: "a", idempotent: false },
    ],
    [
      "business information",
      gbpMutationResultSchema,
      { id: "a", status: "succeeded", idempotent: false },
    ],
    [
      "industry",
      industryMutationResultSchema,
      { id: "a", status: "succeeded", idempotent: false, response: {} },
    ],
    [
      "media",
      mediaMutationOutcomeSchema,
      { id: "a", status: "succeeded", idempotent: false },
    ],
    [
      "place actions",
      placeActionMutationOutcomeSchema,
      { id: "a", status: "succeeded", idempotent: false },
    ],
    [
      "post publish",
      postPublishOutcomeSchema,
      {
        status: "published",
        postId: "p1",
        googlePostName: "accounts/1/locations/2/localPosts/3",
      },
    ],
  ] as const

  it.each(ROUTES)("%s", (_name, schema, body) => {
    const parsed = schema.parse({ ...body, operation })
    expect((parsed as { operation?: unknown }).operation).toEqual(operation)
    // An answer from before receipts (or one that sent nothing) still parses.
    expect(schema.safeParse(body).success).toBe(true)
    expect(
      schema.safeParse({
        ...body,
        operation: { operationId: null, outcome: "live" },
      }).success
    ).toBe(false)
  })

  it("lets operationId be null when no intent was recorded", () => {
    expect(
      operationSummarySchema.parse({
        operationId: null,
        outcome: "confirmed_applied",
      })
    ).toEqual({
      operationId: null,
      outcome: "confirmed_applied",
    })
  })

  it("polls only the states that can still move by themselves", () => {
    expect(OPERATION_OUTCOMES.filter(isUnsettledOutcome)).toEqual([
      "sent",
      "uncertain",
    ])
  })
})

describe("answerOutcome", () => {
  it("takes the route's outcome, and falls back to the attempt status", () => {
    expect(
      answerOutcome({
        status: "succeeded",
        operation: { outcome: "awaiting_confirmation" },
      })
    ).toBe("awaiting_confirmation")
    expect(answerOutcome({ status: "succeeded" })).toBe("confirmed_applied")
    expect(answerOutcome({ status: "publishing" })).toBe("sent")
  })
})

describe("errorOutcome", () => {
  const api = (status: number, code: string, details?: unknown) =>
    new ApiClientError(status, code, "x", details)

  it.each([
    [api(502, "google_mutation_ambiguous"), "uncertain"],
    [api(409, "mutation_uncertain"), "uncertain"],
    [api(409, "post_publish_uncertain"), "uncertain"],
    [api(0, "network_error"), "uncertain"],
    [api(504, "http_error"), "uncertain"],
    [new TypeError("Failed to fetch"), "uncertain"],
    [api(409, "intent_in_progress"), "sent"],
    [api(409, "hours_publish_in_progress"), "sent"],
    [api(400, "INVALID_ARGUMENT"), "rejected"],
    [api(403, "PERMISSION_DENIED"), "rejected"],
    [api(429, "RESOURCE_EXHAUSTED"), "failed"],
    [api(409, "hours_stale"), "failed"],
    // An unhandled 500 may follow a provider write that landed (the settle
    // after it failed), and a 2xx that did not parse was applied.
    [api(500, "internal_error"), "uncertain"],
    [api(500, "malformed_response"), "uncertain"],
    [api(500, "google_write_failed"), "failed"],
    [api(502, "google_readback_mismatch"), "failed"],
    [new Error("boom"), "failed"],
  ] as const)("%o is %s", (error, outcome) => {
    expect(errorOutcome(error)).toBe(outcome)
  })

  it("believes a replayed receipt's own outcome", () => {
    expect(
      errorOutcome(
        api(502, "google_timeout", { operationId: "op", outcome: "uncertain" })
      )
    ).toBe("uncertain")
    expect(
      errorOutcome(
        api(500, "mutation_failed", { operationId: "op", outcome: "failed" })
      )
    ).toBe("failed")
  })

  it("asks a retry to resend its intent only when the write may have applied", () => {
    expect(isUnconfirmedFailure(api(502, "google_mutation_ambiguous"))).toBe(
      true
    )
    expect(isUnconfirmedFailure(api(409, "intent_in_progress"))).toBe(true)
    expect(isUnconfirmedFailure(api(400, "INVALID_ARGUMENT"))).toBe(false)
    expect(isUnconfirmedFailure(api(409, "hours_stale"))).toBe(false)
  })
})

describe("post outcomes", () => {
  it("is live only when Google reports the post LIVE", () => {
    expect(googlePostStateOutcome("LIVE")).toBe("confirmed_applied")
    expect(googlePostStateOutcome("PROCESSING")).toBe("awaiting_confirmation")
    expect(googlePostStateOutcome("REJECTED")).toBe("rejected")
    expect(googlePostStateOutcome(null)).toBe("awaiting_confirmation")
  })

  it.each([
    [{ status: "draft", googleState: null }, null],
    [{ status: "awaiting_approval", googleState: null }, null],
    [{ status: "publishing", googleState: null }, "sent"],
    [{ status: "ambiguous", googleState: null }, "uncertain"],
    [
      {
        status: "failed",
        googleState: null,
        lastErrorCode: "google_post_failed",
      },
      "failed",
    ],
    [
      {
        status: "failed",
        googleState: "REJECTED",
        lastErrorCode: "google_post_rejected",
      },
      "rejected",
    ],
    // A later failed publish keeps Google's old state but is its own failure.
    [
      {
        status: "failed",
        googleState: "REJECTED",
        lastErrorCode: "google_post_failed",
      },
      "failed",
    ],
    [{ status: "published", googleState: "LIVE" }, "confirmed_applied"],
    [
      { status: "published", googleState: "PROCESSING" },
      "awaiting_confirmation",
    ],
    [{ status: "published", googleState: null }, "awaiting_confirmation"],
  ] as const)("%o is %s", (post, outcome) => {
    expect(localPostOutcome(post)).toBe(outcome)
  })

  it("words the posts tab pill in the shared outcome words", () => {
    expect(postStatus({ status: "published", googleState: "LIVE" })).toEqual({
      label: "Live on Google",
      tone: "ok",
    })
    expect(
      postStatus({ status: "published", googleState: "PROCESSING" })
    ).toEqual({
      label: "Waiting for Google",
      tone: "info",
    })
    expect(postStatus({ status: "published", googleState: null })).toEqual({
      label: "Waiting for Google",
      tone: "info",
    })
    expect(
      postStatus({ status: "published", googleState: "REJECTED" })
    ).toEqual({
      label: "Rejected by Google",
      tone: "bad",
    })
    expect(postStatus({ status: "publishing", googleState: null })).toEqual({
      label: "Sent to Google",
      tone: "info",
    })
    expect(postStatus({ status: "ambiguous", googleState: null })).toEqual({
      label: "Not confirmed",
      tone: "warn",
    })
    expect(postStatus({ status: "draft", googleState: null })).toEqual({
      label: "Draft",
      tone: "neutral",
    })
  })
})

describe("inbox status pills", () => {
  it("names reply publish states in the shared words", () => {
    expect(describeReplyState("published").label).toBe("Live on Google")
    expect(describeReplyState("accepted").label).toBe("Sent to Google")
  })

  it("takes the live pill's tone from the outcome, not from the words", () => {
    expect(
      replyStatusPill({
        text: "Live on Google",
        short: "Replied",
        tone: "neutral",
        icon: "check-circle",
      })
    ).toEqual({ tone: "neutral", dashed: false })
    expect(
      replyStatusPill({
        text: "Live on Google",
        short: "Replied",
        tone: "neutral",
        icon: "check-circle",
        outcome: "confirmed_applied",
      })
    ).toEqual({ tone: "ok", dashed: false })
  })
})
