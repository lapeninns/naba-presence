import { describe, expect, it } from "vitest"

import type { ReviewRow } from "@/lib/contracts/reviews"
import {
  partitionForTemplate,
  runPool,
  stopsBatch,
  templateBand,
  templateSkipReason,
} from "@/lib/inbox/template-batch"

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "r1",
    location: {
      id: "l1",
      name: "Girton",
      clientId: "c1",
      clientName: "Old Crown",
    },
    reviewer: { displayName: "Sam", isAnonymous: false, profilePhotoUrl: null },
    rating: 5,
    text: null,
    detectedLanguageCode: null,
    languageConfidence: null,
    createTime: "2026-09-01T10:00:00.000Z",
    updateTime: "2026-09-01T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "new",
    draftId: null,
    draftBody: null,
    verificationStatus: null,
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: "succeeded",
    capabilities: {
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
    },
    ...overrides,
  } as ReviewRow
}

const OFF = { includeLowRatings: false }

describe("templateSkipReason", () => {
  it("accepts an untouched rating-only review", () => {
    expect(templateSkipReason(row(), OFF)).toBeNull()
    expect(templateSkipReason(row({ text: "   " }), OFF)).toBeNull()
  })

  it("leaves out anything a person should look at first", () => {
    expect(templateSkipReason(row({ text: "Lovely pub" }), OFF)).toBe(
      "has_text"
    )
    expect(
      templateSkipReason(
        row({
          capabilities: {
            canPublish: false,
            canEdit: false,
            canRequestApproval: false,
          },
        }),
        OFF
      )
    ).toBe("no_permission")
    expect(templateSkipReason(row({ replyBody: "Thanks!" }), OFF)).toBe(
      "has_reply"
    )
    expect(
      templateSkipReason(
        row({ draftId: "d1", workflowStatus: "verified" }),
        OFF
      )
    ).toBe("has_draft")
    expect(templateSkipReason(row({ workflowStatus: "failed" }), OFF)).toBe(
      "busy"
    )
  })

  it("holds 1–2 star ratings back unless asked", () => {
    expect(templateSkipReason(row({ rating: 2 }), OFF)).toBe("low_rating")
    expect(
      templateSkipReason(row({ rating: 1 }), { includeLowRatings: true })
    ).toBeNull()
    expect(templateSkipReason(row({ rating: 3 }), OFF)).toBeNull()
  })
})

describe("partitionForTemplate", () => {
  it("splits a selection into eligible rows and reasons", () => {
    const { eligible, skipped } = partitionForTemplate(
      [
        row({ id: "a" }),
        row({ id: "b", text: "Great" }),
        row({ id: "c", rating: 1 }),
      ],
      OFF
    )
    expect(eligible.map((r) => r.id)).toEqual(["a"])
    expect(skipped.map((s) => [s.row.id, s.reason])).toEqual([
      ["b", "has_text"],
      ["c", "low_rating"],
    ])
  })
})

describe("templateBand", () => {
  it("matches the template's bands", () => {
    expect(templateBand(5)).toBe("positive")
    expect(templateBand(4)).toBe("positive")
    expect(templateBand(3)).toBe("neutral")
    expect(templateBand(null)).toBe("neutral")
    expect(templateBand(2)).toBe("negative")
  })
})

describe("runPool", () => {
  it("never runs more than the limit at once and finishes everything", async () => {
    let inFlight = 0
    let peak = 0
    const seen: number[] = []
    await runPool(
      [1, 2, 3, 4, 5, 6, 7],
      async (n) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        seen.push(n)
        inFlight--
      },
      { concurrency: 3, shouldStop: () => false }
    )
    expect(peak).toBe(3)
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("starts nothing new after stop, but lets in-flight work finish", async () => {
    let stop = false
    const finished: number[] = []
    await runPool(
      [1, 2, 3, 4, 5],
      async (n) => {
        if (n === 2) stop = true
        await new Promise((resolve) => setTimeout(resolve, 5))
        finished.push(n)
      },
      { concurrency: 2, shouldStop: () => stop }
    )
    expect(finished.sort()).toEqual([1, 2])
  })

  it("keeps going when one item throws", async () => {
    const finished: number[] = []
    await runPool(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("boom")
        finished.push(n)
      },
      { concurrency: 1, shouldStop: () => false }
    )
    expect(finished).toEqual([1, 3])
  })
})

describe("stopsBatch", () => {
  it("stops on pauses, sign-out and service failures only", () => {
    expect(stopsBatch({ status: 503, code: "publishing_paused" })).toBe(true)
    expect(stopsBatch({ status: 503, code: "drafts_paused" })).toBe(true)
    expect(stopsBatch({ status: 401, code: "authentication_required" })).toBe(
      true
    )
    expect(stopsBatch({ status: 502, code: "google_unavailable" })).toBe(true)
    expect(stopsBatch({ status: 409, code: "review_changed" })).toBe(false)
    expect(
      stopsBatch({ status: 403, code: "publish_permission_required" })
    ).toBe(false)
  })
})
