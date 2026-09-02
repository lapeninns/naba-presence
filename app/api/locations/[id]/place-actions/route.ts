import { NextResponse } from "next/server"
import { z } from "zod"

import {
  placeActionCreateRequestSchema,
  type PlaceActionMutationOutcome,
  type PlaceActionsResponse,
} from "@/lib/contracts/location-place-actions"
import {
  createPlaceAction,
  loadPlaceActions,
} from "@/lib/server/place-actions"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string() })

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({
      placeActions: await loadPlaceActions(
        session.organisationId,
        session,
        params.id
      ),
    }) satisfies PlaceActionsResponse,
})

export const POST = route({
  params: paramsSchema,
  body: placeActionCreateRequestSchema,
  handler: async ({ session, params, body, requestId }) =>
    NextResponse.json(
      (await createPlaceAction({
        organisationId: session.organisationId,
        session,
        locationId: params.id,
        payload: {
          uri: body.uri,
          placeActionType: body.placeActionType,
          isPreferred: body.isPreferred,
        },
        requestId,
      })) satisfies PlaceActionMutationOutcome,
      { status: 201 }
    ),
})
