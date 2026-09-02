import { z } from "zod"

import {
  mediaDeleteRequestSchema,
  mediaUpdateRequestSchema,
} from "@/lib/contracts/location-media"
import { removeMedia, updateMedia } from "@/lib/server/media"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), mediaId: z.string() })

export const PATCH = route({
  params: paramsSchema,
  body: mediaUpdateRequestSchema,
  handler: ({ session, params, body, requestId }) =>
    updateMedia({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      mediaId: params.mediaId,
      category: body.category,
      expectedGoogleHash: body.expectedGoogleHash,
      requestId,
    }),
})

export const DELETE = route({
  params: paramsSchema,
  body: mediaDeleteRequestSchema,
  handler: ({ session, params, body, requestId }) =>
    removeMedia({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      mediaId: params.mediaId,
      expectedGoogleHash: body.expectedGoogleHash,
      requestId,
    }),
})
