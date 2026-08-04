import { afterEach, describe, expect, it, vi } from "vitest"

import { decideApproval } from "@/lib/api/approval"
import { generateOrSaveDraft, verifyDraft } from "@/lib/api/drafts"
import { fetchLocations } from "@/lib/api/locations"
import { publishReview } from "@/lib/api/publish"
import { deletePublishedReply } from "@/lib/api/reply"
import { fetchReviewDetail, fetchReviews } from "@/lib/api/reviews"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const rowFixture = {
  id: "rev-1",
  location: { id: "loc-1", name: "Riverside" },
  reviewer: { displayName: "Sam", isAnonymous: false },
  rating: 5,
  text: "Lovely stay",
  detectedLanguageCode: "en",
  languageConfidence: 0.99,
  createTime: "2026-07-30T10:00:00.000Z",
  updateTime: "2026-07-30T10:00:00.000Z",
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
  capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("fetchReviews", () => {
  it("maps camelCase filters to snake_case wire params and expands the cursor", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [rowFixture], nextCursor: "abc" })
    )
    vi.stubGlobal("fetch", fetchMock)
    const page = await fetchReviews(
      {
        locationId: "loc-1",
        ratings: [4, 5],
        statuses: ["new", "drafted"],
        replyState: "unreplied",
        verification: ["pass", "warn"],
        publishStatus: ["published"],
        syncStatus: ["succeeded"],
        dateFrom: "2026-07-01T00:00:00.000Z",
        dateTo: "2026-07-31T00:00:00.000Z",
        search: "lovely",
        sort: "rating_desc",
      },
      "cursor-xyz"
    )
    expect(page.items[0].capabilities.canPublish).toBe(true)
    expect(page.nextCursor).toBe("abc")
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.pathname).toBe("/api/reviews")
    expect(url.searchParams.get("location_id")).toBe("loc-1")
    expect(url.searchParams.get("rating")).toBe("4,5")
    expect(url.searchParams.get("status")).toBe("new,drafted")
    expect(url.searchParams.get("reply_state")).toBe("unreplied")
    expect(url.searchParams.get("verification")).toBe("pass,warn")
    expect(url.searchParams.get("publish_status")).toBe("published")
    expect(url.searchParams.get("sync_status")).toBe("succeeded")
    expect(url.searchParams.get("date_from")).toBe("2026-07-01T00:00:00.000Z")
    expect(url.searchParams.get("date_to")).toBe("2026-07-31T00:00:00.000Z")
    expect(url.searchParams.get("search")).toBe("lovely")
    expect(url.searchParams.get("sort")).toBe("rating_desc")
    expect(url.searchParams.get("cursor")).toBe("cursor-xyz")
  })

  it("omits empty filters and the cursor when null", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [], nextCursor: null })
    )
    vi.stubGlobal("fetch", fetchMock)
    await fetchReviews({}, null)
    const url = new URL(fetchMock.mock.calls[0][0] as string, "http://t")
    expect(url.searchParams.has("location_id")).toBe(false)
    expect(url.searchParams.has("status")).toBe(false)
    expect(url.searchParams.has("cursor")).toBe(false)
  })
})

