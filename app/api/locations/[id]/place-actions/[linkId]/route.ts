import { z } from "zod"

import {
  placeActionDeleteRequestSchema,
  placeActionUpdateRequestSchema,
} from "@/lib/contracts/location-place-actions"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), linkId: z.string() })

export const PATCH = route({
  params: paramsSchema,
  body: placeActionUpdateRequestSchema,
  handler: () => { throw new ApiError(409, "place_action_review_required", "Prepare and approve an exact action link review before sending it to Google.") },
})

export const DELETE = route({
  params: paramsSchema,
  body: placeActionDeleteRequestSchema,
  handler: () => { throw new ApiError(409, "place_action_review_required", "Prepare and approve an exact action link review before sending it to Google.") },
})
