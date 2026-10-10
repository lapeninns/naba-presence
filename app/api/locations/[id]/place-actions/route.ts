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
  handler: () => { throw new ApiError(409, "place_action_review_required", "Prepare and approve an exact action link review before sending it to Google.") },
})
