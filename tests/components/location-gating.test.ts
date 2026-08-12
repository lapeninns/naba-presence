import { describe, expect, it } from "vitest"

import {
  publishDisabledReason,
  resourceDisabledReason,
  resourceIsWritable,
} from "@/lib/locations/gating"

describe("location resource gating", () => {
  it("prefers resource reason codes when present", () => {
    const caps = {
      canEditCanonical: true,
      canPublish: true,
      resources: {
        photos: {
          state: "unavailable" as const,
          reasonCode: "google_location_not_linked",
        },
      },
    }
    expect(resourceDisabledReason(caps, "photos", true)).toBe(
      "Link this location to Google first."
    )
    expect(resourceIsWritable(caps, "photos", true)).toBe(false)
  })

  it("falls back to publish gates when resources are absent", () => {
    expect(
      publishDisabledReason({ canEditCanonical: true, canPublish: false }, true)
    ).toMatch(/permission/i)
    expect(
      resourceDisabledReason(
        { canEditCanonical: true, canPublish: true },
        "menu",
        false
      )
    ).toMatch(/unavailable/i)
  })
})
