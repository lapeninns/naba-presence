import { z } from "zod"

import {
  mediaDeleteRequestSchema,
  mediaUpdateRequestSchema,
} from "@/lib/contracts/location-media"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), mediaId: z.string() })

export const PATCH = route({
  params: paramsSchema,
  body: mediaUpdateRequestSchema,
  // Parks for a second publisher in two-person mode
  // (lib/server/listing-change-registry.ts); sent as before otherwise.
  handler: ({ session, params, body, requestId }) =>
    submitListingChange("media_update", {
      session,
      locationId: params.id,
      target: params.mediaId,
      body,
      requestId,
    }),
})

export const DELETE = route({
  params: paramsSchema,
  body: mediaDeleteRequestSchema,
  handler: ({ session, params, body, requestId }) =>
    submitListingChange("media_delete", {
      session,
      locationId: params.id,
      target: params.mediaId,
      body,
      requestId,
    }),
})
