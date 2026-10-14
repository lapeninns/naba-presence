import { z } from "zod"

import {
  postApprovalDecisionSchema,
  type PostApprovalOutcome,
} from "@/lib/contracts/location-posts"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  rejectLocalPost,
  requestOrPublishLocalPost,
} from "@/lib/server/posts"
import { route } from "@/lib/server/route"

// Not 60: its Google calls (publish write, then a read-back that may list every
// post) do not stop at ctx.deadline yet, so this keeps the platform default it
// ran under.
export const maxDuration = 300

export const POST = route({
  maxDuration,
  mfa: "step_up",
  params: z.object({ id: z.string(), postId: z.string() }),
  body: postApprovalDecisionSchema,
  handler: async ({ session, params, body, requestId }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Google Posts publishing is paused.")
    }
    const decision = {
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      postId: params.postId,
      requestId,
      expectedRevision: body.expectedRevision,
    }
    // Both decisions need decide_approval (lib/server/posts.ts): rejecting is
    // a decision on someone's request, never mere visibility.
    if (body.decision === "reject") {
      return (await rejectLocalPost(decision)) satisfies PostApprovalOutcome
    }
    return (await requestOrPublishLocalPost({
      ...decision,
      approval: true,
    })) satisfies PostApprovalOutcome
  },
})
