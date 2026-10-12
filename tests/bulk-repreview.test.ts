import { describe, expect, it } from "vitest"

import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import {
  formatCountdown,
  needsNewPreview,
  newPreviewRequest,
  secondsLeft,
  serverClockOffset,
} from "@/lib/domain/bulk-repreview"

const categories: BulkOperationInput = {
  operation: "categories",
  primaryCategory: "categories/gcid:pub",
  addAdditional: [],
  removeAdditional: [],
}
const wifi: BulkOperationInput = {
  operation: "attributes",
  changes: [{ name: "attributes/has_wifi", values: [true] }],
}
const special: BulkOperationInput = {
  operation: "special_hours",
  dates: [{ action: "closed", date: "2026-12-25" }],
}
const post: BulkOperationInput = {
  operation: "post_draft",
  post: {
    topicType: "STANDARD",
    languageCode: "en-GB",
    summary: "Quiz night every Thursday",
    media: [],
  },
}
const hours: BulkOperationInput = {
  operation: "regular_hours",
  days: [
    {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "09:00", closesAt: "17:00" }],
    },
  ],
}
const child = (
  locationId: string,
  seq: number,
  status: string,
  resultCode: string | null = null,
  operation = "attributes"
) => ({ locationId, seq, status, resultCode, operation })

describe("needsNewPreview", () => {
  it("is true only for children that can never be retried in place", () => {
    expect(needsNewPreview(child("a", 0, "conflict"))).toBe(true)
    expect(needsNewPreview(child("a", 0, "expired"))).toBe(true)
    expect(needsNewPreview(child("a", 0, "failed", "provider_rejected"))).toBe(
      false
    )
    for (const status of ["succeeded", "ambiguous", "queued", "skipped"])
      expect(needsNewPreview(child("a", 0, status))).toBe(false)
  })

  it("takes a blocked dependent only when Retry would leave its prerequisite alone", () => {
    const dependent = child("a", 1, "failed", "dependency_not_applied")
    const withPrerequisite = (status: string, code: string | null = null) => [
      child("a", 0, status, code, "categories"),
      dependent,
    ]
    for (const status of ["conflict", "expired", "cancelled", "skipped"])
      expect(needsNewPreview(dependent, withPrerequisite(status))).toBe(true)
    // Retry requeues a plainly failed prerequisite and its dependent together.
    expect(
      needsNewPreview(
        dependent,
        withPrerequisite("failed", "provider_rejected")
      )
    ).toBe(false)
    // A prerequisite at another listing is not this one's.
    expect(
      needsNewPreview(dependent, [
        child("b", 0, "conflict", null, "categories"),
        dependent,
      ])
    ).toBe(false)
  })
})

describe("newPreviewRequest", () => {
  it("keeps the batch's order and only the changes and listings that need it", () => {
    expect(
      newPreviewRequest({
        items: [categories, wifi, special],
        children: [
          child("a", 0, "conflict", "google_baseline_changed", "categories"),
          child("a", 1, "failed", "dependency_not_applied"),
          child("a", 2, "succeeded", null, "special_hours"),
          child("b", 0, "succeeded", null, "categories"),
          child("b", 1, "succeeded"),
          child("b", 2, "succeeded", null, "special_hours"),
          child("c", 2, "expired", "dispatch_expired", "special_hours"),
        ],
      })
    ).toEqual({
      locationIds: ["a", "c"],
      items: [categories, wifi, special],
      omitted: [],
    })
  })

  it("is null when nothing needs a new preview, and for review batches", () => {
    expect(
      newPreviewRequest({
        items: [wifi],
        children: [child("a", 0, "succeeded"), child("b", 0, "failed")],
      })
    ).toBeNull()
    expect(
      newPreviewRequest({
        items: [wifi],
        children: [
          child("a", 0, "expired", "dispatch_expired", "review_approval"),
        ],
      })
    ).toBeNull()
  })

  it("takes every listing and change once the 15-minute window closed", () => {
    expect(
      newPreviewRequest(
        {
          items: [wifi, special],
          children: [
            child("a", 0, "previewed"),
            child("a", 1, "skipped", "already_applied", "special_hours"),
            child("b", 0, "previewed"),
          ],
        },
        { previewClosed: true }
      )
    ).toEqual({ locationIds: ["a", "b"], items: [wifi, special], omitted: [] })
  })

  it("never pairs a post draft with a listing that already has it", () => {
    // A's post went out but its hours conflicted; B's post expired.
    expect(
      newPreviewRequest({
        items: [post, hours],
        children: [
          child("a", 0, "succeeded", null, "post_draft"),
          child("a", 1, "conflict", "google_baseline_changed", "regular_hours"),
          child("b", 0, "expired", "dispatch_expired", "post_draft"),
          child("b", 1, "succeeded", null, "regular_hours"),
        ],
      })
    ).toEqual({
      locationIds: ["a"],
      items: [hours],
      omitted: [{ seq: 0, locationIds: ["b"] }],
    })
    // Every listing in the request needs the post again: it stays.
    expect(
      newPreviewRequest({
        items: [post, hours],
        children: [
          child("a", 0, "expired", "dispatch_expired", "post_draft"),
          child("a", 1, "expired", "dispatch_expired", "regular_hours"),
          child("b", 0, "expired", "dispatch_expired", "post_draft"),
          child("b", 1, "succeeded", null, "regular_hours"),
        ],
      })
    ).toEqual({ locationIds: ["a", "b"], items: [post, hours], omitted: [] })
  })

  it("is null while the batch may still send a child", () => {
    expect(
      newPreviewRequest({
        items: [post, hours],
        children: [
          child("a", 0, "queued", null, "post_draft"),
          child("a", 1, "conflict", "google_baseline_changed", "regular_hours"),
        ],
      })
    ).toBeNull()
  })

  it("brings a cancelled prerequisite back before its dependent and leaves Retry's cases to Retry", () => {
    expect(
      newPreviewRequest({
        items: [categories, wifi],
        children: [
          child("a", 0, "cancelled", null, "categories"),
          child("a", 1, "failed", "dependency_not_applied"),
        ],
      })
    ).toEqual({ locationIds: ["a"], items: [categories, wifi], omitted: [] })
    expect(
      newPreviewRequest({
        items: [categories, wifi],
        children: [
          child("a", 0, "failed", "provider_rejected", "categories"),
          child("a", 1, "failed", "dependency_not_applied"),
        ],
      })
    ).toBeNull()
  })
})

describe("countdown", () => {
  it("counts whole seconds down to zero and formats m:ss", () => {
    const deadline = "2026-10-12T10:15:00.000Z"
    const at = (iso: string) => secondsLeft(deadline, Date.parse(iso))
    expect(at("2026-10-12T10:00:00.000Z")).toBe(900)
    expect(at("2026-10-12T10:14:59.400Z")).toBe(1)
    expect(at("2026-10-12T10:15:00.000Z")).toBe(0)
    expect(at("2026-10-12T11:00:00.000Z")).toBe(0)
    // The server's clock runs 30 s ahead of the browser's.
    expect(
      secondsLeft(deadline, Date.parse("2026-10-12T10:14:00.000Z"), 30_000)
    ).toBe(30)
    expect(
      serverClockOffset(
        "2026-10-12T10:00:30.000Z",
        Date.parse("2026-10-12T10:00:00.000Z")
      )
    ).toBe(30_000)
    expect(serverClockOffset(undefined, Date.now())).toBe(0)
    expect(formatCountdown(900)).toBe("15:00")
    expect(formatCountdown(65)).toBe("1:05")
    expect(formatCountdown(0)).toBe("0:00")
  })
})
