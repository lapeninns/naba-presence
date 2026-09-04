import { describe, expect, it } from "vitest"

import { deriveLifecycle, lifecycleSummary } from "@/lib/inbox/lifecycle"
import type { ReviewDetail } from "@/lib/contracts/reviews"

type Review = ReviewDetail["review"]

const base: Review = {
  id: "r1",
  reviewerDisplayName: "Sarah Thompson",
  reviewerIsAnonymous: false,
  reviewerProfilePhotoUrl: null,
  rating: 2,
  text: "Waited forty minutes.",
  detectedLanguageCode: "en",
  languageConfidence: 0.99,
  createTime: "2026-09-01T10:00:00.000Z",
  updateTime: "2026-09-01T10:00:00.000Z",
  hasMedia: false,
  workflowStatus: "new",
  locationId: "l1",
  locationName: "Old Crown Girton",
  timezone: "Europe/London",
  verified: true,
  media: [],
  drafts: [],
  reply: null,
  timeline: [],
  capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
  latestVerification: null,
} as unknown as Review

const draft = {
  id: "d1",
  source: "ai",
  body: "Thank you.",
  bodyBytes: 10,
  evidenceHash: null,
  modelName: null,
  verificationStatus: "pass",
  createdAt: "2026-09-01T10:05:00.000Z",
}

const stateOf = (review: Review, id: string) =>
  deriveLifecycle(review).find((step) => step.id === id)!

describe("deriveLifecycle", () => {
  it("starts with a received review and nothing else done", () => {
    const steps = deriveLifecycle(base)
    expect(steps.map((step) => step.id)).toEqual([
      "received",
      "drafted",
      "verified",
      "approved",
      "published",
    ])
    expect(steps[0].state).toBe("done")
    expect(steps[1].state).toBe("current")
  })

  it("names who wrote the draft and how", () => {
    const review = {
      ...base,
      workflowStatus: "drafted",
      drafts: [draft],
      timeline: [
        {
          action: "review.draft.created",
          createdAt: "2026-09-01T10:05:00.000Z",
          actorName: "Priya",
          metadataSummary: null,
        },
      ],
    } as unknown as Review
    expect(stateOf(review, "drafted").meta).toBe("AI · Priya")
  })

  it("treats a failed verification as blocking, not merely pending", () => {
    const review = {
      ...base,
      workflowStatus: "drafted",
      drafts: [draft],
      latestVerification: {
        verdict: "fail",
        reasons: [{ code: "x", severity: "fail", message: "No." }],
      },
    } as unknown as Review
    expect(stateOf(review, "verified").state).toBe("failed")
  })

  it("says approval is not required rather than pretending it is pending", () => {
    // An organisation that publishes directly has no approval gate; showing a
    // "todo" step would describe one that does not exist.
    const review = { ...base, workflowStatus: "verified", drafts: [draft] } as unknown as Review
    const step = stateOf(review, "approved")
    expect(step.state).toBe("skipped")
    expect(step.meta).toBe("Not required")
  })

  it("shows approval as current while it waits, and names the approver after", () => {
    const waiting = {
      ...base,
      workflowStatus: "awaiting_approval",
      drafts: [draft],
    } as unknown as Review
    expect(stateOf(waiting, "approved").state).toBe("current")

    const approved = {
      ...base,
      workflowStatus: "published",
      drafts: [draft],
      reply: { id: "rr1", body: "Thank you.", publishStatus: "published" },
      timeline: [
        {
          action: "review.approval.approved",
          createdAt: "2026-09-01T11:00:00.000Z",
          actorName: "Aman",
          metadataSummary: null,
        },
      ],
    } as unknown as Review
    expect(stateOf(approved, "approved")).toMatchObject({
      state: "done",
      meta: "By Aman",
    })
    expect(stateOf(approved, "published").state).toBe("done")
  })

  it("marks a rejection as failed and says who sent it back", () => {
    const review = {
      ...base,
      workflowStatus: "drafted",
      drafts: [draft],
      timeline: [
        {
          action: "review.approval.rejected",
          createdAt: "2026-09-01T11:00:00.000Z",
          actorName: "Aman",
          metadataSummary: null,
        },
      ],
    } as unknown as Review
    expect(stateOf(review, "approved")).toMatchObject({
      state: "failed",
      meta: "Sent back by Aman",
    })
  })

  it("distinguishes publishing in flight from publishing rejected", () => {
    const inFlight = {
      ...base,
      workflowStatus: "publish_requested",
      drafts: [draft],
    } as unknown as Review
    expect(stateOf(inFlight, "published")).toMatchObject({
      state: "current",
      meta: "On its way to Google",
    })

    const rejected = {
      ...base,
      workflowStatus: "failed",
      drafts: [draft],
    } as unknown as Review
    expect(stateOf(rejected, "published")).toMatchObject({
      state: "failed",
      meta: "Google rejected it",
    })
  })
})

describe("lifecycleSummary", () => {
  it("leads with a failure over anything in progress", () => {
    const review = { ...base, workflowStatus: "failed", drafts: [draft] } as unknown as Review
    expect(lifecycleSummary(deriveLifecycle(review))).toContain("Google rejected it")
  })

  it("otherwise names the live step", () => {
    expect(lifecycleSummary(deriveLifecycle(base))).toContain("Drafted")
  })

  it("never leaves an earlier step pending behind a completed one", () => {
    // A published reply necessarily passed verification, even when no
    // verification record survives. "Verified: not checked yet" under a live
    // reply reads as a fault where there is none.
    const review = {
      ...base,
      workflowStatus: "published",
      drafts: [draft],
      latestVerification: null,
      reply: { id: "rr1", body: "Thanks.", publishStatus: "published" },
    } as unknown as Review
    const steps = deriveLifecycle(review)
    expect(steps.find((step) => step.id === "verified")!.state).toBe("done")
    expect(steps.some((step) => step.state === "current")).toBe(false)
  })

  it("says so plainly once published", () => {
    const review = {
      ...base,
      workflowStatus: "published",
      drafts: [draft],
      reply: { id: "rr1", body: "Thanks.", publishStatus: "published" },
    } as unknown as Review
    expect(lifecycleSummary(deriveLifecycle(review))).toBe("Published to Google")
  })
})
