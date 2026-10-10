import { z } from "zod"

export const googleServiceAreaSchema = z.object({
  businessType: z.enum(["CUSTOMER_LOCATION_ONLY", "CUSTOMER_AND_BUSINESS_LOCATION"]),
  regionCode: z.string().regex(/^[A-Z]{2}$/, "Use a two-letter country code.").optional(),
  places: z.object({ placeInfos: z.array(z.object({
    placeName: z.string().trim().min(1).max(255),
    placeId: z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/, "Enter a place identifier without spaces or URL characters."),
  }).strict()).max(20).refine((places) => new Set(places.map((place) => place.placeId)).size === places.length, "Each service area must have a different place ID.") }).strict().optional(),
}).strict()

export type GoogleServiceArea = z.infer<typeof googleServiceAreaSchema>

function record(value: unknown): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value)
  return parsed.success ? parsed.data : {}
}

export function emptyStorefrontAddress(value: unknown): boolean {
  if (value === undefined || value === null) return true
  const parsed = z.record(z.string(), z.unknown()).safeParse(value)
  return parsed.success && Object.keys(parsed.data).length === 0
}

export function serviceAreaTransitionError(current: Record<string, unknown>, payload: Record<string, unknown>, mask: readonly string[]): string | null {
  const changingArea = mask.includes("serviceArea")
  if (changingArea && current.serviceArea !== undefined && !googleServiceAreaSchema.safeParse(current.serviceArea).success) return "Existing service-area data contains values this editor cannot preserve. Manage this change in Google and refresh."
  const before = record(current.serviceArea)
  const next = changingArea ? record(payload.serviceArea) : before
  if (changingArea && typeof before.regionCode === "string" && next.regionCode !== undefined && next.regionCode !== before.regionCode) return "The service-area country cannot be changed after creation."
  const clearsAddress = mask.includes("storefrontAddress") && Object.hasOwn(payload, "storefrontAddress") && emptyStorefrontAddress(payload.storefrontAddress)
  if (clearsAddress && next.businessType !== "CUSTOMER_LOCATION_ONLY") return "Removing the storefront address requires a customer-locations-only business type in the reviewed change."
  if (next.businessType === "CUSTOMER_LOCATION_ONLY") {
    if (changingArea && typeof (next.regionCode ?? before.regionCode) !== "string") return "A customer-locations-only business requires its service-area country code."
    if (changingArea && (before.businessType !== "CUSTOMER_LOCATION_ONLY" || !emptyStorefrontAddress(current.storefrontAddress)) && !clearsAddress) return "Changing to customer locations only must explicitly clear the storefront address in the same review."
    if (mask.some((field) => field.startsWith("storefrontAddress.")) || (mask.includes("storefrontAddress") && !clearsAddress)) return "A customer-locations-only business cannot publish a storefront address."
  }
  return null
}

export function serviceAreasMatch(observed: unknown, expected: GoogleServiceArea): boolean {
  const actual = record(observed)
  if (actual.businessType !== expected.businessType) return false
  if (expected.regionCode !== undefined && actual.regionCode !== expected.regionCode) return false
  const container = z.object({ placeInfos: z.array(z.object({ placeId: z.string(), placeName: z.string() })).optional() }).safeParse(actual.places === undefined ? {} : actual.places)
  if (!container.success) return false
  const places = container.data.placeInfos ?? []
  const wanted = expected.places?.placeInfos ?? []
  if (places.length !== wanted.length || new Set(places.map((place) => place.placeId)).size !== places.length) return false
  return wanted.every((place) => places.some((candidate) => candidate.placeId === place.placeId && candidate.placeName === place.placeName))
}
