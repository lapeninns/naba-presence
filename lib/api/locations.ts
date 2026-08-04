import { z } from "zod"

import { apiFetch } from "./client"

// GET /api/location-links returns the role-scoped location directory
// (default view), name-ordered. The schema strips googleLocationName even
// when present (owner/admin only) — nothing on this path needs it.
//
// `linked` is REQUIRED, not optional, and that is load-bearing: primary
// location resolution ranks linked locations first, and if this payload could
// silently omit the field, a member/viewer would resolve a different primary
// than an owner on the same org with no type error to catch it.
const locationEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  linked: z.boolean(),
})
export type LocationEntry = z.infer<typeof locationEntrySchema>

const locationsResponseSchema = z.object({
  locations: z.array(locationEntrySchema),
})
export type LocationsResponse = z.infer<typeof locationsResponseSchema>

export function fetchLocations() {
  return apiFetch("/api/location-links", { schema: locationsResponseSchema })
}

const managementLocationSchema = z.object({
  locationId: z.string(),
  name: z.string(),
  address: z.unknown().nullable(),
  timezone: z.string(),
  linkId: z.string().nullable(),
  externalLocationId: z.string().nullable(),
  googleLocationName: z.string().nullable(),
  googleTitle: z.string().nullable(),
  verified: z.boolean().nullable(),
})
export type ManagementLocation = z.infer<typeof managementLocationSchema>

const managementResponseSchema = z.object({ locations: z.array(managementLocationSchema) })

export function fetchManagementLocations() {
  return apiFetch("/api/location-links?view=management", { schema: managementResponseSchema })
}

const locationCapabilitiesSchema = z.object({ canEditCanonical: z.boolean(), canPublish: z.boolean() })
export type LocationCapabilities = z.infer<typeof locationCapabilitiesSchema>

const capabilitiesResponseSchema = z.object({ capabilities: locationCapabilitiesSchema })

export function fetchLocationCapabilities(id: string): Promise<LocationCapabilities> {
  return apiFetch(`/api/locations/${id}/capabilities`, { schema: capabilitiesResponseSchema }).then((r) => r.capabilities)
}
