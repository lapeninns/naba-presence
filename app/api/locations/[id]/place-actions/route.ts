import { z } from "zod"

import { editorRefreshQuerySchema } from "@/lib/contracts/editor-freshness"
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
  // `?refresh=1` reads Google past the editor's staleness budget.
  query: editorRefreshQuerySchema,
  handler: async ({ session, params, query }) =>
    ({
      placeActions: await loadPlaceActions(
        session.organisationId,
        session,
        params.id,
        { refresh: query.refresh === "1" }
      ),
    }) satisfies PlaceActionsResponse,
})

export const POST = route({
  params: paramsSchema,
  body: placeActionCreateRequestSchema,
  handler: () => { throw new ApiError(409, "place_action_review_required", "Prepare and approve an exact action link review before sending it to Google.") },
})
