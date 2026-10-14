import { z } from "zod"

import {
  placeActionCreateRequestSchema,
  type PlaceActionsResponse,
} from "@/lib/contracts/location-place-actions"
import {
  loadPlaceActions,
} from "@/lib/server/place-actions"
import { route } from "@/lib/server/route"
import { ApiError } from "@/lib/server/http"

export const maxDuration = 60

const paramsSchema = z.object({ id: z.string() })

export const GET = route({
  maxDuration,
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
  maxDuration,
  params: paramsSchema,
  body: placeActionCreateRequestSchema,
  handler: () => { throw new ApiError(409, "place_action_review_required", "Prepare and approve an exact action link review before sending it to Google.") },
})
