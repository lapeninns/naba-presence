import {
  locationActivityResponseSchema,
  type LocationActivityItem,
  type LocationActivityQuery,
  type LocationActivityState,
} from "@/lib/contracts/location-activity"

import { apiFetch, type RequestOptions } from "./client"

// Shapes live in lib/contracts/location-activity.ts; re-exported for existing
// importers.
export type { LocationActivityItem, LocationActivityState }

export function fetchLocationActivity(
  id: string,
  params: LocationActivityQuery = {},
  options?: RequestOptions
): Promise<LocationActivityState> {
  const query = new URLSearchParams()
  if (params.page) query.set("page", String(params.page))
  if (params.pageSize) query.set("pageSize", String(params.pageSize))
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/locations/${id}/activity${suffix}`, {
    schema: locationActivityResponseSchema,
    ...options,
  }).then((r) => r.activity)
}
