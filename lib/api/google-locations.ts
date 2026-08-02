import { z } from "zod"

import { apiFetch } from "./client"

export const discoveredLocationSchema = z.object({
  id: z.string(),
  accountName: z.string(),
  googleLocationName: z.string(),
  title: z.string(),
  address: z.string(),
  verified: z.boolean(),
})

const locationsResponseSchema = z.object({ locations: z.array(discoveredLocationSchema) })

export type DiscoveredLocation = z.infer<typeof discoveredLocationSchema>

export function fetchGoogleLocations(accountName?: string | null) {
  const path = accountName
    ? `/api/google/locations?account_name=${encodeURIComponent(accountName)}`
    : "/api/google/locations"
  return apiFetch(path, { schema: locationsResponseSchema })
}
