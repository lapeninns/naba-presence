import { describe, expect, it } from "vitest"

import {
  gateSatisfied,
  publishDisabledReason,
  resourceDisabledReason,
  resourceIsWritable,
  tabGateReasons,
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

describe("LocationTab gate helpers", () => {
  it("gateSatisfied is false while capabilities are unknown, never a false positive", () => {
    expect(gateSatisfied(undefined, "canEditCanonical")).toBe(false)
    expect(gateSatisfied({ canEditCanonical: false, canPublish: true }, "canEditCanonical")).toBe(false)
    expect(gateSatisfied({ canEditCanonical: true, canPublish: false }, "canEditCanonical")).toBe(true)
    expect(gateSatisfied({ canEditCanonical: true, canPublish: false }, "canPublish")).toBe(false)
    expect(gateSatisfied(undefined, undefined)).toBe(true)
  })

  it("tabGateReasons returns null reasons while capabilities are unknown", () => {
    expect(tabGateReasons(undefined, "hours", true)).toEqual({ disabled: false, editReason: null, publishReason: null })
  })

  it("tabGateReasons derives the edit and resource gates independently", () => {
    const member = { canEditCanonical: false, canPublish: false }
    const reasons = tabGateReasons(member, "hours", true)
    expect(reasons.disabled).toBe(true)
    expect(reasons.editReason).toMatch(/owners and admins/i)
    expect(reasons.publishReason).toMatch(/permission to publish/i)

    const owner = { canEditCanonical: true, canPublish: true, resources: { hours: { state: "readOnly" as const } } }
    expect(tabGateReasons(owner, "hours", true)).toEqual({
      disabled: false,
      editReason: null,
      publishReason: "This section is read-only right now.",
    })
    // No resource key -> the plain publish gate (writes paused).
    expect(tabGateReasons(owner, undefined, false).publishReason).toMatch(/unavailable/i)
  })
})
