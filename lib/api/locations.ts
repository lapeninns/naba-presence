import { z } from "zod"

import { apiFetch } from "./client"

// GET /api/location-links returns the role-scoped location directory
// (default view), name-ordered. We only need {id, name} for the filter, so
// the schema strips googleLocationName even when present.
const locationEntrySchema = z.object({ id: z.string(), name: z.string() })
export type LocationEntry = z.infer<typeof locationEntrySchema>

const locationsResponseSchema = z.object({
  locations: z.array(locationEntrySchema),
})
export type LocationsResponse = z.infer<typeof locationsResponseSchema>

export function fetchLocations() {
  return apiFetch("/api/location-links", { schema: locationsResponseSchema })
}
