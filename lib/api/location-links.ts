import { z } from "zod"

import { apiFetch } from "./client"

const linkResponseSchema = z.object({
  link: z.object({
    id: z.string(),
    locationId: z.string(),
    externalLocationId: z.string(),
    isActive: z.boolean(),
  }),
})
const unlinkedResponseSchema = z.object({ unlinked: z.literal(true) })

export type LinkResult = z.infer<typeof linkResponseSchema>["link"]

export function linkExternalLocation(input: {
  externalLocationId: string
  locationId?: string
  name?: string
  timezone?: string
  confirmRelink?: boolean
}) {
  return apiFetch("/api/location-links", { method: "POST", body: input, schema: linkResponseSchema })
}

export function unlinkExternalLocation(externalLocationId: string) {
  return apiFetch(
    `/api/location-links?externalLocationId=${encodeURIComponent(externalLocationId)}`,
    { method: "DELETE", schema: unlinkedResponseSchema }
  )
}
