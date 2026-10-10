import "server-only"
import { z } from "zod"
import { attributeMetadataSchema } from "@/lib/contracts/location-business-information"
import { listGoogleAttributeMetadata } from "./google/locations"
import { ApiError } from "./http"

const pageSchema = z.object({ attributeMetadata: z.array(attributeMetadataSchema).default([]), nextPageToken: z.string().optional() })

export async function loadGoogleAttributeMetadata(token: string, locationName: string, connectionKey: string) {
  const rows: z.infer<typeof attributeMetadataSchema>[] = []
  const visited = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < 50; page += 1) {
    const parsed = pageSchema.safeParse(await listGoogleAttributeMetadata(token, { locationName, pageToken }, { connectionKey }))
    if (!parsed.success) throw new ApiError(502, "attribute_metadata_invalid", "Google returned unreadable attribute metadata.")
    rows.push(...parsed.data.attributeMetadata)
    const next = parsed.data.nextPageToken
    if (!next) return rows
    if (visited.has(next)) break
    visited.add(next)
    pageToken = next
  }
  throw new ApiError(502, "attribute_metadata_incomplete", "Google attribute metadata could not be fully loaded. Refresh before publishing.")
}
