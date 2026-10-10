import { expect, it } from "vitest"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { emptyStorefrontAddress, googleServiceAreaSchema, serviceAreasMatch, serviceAreaTransitionError } from "@/lib/domain/google-service-area"

const hybrid = { businessType: "CUSTOMER_AND_BUSINESS_LOCATION" as const, regionCode: "GB" }
const mobile = { businessType: "CUSTOMER_LOCATION_ONLY" as const, regionCode: "GB" }
const area = { placeName: "Cambridge", placeId: "ChIJ_test-123" }
const current = { serviceArea: hybrid, storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } }

it("requires an explicitly reviewed storefront clear when becoming customer-only", () => {
  expect(serviceAreaTransitionError(current, { serviceArea: mobile }, ["serviceArea"])).toMatch(/explicitly clear/)
  expect(serviceAreaTransitionError(current, { serviceArea: mobile, storefrontAddress: {} }, ["serviceArea", "storefrontAddress"])).toBeNull()
  expect(serviceAreaTransitionError(current, { storefrontAddress: {} }, ["storefrontAddress"])).toMatch(/requires/)
  expect(serviceAreaTransitionError({}, { serviceArea: { businessType: mobile.businessType }, storefrontAddress: {} }, ["serviceArea", "storefrontAddress"])).toMatch(/country code/)
  expect(businessInformationPayloadSchema.safeParse({ serviceArea: mobile, storefrontAddress: {} }).success).toBe(true)
})

it("rejects storefront edits for customer-only businesses and country changes", () => {
  expect(serviceAreaTransitionError({ serviceArea: mobile }, { storefrontAddress: { locality: "Cambridge" } }, ["storefrontAddress.locality"])).toMatch(/cannot publish/)
  expect(serviceAreaTransitionError(current, { serviceArea: { ...hybrid, regionCode: "IE" } }, ["serviceArea"])).toMatch(/cannot be changed/)
  expect(serviceAreaTransitionError({ serviceArea: mobile }, { serviceArea: mobile }, ["serviceArea"])).toBeNull()
  expect(serviceAreaTransitionError({ serviceArea: mobile }, { serviceArea: hybrid, storefrontAddress: current.storefrontAddress }, ["serviceArea", "storefrontAddress"])).toBeNull()
})

it("validates place formats, duplicates and the provider's twenty-area limit", () => {
  const parse = (placeInfos: unknown[]) => googleServiceAreaSchema.safeParse({ ...hybrid, places: { placeInfos } }).success
  expect(parse([area])).toBe(true)
  expect(parse([area, area])).toBe(false)
  expect(parse([{ ...area, placeId: "https://maps.example/id" }])).toBe(false)
  expect(parse([{ ...area, placeName: " " }])).toBe(false)
  expect(parse(Array.from({ length: 20 }, (_, i) => ({ ...area, placeId: `id_${i}` })))).toBe(true)
  expect(parse(Array.from({ length: 21 }, (_, i) => ({ ...area, placeId: `id_${i}` })))).toBe(false)
})

it("requires the exact service-area set while allowing provider reordering", () => {
  const second = { placeName: "Ely", placeId: "id_ely" }
  const expected = { ...hybrid, places: { placeInfos: [area, second] } }
  expect(serviceAreasMatch({ ...hybrid, places: { placeInfos: [second, area] } }, expected)).toBe(true)
  expect(serviceAreasMatch({ ...hybrid, places: { placeInfos: [area, area] } }, expected)).toBe(false)
  expect(serviceAreasMatch(expected, { ...hybrid, places: { placeInfos: [area] } })).toBe(false)
  expect(serviceAreasMatch({ ...expected, regionCode: "IE" }, expected)).toBe(false)
  expect(serviceAreasMatch({ ...expected, businessType: mobile.businessType }, expected)).toBe(false)
})

it("does not confirm clears from retained or malformed provider data", () => {
  expect(serviceAreasMatch(hybrid, hybrid)).toBe(true)
  expect(serviceAreasMatch({ ...hybrid, places: { placeInfos: [area] } }, hybrid)).toBe(false)
  expect(serviceAreasMatch({ ...hybrid, places: [] }, hybrid)).toBe(false)
  expect(serviceAreasMatch({ ...hybrid, places: null }, hybrid)).toBe(false)
  expect(serviceAreasMatch({ ...hybrid, places: { placeInfos: null } }, hybrid)).toBe(false)
  expect(emptyStorefrontAddress(undefined)).toBe(true)
  expect(emptyStorefrontAddress({})).toBe(true)
  expect(emptyStorefrontAddress(current.storefrontAddress)).toBe(false)
  expect(emptyStorefrontAddress([])).toBe(false)
})
