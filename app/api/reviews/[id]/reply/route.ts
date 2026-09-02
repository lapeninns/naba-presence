import {
  reviewIdParamsSchema,
  type DeleteReplyResult,
} from "@/lib/contracts/reviews"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { executeReplyDelete } from "@/lib/server/publishing"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

export const DELETE = route({
  params: reviewIdParamsSchema,
  handler: async ({ session, params, requestId }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(
        503,
        "publishing_paused",
        "Publishing is temporarily paused."
      )
    }
    const outcome = await executeReplyDelete({
      organisationId: session.organisationId,
      session,
      reviewId: params.id,
      requestId,
    })
    if (outcome.status === "ambiguous") {
      throw new ApiError(
        502,
        "google_mutation_ambiguous",
        "Google may have deleted the reply. Its state must be checked before retrying."
      )
    }
    return {
      status: outcome.status,
      publishAttemptId: outcome.attemptId,
    } satisfies DeleteReplyResult
  },
})
