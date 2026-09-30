import { describe, expect, it } from "vitest"
import { lodgingReviewLabel, lodgingReviewRows } from "@/lib/locations/forms/lodging-review"

describe("lodging approval preview", () => {
  it("shows unknown, false and clear distinctly while omitting unchanged siblings", () => {
    const rows = lodgingReviewRows({
      baseline: { pets: { dogsAllowed: true, catsAllowed: true } },
      payload: { pets: { petsAllowed: false, catsAllowed: true } },
      updateMask: ["pets"],
    })
    expect(rows).toEqual([
      { key: "pets.dogsAllowed", field: "Pets · Dogs allowed", before: "Yes", after: "Clear value" },
      { key: "pets.petsAllowed", field: "Pets · Pets allowed", before: "Not set", after: "No" },
    ])
  })

  it("shows explicit empty arrays and objects rather than losing a clearing operation", () => {
    expect(lodgingReviewRows({ baseline: { guestUnits: [] }, payload: {}, updateMask: ["guestUnits"] })[0]).toMatchObject({ before: "No items", after: "Clear value" })
    expect(lodgingReviewRows({ baseline: {}, payload: { guestUnits: [] }, updateMask: ["guestUnits"] })[0]).toMatchObject({ before: "Not set", after: "No items" })
    expect(lodgingReviewRows({ baseline: { pets: {} }, payload: {}, updateMask: ["pets"] })[0]).toMatchObject({ before: "No values", after: "Clear value" })
  })

  it("limits the preview to selected masks and deduplicates overlapping paths", () => {
    const rows = lodgingReviewRows({ baseline: {}, payload: { pets: { petsAllowed: true }, parking: { freeParking: true } }, updateMask: ["pets", "pets.petsAllowed"] })
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe("pets.petsAllowed")
  })

  it("labels collection items from 1 with the editor's wording", () => {
    expect(lodgingReviewLabel("services.languagesSpoken.1.languageCode")).toBe("Services · Languages spoken 2 · Language code")
    expect(lodgingReviewLabel("guestUnits.0.features.tv")).toBe("Guest units 1 · Features · TV")
    expect(lodgingReviewLabel("metadata.updateTime")).toBe("Data confirmed accurate at")
    const rows = lodgingReviewRows({
      baseline: { services: { languagesSpoken: [{ languageCode: "en", spoken: true }] } },
      payload: { services: { languagesSpoken: [{ languageCode: "en", spoken: true }, { languageCode: "fr", spoken: true }] } },
      updateMask: ["services.languagesSpoken"],
    })
    expect(rows.map((row) => row.field)).toEqual(["Services · Languages spoken 2 · Language code", "Services · Languages spoken 2 · Spoken"])
  })

  it("shows a check-in time as one 24-hour value", () => {
    expect(lodgingReviewRows({ baseline: {}, payload: { policies: { checkinTime: { hours: 15, minutes: 30 } } }, updateMask: ["policies.checkinTime"] })).toEqual([
      { key: "policies.checkinTime", field: "Policies · Check-in time", before: "Not set", after: "15:30" },
    ])
    expect(lodgingReviewRows({ baseline: { policies: { checkoutTime: {} } }, payload: {}, updateMask: ["policies.checkoutTime"] })[0]).toMatchObject({ before: "00:00", after: "Clear value" })
  })
})
