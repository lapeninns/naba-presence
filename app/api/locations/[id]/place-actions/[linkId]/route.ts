import { z } from "zod"

import {
  placeActionDeleteRequestSchema,
  placeActionUpdateRequestSchema,
} from "@/lib/contracts/location-place-actions"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), linkId: z.string() })

export const PATCH = route({
  params: paramsSchema,
  body: placeActionUpdateRequestSchema,
  // Parks for a second publisher in two-person mode
  // (lib/server/listing-change-registry.ts); sent as before otherwise.
  handler: ({ session, params, body, requestId }) =>
    submitListingChange("place_action_update", {
      session,
      locationId: params.id,
      target: params.linkId,
      body,
      requestId,
    }),
})

export const DELETE = route({
  params: paramsSchema,
  body: placeActionDeleteRequestSchema,
  handler: ({ session, params, body, requestId }) =>
    submitListingChange("place_action_delete", {
      session,
      locationId: params.id,
      target: params.linkId,
      body,
      requestId,
    }),
})
