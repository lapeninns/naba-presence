import { describe, expect, it } from "vitest"

import { lodgingChanges } from "@/lib/locations/forms/industry"

describe("lodgingChanges", () => {
  it("lists only the changed leaves, in the editor's own words", () => {
    const before = {
      policies: { checkinTime: { hours: 15, minutes: 0 } },
      pets: { petsAllowed: false, petsAllowedFree: false },
    }
    const after = {
      policies: { checkinTime: { hours: 14, minutes: 30 } },
      pets: { petsAllowed: true, petsAllowedFree: false },
      connectivity: { freeWifi: true, somethingNew: "x" },
    }
    expect(lodgingChanges(before, after)).toEqual([
      {
        section: "policies",
        path: "policies.checkinTime",
        field: "Check-in time",
        before: "15:00",
        after: "14:30",
      },
      {
        section: "pets",
        path: "pets.petsAllowed",
        field: "Pets allowed",
        before: "No",
        after: "Yes",
      },
      {
        section: "connectivity",
        path: "connectivity.freeWifi",
        field: "Free Wi‑Fi",
        before: "Not set",
        after: "Yes",
      },
      {
        section: "connectivity",
        path: "connectivity.somethingNew",
        field: "Connectivity: something new",
        before: "Not set",
        after: "x",
      },
    ])
  })

  it("is empty when nothing changed", () => {
    const record = { pets: { petsAllowed: true } }
    expect(lodgingChanges(record, { pets: { petsAllowed: true } })).toEqual([])
  })

  it("ignores a section whose keys only changed order", () => {
    // A Google suggestion applied as-is can reorder a section's keys. The
    // whole-section string compare sees a change there; the leaves do not,
    // so the section is neither shown nor put in the publish mask.
    const before = { parking: { parkingAvailable: true, freeParking: false } }
    const after = { parking: { freeParking: false, parkingAvailable: true } }
    expect(lodgingChanges(before, after)).toEqual([])
  })
})
