import type { LocationCapabilities } from "@/lib/contracts/location-capabilities"
import type {
  LocationEntry,
  LocationsResponse,
  ManagementLocation,
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

// Schemas load on demand (see `ResponseSchema` in ./client): the breadcrumbs
// read the location directory on every page, and the contracts pull in zod.
const links = () => import("@/lib/contracts/location-links")

// GET /api/location-links returns the role-scoped location directory
// (default view), name-ordered. See locationEntrySchema for why `linked` is
// required and why googleLocationName is stripped.
export function fetchLocations(options?: RequestOptions) {
  return apiFetch("/api/location-links", {
    schema: () => links().then((m) => m.locationsResponseSchema),
    ...options,
  })
}

export function fetchManagementLocations(options?: RequestOptions) {
  return apiFetch("/api/location-links?view=management", {
    schema: () => links().then((m) => m.managementLocationsResponseSchema),
    ...options,
  })
}

export function fetchLocationCapabilities(id: string, options?: RequestOptions): Promise<LocationCapabilities> {
  return apiFetch(`/api/locations/${id}/capabilities`, {
    schema: () =>
      import("@/lib/contracts/location-capabilities").then(
        (m) => m.locationCapabilitiesResponseSchema
      ),
    ...options,
  }).then((r) => r.capabilities)
}
