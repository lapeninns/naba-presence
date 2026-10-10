import { describe, expect, it } from "vitest"
import { advertisingBaselineSupported, advertisingMatches, googleAdvertisingSchema } from "@/lib/domain/google-advertising"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { buildLocationUpdate, draftFromLocation } from "@/lib/locations/business-information-draft"
import { locationDiffRows } from "@/lib/locations/google-values"
import { parseListingDraft } from "@/lib/locations/forms/listing-draft"

describe("Google Ads phone", () => {
  it("requires a complete typed phone override or explicit parent clear", () => {
    expect(googleAdvertisingSchema.parse({ adPhone: " +44 20 7946 0123 " })).toEqual({ adPhone: "+44 20 7946 0123" })
    expect(businessInformationPayloadSchema.parse({ adWordsLocationExtensions: {} })).toEqual({ adWordsLocationExtensions: {} })
    for (const value of [null, [], { adPhone: "" }, { adPhone: 123 }, { adPhone: "x".repeat(51) }, { adPhone: "+44 20 7946 0123", unknown: true }]) expect(googleAdvertisingSchema.safeParse(value).success).toBe(false)
  })

  it("does not replace unknown baseline fields", () => {
    for (const value of [undefined, {}, { adPhone: "" }, { adPhone: "+44 20 7946 0123" }]) expect(advertisingBaselineSupported(value)).toBe(true)
    for (const value of [null, [], { futureField: true }, { adPhone: 123 }]) expect(advertisingBaselineSupported(value)).toBe(false)
  })

  it("requires exact readback and distinguishes retained values from clears", () => {
    const expected = { adPhone: "+44 20 7946 0123" }
    expect(advertisingMatches(expected, expected)).toBe(true)
    expect(advertisingMatches({ adPhone: "+44 20 7946 0999" }, expected)).toBe(false)
    expect(advertisingMatches(expected, {})).toBe(false)
    for (const value of [undefined, {}, { adPhone: "" }]) expect(advertisingMatches(value, {})).toBe(true)
    for (const value of [null, [], { futureField: true }]) expect(advertisingMatches(value, {})).toBe(false)
  })

  it("restores and reviews changes without changing public phones", () => {
    const initial = draftFromLocation({ phoneNumbers: { primaryPhone: "+44 20 7946 0100", additionalPhones: ["+44 20 7946 0101"] }, adWordsLocationExtensions: { adPhone: "+44 20 7946 0123" } })
    const draft = { ...initial, adPhone: "+44 20 7946 0124" }
    expect(parseListingDraft(draft)).toEqual(draft)
    const change = buildLocationUpdate(initial, draft)
    expect(change).toMatchObject({ payload: { adWordsLocationExtensions: { adPhone: draft.adPhone } }, updateMask: ["adWordsLocationExtensions"] })
    expect(change.payload).not.toHaveProperty("phoneNumbers")
    expect(locationDiffRows(change.updateMask, initial, draft)).toEqual([{ key: "adWordsLocationExtensions", label: "Google Ads phone", currentValue: initial.adPhone, nextValue: draft.adPhone }])
    const cleared = { ...initial, adPhone: "" }
    expect(buildLocationUpdate(initial, cleared).payload).toEqual({ adWordsLocationExtensions: {} })
    expect(locationDiffRows(["adWordsLocationExtensions"], initial, cleared)[0]?.nextValue).toBeNull()
    const absent = draftFromLocation({})
    expect(absent.adPhone).toBeUndefined()
    expect(buildLocationUpdate(absent, { ...absent, adPhone: "" }).updateMask).toEqual([])
  })
})
