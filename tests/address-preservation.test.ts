import { expect, it } from "vitest"
import { addressFieldMatches, assertBusinessInformationMask, businessInformationPayloadSchema, unsupportedAddressDetails } from "@/lib/domain/business-information"
import { buildLocationUpdate, draftFromLocation } from "@/lib/locations/business-information-draft"
import { locationDiffRows } from "@/lib/locations/google-values"
import { parseListingDraft } from "@/lib/locations/forms/listing-draft"

const initial = draftFromLocation({ storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], locality: "Cambridge", postalCode: "CB1 1AA", administrativeArea: "Cambridgeshire", languageCode: "en", sublocality: "Centre", futureField: "preserve" } })
it("changes only the selected address component without replacing siblings", () => {
  const next = { ...initial, locality: "Girton" }
  const change = buildLocationUpdate(initial, next)
  expect(change.updateMask).toEqual(["storefrontAddress.locality"])
  expect(() => assertBusinessInformationMask(change.payload, change.updateMask)).not.toThrow()
  expect(locationDiffRows(change.updateMask, initial, next)).toEqual([{ key: "storefrontAddress.locality", label: "Town or city", currentValue: "Cambridge", nextValue: "Girton" }])
})
it("makes street-line and postcode removal explicit and does not invent a whole-address clear", () => {
  const next = { ...initial, addressLines: [], postalCode: "" }
  const change = buildLocationUpdate(initial, next)
  expect(change.updateMask).toEqual(["storefrontAddress.addressLines", "storefrontAddress.postalCode"])
  expect(change.payload).toMatchObject({ storefrontAddress: { addressLines: [], postalCode: "", locality: "Cambridge", regionCode: "GB" } })
  expect(locationDiffRows(change.updateMask, initial, next).every((row) => row.nextValue === null)).toBe(true)
})
it("includes an intentional country change and rejects missing selected values", () => {
  expect(buildLocationUpdate(initial, { ...initial, regionCode: "IE" }).updateMask).toEqual(["storefrontAddress.regionCode"])
  expect(() => assertBusinessInformationMask({ storefrontAddress: {} }, ["storefrontAddress.locality"])).toThrow()
})
it("requires exact address readback but recognises omitted default values", () => {
  expect(addressFieldMatches({ locality: "Girton", extra: true }, { locality: "Girton" }, "locality")).toBe(true)
  expect(addressFieldMatches({}, { postalCode: "" }, "postalCode")).toBe(true)
  expect(addressFieldMatches({ postalCode: "CB1" }, { postalCode: "" }, "postalCode")).toBe(false)
  expect(addressFieldMatches({}, { addressLines: [] }, "addressLines")).toBe(true)
  expect(addressFieldMatches({ addressLines: ["retained"] }, { addressLines: [] }, "addressLines")).toBe(false)
  expect(addressFieldMatches({ addressLines: ["2", "1"] }, { addressLines: ["1", "2"] }, "addressLines")).toBe(false)
  expect(addressFieldMatches([], { locality: "" }, "locality")).toBe(false)
  expect(addressFieldMatches({}, {}, "locality")).toBe(false)
})

it("restores optional district and county values without inventing absent fields", () => {
  expect(parseListingDraft(initial)).toMatchObject({ administrativeArea: "Cambridgeshire", sublocality: "Centre" })
  const empty = draftFromLocation({})
  expect(empty.administrativeArea).toBeUndefined()
  expect(empty.sublocality).toBeUndefined()
  expect(buildLocationUpdate(empty, { ...empty, administrativeArea: "", sublocality: "" }).updateMask).toEqual([])
})

it("reviews district editing and county clearing as independent changes", () => {
  const next = { ...initial, administrativeArea: "", sublocality: "North" }
  const change = buildLocationUpdate(initial, next)
  expect(change.updateMask).toEqual(["storefrontAddress.administrativeArea", "storefrontAddress.sublocality"])
  expect(change.payload).toMatchObject({ storefrontAddress: { administrativeArea: "", sublocality: "North" } })
  expect(() => assertBusinessInformationMask(change.payload, change.updateMask)).not.toThrow()
  expect(locationDiffRows(change.updateMask, initial, next)).toEqual([
    { key: "storefrontAddress.administrativeArea", label: "County or region", currentValue: "Cambridgeshire", nextValue: null },
    { key: "storefrontAddress.sublocality", label: "District or neighbourhood", currentValue: "Centre", nextValue: "North" },
  ])
  expect(addressFieldMatches({}, { administrativeArea: "" }, "administrativeArea")).toBe(true)
  expect(addressFieldMatches({ administrativeArea: "retained" }, { administrativeArea: "" }, "administrativeArea")).toBe(false)
  expect(locationDiffRows(["storefrontAddress"], initial, next)[0]).toMatchObject({ currentValue: "10 High Street, Centre, Cambridge, Cambridgeshire, CB1 1AA", nextValue: "10 High Street, North, Cambridge, CB1 1AA" })
})

it("preserves and independently reviews language, organisation, recipients and sorting code", () => {
  const before = draftFromLocation({ storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], languageCode: "en", organization: "Example", recipients: ["Reception", "Manager"], sortingCode: "old" } })
  expect(parseListingDraft(before)).toEqual(before)
  const after = { ...before, addressLanguageCode: "cy", addressOrganization: "", addressRecipients: [], addressSortingCode: "" }
  const change = buildLocationUpdate(before, after)
  expect(change.updateMask).toEqual(["storefrontAddress.languageCode", "storefrontAddress.organization", "storefrontAddress.sortingCode", "storefrontAddress.recipients"])
  expect(businessInformationPayloadSchema.safeParse(change.payload).success).toBe(true)
  expect(locationDiffRows(change.updateMask, before, after).map((row) => row.nextValue)).toEqual(["cy", null, null, null])
  expect(addressFieldMatches({}, { recipients: [] }, "recipients")).toBe(true)
  expect(addressFieldMatches({ recipients: ["retained"] }, { recipients: [] }, "recipients")).toBe(false)
  expect(addressFieldMatches({ recipients: ["B", "A"] }, { recipients: ["A", "B"] }, "recipients")).toBe(false)
  const empty = draftFromLocation({})
  expect(empty.addressLanguageCode).toBeUndefined()
  expect(buildLocationUpdate(empty, { ...empty, addressLanguageCode: "", addressOrganization: "", addressRecipients: [], addressSortingCode: "" }).updateMask).toEqual([])
})

it("validates language tags and protects malformed selected address values", () => {
  for (const languageCode of ["", "en", "cy", "zh-Hant"]) expect(businessInformationPayloadSchema.safeParse({ storefrontAddress: { regionCode: "GB", addressLines: [], languageCode } }).success).toBe(true)
  for (const languageCode of ["en_GB", "not a tag", "en--GB"]) expect(businessInformationPayloadSchema.safeParse({ storefrontAddress: { regionCode: "GB", addressLines: [], languageCode } }).success).toBe(false)
  expect(unsupportedAddressDetails({ recipients: ["valid", 1] }, ["storefrontAddress.recipients"])).toBe(true)
  expect(unsupportedAddressDetails({ recipients: ["valid", 1], languageCode: "en" }, ["storefrontAddress.languageCode"])).toBe(false)
  expect(unsupportedAddressDetails({ futureField: true, recipients: ["valid"] }, ["storefrontAddress.recipients"])).toBe(false)
})
