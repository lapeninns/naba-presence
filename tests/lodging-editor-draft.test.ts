import { describe, expect, it } from "vitest"
import { buildLodgingProposal, lodgingErrorsWithin, lodgingValue, setLodgingValue } from "@/lib/locations/forms/lodging-draft"
import { acceptLodgingSuggestion, lodgingSuggestions } from "@/lib/locations/forms/lodging-suggestions"

describe("precise lodging drafts and provider suggestions", () => {
  it("reports an out-of-range recorded time on the single time control", () => {
    expect(buildLodgingProposal({}, { policies: { checkinTime: { hours: 25 } } })).toMatchObject({ valid: false, fieldErrors: { "policies.checkinTime": "Check-in time: enter a time between 00:00 and 23:59." } })
    expect(buildLodgingProposal({}, { policies: { checkoutTime: { minutes: -1 } } })).toMatchObject({ valid: false, fieldErrors: { "policies.checkoutTime": "Checkout time: enter a time between 00:00 and 23:59." } })
    expect(buildLodgingProposal({}, { policies: { checkinTime: { hours: 15, minutes: 30 } } })).toMatchObject({ valid: true, updateMask: ["policies.checkinTime"], payload: { policies: { checkinTime: { hours: 15, minutes: 30 } } } })
  })

  it("gives plain, field-specific guidance instead of type names", () => {
    const { fieldErrors } = buildLodgingProposal({}, { guestUnits: [{}] })
    expect(fieldErrors).toEqual({
      "guestUnits.0.codes": "Add at least one room or unit code for this guest unit type.",
      "guestUnits.0.label": "Enter a short name for this guest unit type, such as Deluxe king room.",
    })
    expect(buildLodgingProposal({}, { guestUnits: [{ codes: [""], label: "Deluxe" }] }).fieldErrors).toEqual({ "guestUnits.0.codes.0": "Enter a room or unit code, or remove this empty code." })
    expect(buildLodgingProposal({}, { guestUnits: [{ codes: [], label: "Deluxe" }] }).fieldErrors).toEqual({ "guestUnits.0.codes": "Add at least one room or unit code for this guest unit type." })
    expect(buildLodgingProposal({}, { services: { languagesSpoken: [{ spoken: true }] } }).fieldErrors).toEqual({ "services.languagesSpoken.0.languageCode": "Enter a language code such as en, fr or es." })
    expect(buildLodgingProposal({}, { property: { roomsCount: "twelve" } }).fieldErrors).toEqual({ "property.roomsCount": "Rooms count: enter a whole number." })
    expect(buildLodgingProposal({}, { guestUnits: [{ codes: ["A"], label: "One" }, { codes: ["A"], label: "Two" }] }).fieldErrors).toEqual({ "guestUnits.1.codes.0": "Guest unit codes must be unique within a lodging listing." })
    for (const message of Object.values(buildLodgingProposal({}, { guestUnits: [{}], property: { roomsCount: "x" } }).fieldErrors)) expect(message).not.toMatch(/supported (array|string|number|int) value/)
  })

  it("does not flag untouched or absent optional lists", () => {
    expect(buildLodgingProposal({}, { services: { concierge: true } })).toMatchObject({ valid: true, fieldErrors: {} })
    expect(buildLodgingProposal({}, { sustainability: { sustainabilityCertifications: { ecoCertifications: [{ ecoCertificate: "GREEN_KEY" }] } } })).toMatchObject({ valid: true })
    expect(buildLodgingProposal({}, { sustainability: { sustainabilityCertifications: { ecoCertifications: [{}] } } }).fieldErrors).toEqual({ "sustainability.sustainabilityCertifications.ecoCertifications.0.ecoCertificate": "Eco certificate: choose one of the listed options." })
  })

  it("counts errors within a group or collection item", () => {
    const errors = { "guestUnits.0.codes": "a", "guestUnits.0.label": "b", "guestUnits.1.label": "c", "policies.checkinTime": "d" }
    expect(lodgingErrorsWithin(errors, "guestUnits")).toHaveLength(3)
    expect(lodgingErrorsWithin(errors, "guestUnits.0")).toHaveLength(2)
    expect(lodgingErrorsWithin(errors, "guestUnits.1")).toHaveLength(1)
    expect(lodgingErrorsWithin(errors, "policies")).toHaveLength(1)
    expect(lodgingErrorsWithin(errors, "pets")).toHaveLength(0)
  })

  it("offers a Google time suggestion to the single time control", () => {
    const suggestions = lodgingSuggestions({}, { lodging: { policies: { checkinTime: { hours: 15 } } }, diffMask: "policies.checkinTime.hours" })
    expect(suggestions.rows).toEqual([{ path: "policies.checkinTime", label: "Check-in time", current: undefined, suggested: { hours: 15 } }])
  })

  it("preserves unknown, explicit false and exceptions without coercion", () => {
    const before = { parking: { freeParking: false, freeParkingException: "DEPENDENT_ON_SEASON", futureProviderSibling: "retain" } }
    expect(lodgingValue(before, "parking.parkingAvailable")).toBeUndefined()
    expect(lodgingValue(before, "parking.freeParking")).toBe(false)
    const next = setLodgingValue(before, "parking.parkingAvailable", true)
    expect(next.parking).toEqual({ ...before.parking, parkingAvailable: true })
    expect(buildLodgingProposal(before, next)).toMatchObject({ valid: true, updateMask: ["parking.parkingAvailable"], payload: { parking: { parkingAvailable: true } } })
  })
  it("does not write untouched zero, false, exceptions or future siblings", () => {
    const before = { property: { floorsCount: 0 }, pets: { petsAllowed: false, petsAllowedException: "UNDER_CONSTRUCTION" }, unknown: { keep: true } }
    expect(buildLodgingProposal(before, structuredClone(before)).updateMask).toEqual([])
    const next = setLodgingValue(before, "property.roomsCount", 12)
    expect(buildLodgingProposal(before, next).payload).toEqual({ property: { roomsCount: 12 } })
  })
  it("replaces only a touched repeated collection and refuses unknown writable collection fields", () => {
    const before = { services: { concierge: true, languagesSpoken: [{ languageCode: "en", spoken: true }] } }
    const next = setLodgingValue(before, "services.languagesSpoken", [{ languageCode: "en", spoken: false }, { languageCode: "fr", spoken: true }])
    expect(buildLodgingProposal(before, next)).toMatchObject({ valid: true, updateMask: ["services.languagesSpoken"], payload: { services: { languagesSpoken: next.services && lodgingValue(next, "services.languagesSpoken") } } })
    const unsupported = setLodgingValue(before, "services.languagesSpoken", [{ languageCode: "en", spoken: false, future: true }])
    expect(buildLodgingProposal(before, unsupported).valid).toBe(false)
  })
  it("previews the real lodging/diffMask envelope field by field and accepts only into a draft", () => {
    const before = { parking: { freeParking: false, parkingAvailable: true, future: "keep" }, pets: { petsAllowed: false } }
    const response = { lodging: { parking: { freeParking: true, parkingAvailable: false }, pets: { petsAllowed: true } }, diffMask: "parking.freeParking,pets,futureCapability" }
    const suggestions = lodgingSuggestions(before, response)
    expect(suggestions.readable).toBe(true)
    expect(suggestions.rows).toEqual(expect.arrayContaining([{ path: "parking.freeParking", label: "Free parking", current: false, suggested: true }, { path: "pets.petsAllowed", label: "Pets allowed", current: false, suggested: true }]))
    expect(suggestions.rows.some((row) => row.path === "parking.parkingAvailable")).toBe(false)
    expect(suggestions.unsupportedPaths).toEqual(["futureCapability"])
    const selected = suggestions.rows.find((row) => row.path === "parking.freeParking")
    if (!selected) throw new Error("Expected field suggestion")
    const draft = acceptLodgingSuggestion(before, selected)
    expect(draft).toEqual({ ...before, parking: { ...before.parking, freeParking: true } })
    expect(before.parking.freeParking).toBe(false)
    expect(buildLodgingProposal(before, draft).updateMask).toEqual(["parking.freeParking"])
  })
  it("distinguishes unreadable suggestion data from no suggested changes", () => {
    expect(lodgingSuggestions({}, { diffMask: "parking", parking: {} }).readable).toBe(false)
    expect(lodgingSuggestions({}, { lodging: {}, diffMask: "" })).toMatchObject({ readable: true, rows: [] })
    expect(() => acceptLodgingSuggestion({}, { path: "allUnits", suggested: {} })).toThrow("Unsupported")
    expect(() => setLodgingValue({}, "__proto__.polluted", true)).toThrow("Invalid")
  })
})
