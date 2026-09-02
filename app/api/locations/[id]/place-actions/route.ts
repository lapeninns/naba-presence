import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createPlaceAction,
  loadPlaceActions,
  placeActionInputSchema,
} from "@/lib/server/place-actions"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string() })

const createSchema = placeActionInputSchema.extend({
  confirmation: z.literal("create_google_place_action"),
})

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) => ({
    placeActions: await loadPlaceActions(
      session.organisationId,
      session,
      params.id
    ),
  }),
})

export const POST = route({
  params: paramsSchema,
  body: createSchema,
  handler: async ({ session, params, body, requestId }) =>
    NextResponse.json(
      await createPlaceAction({
        organisationId: session.organisationId,
        session,
        locationId: params.id,
        payload: {
          uri: body.uri,
          placeActionType: body.placeActionType,
          isPreferred: body.isPreferred,
        },
        requestId,
      }),
      { status: 201 }
    ),
})
