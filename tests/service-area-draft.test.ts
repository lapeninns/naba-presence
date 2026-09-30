import { expect, it } from "vitest"
import { buildLocationUpdate, draftFromLocation } from "@/lib/locations/business-information-draft"
import { locationDiffRows } from "@/lib/locations/google-values"
import { parseListingDraft } from "@/lib/locations/forms/listing-draft"
import { serviceAreaTransitionError } from "@/lib/domain/google-service-area"

const area = { businessType: "CUSTOMER_AND_BUSINESS_LOCATION" as const, regionCode: "GB", places: { placeInfos: [{ placeName: "Cambridge", placeId: "ChIJ_existing" }] } }
const location = { serviceArea: area, storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"], locality: "Cambridge" } }

it("retains existing place identifiers and country through loading and draft restoration", () => {
  const draft = draftFromLocation(location)
  expect(draft.serviceArea).toEqual(area)
  expect(parseListingDraft(draft)?.serviceArea).toEqual(area)
  expect(buildLocationUpdate(draft, draft).updateMask).toEqual([])
  expect(draftFromLocation({}).serviceArea).toBeUndefined()
})

it("reviews a customer-only conversion with a specific whole-address clear", () => {
  const initial = draftFromLocation(location)
  const next = { ...initial, serviceArea: { ...area, businessType: "CUSTOMER_LOCATION_ONLY" as const }, clearStorefrontAddress: true, locality: "Changed locally" }
  const change = buildLocationUpdate(initial, next)
  expect(change.updateMask).toEqual(["serviceArea", "storefrontAddress"])
  expect(change.payload).toEqual({ serviceArea: next.serviceArea, storefrontAddress: {} })
  expect(parseListingDraft(next)?.clearStorefrontAddress).toBe(true)
  const rows = locationDiffRows(change.updateMask, initial, next)
  expect(rows[0]).toMatchObject({ currentValue: "Business and customer locations; GB; Cambridge (ChIJ_existing)", nextValue: "Customer locations only; GB; Cambridge (ChIJ_existing)" })
  expect(rows[1]).toMatchObject({ currentValue: "10 High Street, Cambridge", nextValue: null })
  expect(serviceAreaTransitionError(location, change.payload, change.updateMask)).toBeNull()
})

it("keeps place clearing explicit without changing the business type or country", () => {
  const initial = draftFromLocation(location)
  const next = { ...initial, serviceArea: { ...area, places: { placeInfos: [] } } }
  expect(buildLocationUpdate(initial, next)).toEqual({ updateMask: ["serviceArea"], payload: { serviceArea: next.serviceArea } })
  expect(locationDiffRows(["serviceArea"], initial, next)[0].nextValue).toBe("Business and customer locations; GB")
})

it("blocks replacing unknown provider fields while allowing unrelated profile edits", () => {
  for (const serviceArea of [
    { ...area, futureField: "preserve" },
    { ...area, places: { ...area.places, futureField: true } },
    { ...area, places: { placeInfos: [{ ...area.places.placeInfos[0], futureField: true }] } },
  ]) {
    expect(serviceAreaTransitionError({ serviceArea }, { serviceArea: area }, ["serviceArea"])).toMatch(/cannot preserve/)
    expect(serviceAreaTransitionError({ serviceArea }, { title: "New name" }, ["title"])).toBeNull()
  }
})
