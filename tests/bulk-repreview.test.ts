import { describe, expect, it } from "vitest"

import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import {
  formatCountdown,
  needsNewPreview,
  newPreviewRequest,
  secondsLeft,
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
    expect(
      needsNewPreview(child("a", 0, "failed", "dependency_not_applied"))
    ).toBe(true)
    expect(needsNewPreview(child("a", 0, "failed", "provider_rejected"))).toBe(
      false
    )
    for (const status of ["succeeded", "ambiguous", "queued", "skipped"])
      expect(needsNewPreview(child("a", 0, status))).toBe(false)
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
    ).toEqual({ locationIds: ["a", "c"], items: [categories, wifi, special] })
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
    ).toEqual({ locationIds: ["a", "b"], items: [wifi, special] })
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
    expect(formatCountdown(900)).toBe("15:00")
    expect(formatCountdown(65)).toBe("1:05")
    expect(formatCountdown(0)).toBe("0:00")
  })
})
