import { z } from "zod"

import {
  placeActionDeleteRequestSchema,
  placeActionUpdateRequestSchema,
} from "@/lib/contracts/location-place-actions"
import { removePlaceAction, updatePlaceAction } from "@/lib/server/place-actions"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), linkId: z.string() })

export const PATCH = route({
  params: paramsSchema,
  body: placeActionUpdateRequestSchema,
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
  body: placeActionDeleteRequestSchema,
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