describe("fetchReviewDetail", () => {
  it("parses the detail envelope including capabilities and reasons", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          review: {
            id: "rev-1",
            reviewerDisplayName: "Sam",
            reviewerIsAnonymous: false,
            rating: 2,
            text: "Slow service",
            detectedLanguageCode: "en",
            languageConfidence: 0.9,
            createTime: "2026-07-30T10:00:00.000Z",
            updateTime: "2026-07-30T10:00:00.000Z",
            hasMedia: true,
            workflowStatus: "drafted",
            locationId: "loc-1",
            locationName: "Riverside",
            timezone: "Europe/London",
            verified: true,
            media: [
              {
                id: "m1",
                thumbnailUrl: "https://x/t.jpg",
                thumbnailLabel: "Photo",
                videoUrl: null,
              },
            ],
            drafts: [
              {
                id: "d1",
                source: "ai",
                body: "Sorry to hear that.",
                bodyBytes: 19,
                evidenceHash: "h",
                modelName: "gpt",
                verificationStatus: "warn",
                createdAt: "2026-07-30T10:05:00.000Z",
              },
            ],
            reply: null,
            timeline: [
              {
                action: "review.draft.generated",
                createdAt: "2026-07-30T10:05:00.000Z",
                actorName: "Alex Owner",
                metadataSummary: null,
              },
            ],
            capabilities: {
              canPublish: false,
              canEdit: true,
              canRequestApproval: true,
            },
            latestVerification: {
              verdict: "warn",
              reasons: [
                {
                  code: "tone_length",
                  severity: "warn",
                  message: "The reply may be too long for the selected tone.",
                },
              ],
            },
          },
        })
      )
    )
    const detail = await fetchReviewDetail("rev-1")
    expect(detail.review.locationName).toBe("Riverside")
    expect(detail.review.capabilities).toEqual({
      canPublish: false,
      canEdit: true,
      canRequestApproval: true,
    })
    expect(detail.review.drafts[0].verificationStatus).toBe("warn")
    expect(detail.review.timeline[0].actorName).toBe("Alex Owner")
  })
})

describe("draft, publish, approval, reply, locations clients", () => {
  it("generateOrSaveDraft omits body for a regenerate and posts it for an edit", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          draftId: "d2",
          body: "Regenerated",
          bodyBytes: 11,
          evidenceHash: "h2",
          verification: { id: "v2", verdict: "pass", reasons: [] },
        },
        201
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    await generateOrSaveDraft("rev-1", { tone: "concise" })
    let init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ tone: "concise" })

    fetchMock.mockClear()
    await generateOrSaveDraft("rev-1", { body: "Edited reply" })
    init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ body: "Edited reply" })
  })

  it("verifyDraft posts to the verify endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ verification: { id: "v3", verdict: "warn", reasons: [] } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await verifyDraft("d1")
    expect(result.verification.verdict).toBe("warn")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/drafts/d1/verify")
  })

  it("publishReview posts draftId and expected update time", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        reviewReplyId: "rr1",
        publishAttemptId: "pa1",
        status: "published",
        googleReplyState: "PUBLISHED",
        idempotent: false,
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await publishReview("rev-1", {
      draftId: "d1",
      expectedReviewUpdateTime: "2026-07-30T10:00:00.000Z",
    })
    expect(result.status).toBe("published")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/reviews/rev-1/publish")
  })

  it("decideApproval posts the decision and surfaces the second-approver code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: "second_approver_required",
            message: "A different authorised user must approve this reply.",
          },
          403
        )
      )
    )
    await expect(
      decideApproval("rev-1", { decision: "approve" })
    ).rejects.toMatchObject({ code: "second_approver_required", status: 403 })
  })

  it("deletePublishedReply DELETEs and returns the status", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: "deleted", publishAttemptId: "pa2" })
    )
    vi.stubGlobal("fetch", fetchMock)
    const result = await deletePublishedReply("rev-1")
    expect(result.status).toBe("deleted")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("DELETE")
  })

  it("fetchLocations reads the location directory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          locations: [
            { id: "loc-1", name: "Riverside", linked: true, googleLocationName: "locations/1" },
            { id: "loc-2", name: "Old Town", linked: false },
          ],
        })
      )
    )
    const result = await fetchLocations()
    // `linked` survives — primary-location resolution ranks on it, so this
    // path must carry it for every role. `googleLocationName` is still
    // stripped: it is owner/admin-only and nothing on this path needs it.
    expect(result.locations).toEqual([
      { id: "loc-1", name: "Riverside", linked: true },
      { id: "loc-2", name: "Old Town", linked: false },
    ])
  })
})
