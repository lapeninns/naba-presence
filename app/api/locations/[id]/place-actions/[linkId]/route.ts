import { z } from "zod"

import {
  placeActionInputSchema,
  removePlaceAction,
  updatePlaceAction,
} from "@/lib/server/place-actions"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), linkId: z.string() })

const updateSchema = placeActionInputSchema.extend({
  expectedGoogleHash: z.string().length(64),
  confirmation: z.literal("update_google_place_action"),
})

const deleteSchema = z.object({
  expectedGoogleHash: z.string().length(64),
  confirmation: z.literal("delete_google_place_action"),
})

export const PATCH = route({
  params: paramsSchema,
  body: updateSchema,
  handler: ({ session, params, body, requestId }) =>
    updatePlaceAction({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      linkId: params.linkId,
      payload: {
        uri: body.uri,
        placeActionType: body.placeActionType,
        isPreferred: body.isPreferred,
      },
      expectedGoogleHash: body.expectedGoogleHash,
      requestId,
    }),
})

export const DELETE = route({
  params: paramsSchema,
  body: deleteSchema,
  handler: ({ session, params, body, requestId }) =>
    removePlaceAction({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      linkId: params.linkId,
      expectedGoogleHash: body.expectedGoogleHash,
      requestId,
    }),
})
