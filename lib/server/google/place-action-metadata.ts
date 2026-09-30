import "server-only"
import { z } from "zod"
import { GOOGLE_PLACE_ACTION_TYPES, type GooglePlaceActionType } from "@/lib/domain/google-contract"
import { ApiError } from "@/lib/server/http"
import { googleRequest } from "./transport"

const pageSchema = z.object({ placeActionTypeMetadata: z.array(z.object({ placeActionType: z.string().min(1), displayName: z.string().optional() })).default([]), nextPageToken: z.string().optional() })
const knownType = (value: string): value is GooglePlaceActionType => GOOGLE_PLACE_ACTION_TYPES.some((type) => type === value)

export async function listGooglePlaceActionMetadata(accessToken: string, locationName: string, options: { readonly connectionKey?: string } = {}) {
  if (!/^locations\/[A-Za-z0-9_-]+$/.test(locationName)) throw new ApiError(400, "google_target_invalid", "The Google location name is invalid.")
  const types = new Map<string, { placeActionType: string; displayName?: string }>(), seen = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ filter: `location=${locationName}`, pageSize: "100" })
    if (pageToken) query.set("pageToken", pageToken)
    const response = pageSchema.safeParse(await googleRequest<unknown>(`https://mybusinessplaceactions.googleapis.com/v1/placeActionTypeMetadata?${query}`, accessToken, { method: "GET" }, options))
    if (!response.success) throw new ApiError(502, "place_action_metadata_invalid", "Google returned action types that could not be read.")
    for (const item of response.data.placeActionTypeMetadata) types.set(item.placeActionType, item)
    pageToken = response.data.nextPageToken || undefined
    if (!pageToken) return { supportedTypes: [...types.keys()].filter(knownType), unsupportedTypes: [...types.keys()].filter((type) => !knownType(type)), observedAt: new Date().toISOString() }
    if (seen.has(pageToken)) throw new ApiError(502, "place_action_metadata_page_loop", "Google repeated an action-type page. Refresh before making changes.")
    seen.add(pageToken)
  }
  throw new ApiError(502, "place_action_metadata_page_limit", "Google action-type pagination exceeded the safety limit.")
}

export async function requireGooglePlaceActionType(accessToken: string, locationName: string, type: GooglePlaceActionType, options: { readonly connectionKey?: string } = {}) {
  const metadata = await listGooglePlaceActionMetadata(accessToken, locationName, options)
  if (!metadata.supportedTypes.includes(type)) throw new ApiError(409, "place_action_not_supported", "Google does not offer this action type for the exact location. Refresh the available actions.")
  return metadata
}
