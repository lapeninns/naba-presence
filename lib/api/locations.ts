import {
  locationCapabilitiesResponseSchema,
  type LocationCapabilities,
} from "@/lib/contracts/location-capabilities"
import {
  locationsResponseSchema,
  managementLocationsResponseSchema,
  type LocationEntry,
  type LocationsResponse,
  type ManagementLocation,
} from "@/lib/contracts/location-links"

import { apiFetch, type RequestOptions } from "./client"

// Shapes live in lib/contracts/location-links.ts and
// lib/contracts/location-capabilities.ts; re-exported for existing importers.
export type {
  LocationCapabilities,
  LocationEntry,
  LocationsResponse,
  ManagementLocation,
}

// GET /api/location-links returns the role-scoped location directory
// (default view), name-ordered. See locationEntrySchema for why `linked` is
// required and why googleLocationName is stripped.
export function fetchLocations(options?: RequestOptions) {
  return apiFetch("/api/location-links", { schema: locationsResponseSchema, ...options })
}

export function fetchManagementLocations(options?: RequestOptions) {
  return apiFetch("/api/location-links?view=management", {
    schema: managementLocationsResponseSchema,
    ...options,
  })
}

export function fetchLocationCapabilities(id: string, options?: RequestOptions): Promise<LocationCapabilities> {
  return apiFetch(`/api/locations/${id}/capabilities`, {
    schema: locationCapabilitiesResponseSchema,
    ...options,
  }).then((r) => r.capabilities)
}
