import {
  linkLocationResponseSchema,
  unlinkLocationResponseSchema,
  type LinkLocationInput,
  type LocationLink,
} from "@/lib/contracts/location-links"

import { apiFetch } from "./client"

// The link shape lives in lib/contracts/location-links.ts; the old alias is
// kept for existing importers.
export type LinkResult = LocationLink

export function linkExternalLocation(input: LinkLocationInput) {
  return apiFetch("/api/location-links", {
    method: "POST",
    body: input,
    schema: linkLocationResponseSchema,
  })
}

export function unlinkExternalLocation(externalLocationId: string) {
  return apiFetch(
    `/api/location-links?externalLocationId=${encodeURIComponent(externalLocationId)}`,
    { method: "DELETE", schema: unlinkLocationResponseSchema }
  )
}
