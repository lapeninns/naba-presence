import { z } from "zod"

import { GOOGLE_MEDIA_CATEGORIES } from "@/lib/domain/google-contract"
import { removeMedia, updateMedia } from "@/lib/server/media"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), mediaId: z.string() })

const updateSchema = z.object({
  category: z.enum(GOOGLE_MEDIA_CATEGORIES),
  expectedGoogleHash: z.string().length(64),
  confirmation: z.literal("update_google_media"),
})

const deleteSchema = z.object({
  expectedGoogleHash: z.string().length(64),
  confirmation: z.literal("delete_google_media"),
})

export const PATCH = route({
  params: paramsSchema,
  body: updateSchema,
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
  body: deleteSchema,
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
