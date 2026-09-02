import { apiFetch, type RequestOptions } from "./client"
import { googleLocationsResponseSchema } from "@/lib/contracts/google"

export { discoveredLocationSchema, type DiscoveredLocation } from "@/lib/contracts/google"

export function fetchGoogleLocations(accountName?: string | null, options?: RequestOptions) {
  const path = accountName
    ? `/api/google/locations?account_name=${encodeURIComponent(accountName)}`
    : "/api/google/locations"
  return apiFetch(path, { schema: googleLocationsResponseSchema, ...options })
}
