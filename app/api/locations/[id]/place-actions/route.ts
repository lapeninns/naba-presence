import { NextResponse } from "next/server"
import { z } from "zod"

import {
  placeActionCreateRequestSchema,
  type PlaceActionMutationOutcome,
  type PlaceActionsResponse,
} from "@/lib/contracts/location-place-actions"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { loadPlaceActions } from "@/lib/server/place-actions"
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
  // Parks for a second publisher in two-person mode (a 202);
  // lib/server/listing-change-registry.ts.
  handler: async ({ session, params, body, requestId }) => {
    const created = await submitListingChange("place_action_create", {
      session,
      locationId: params.id,
      body,
      requestId,
    })
    if (created instanceof Response) return created
    return NextResponse.json(created satisfies PlaceActionMutationOutcome, {
      status: 201,
    })
  },
})
