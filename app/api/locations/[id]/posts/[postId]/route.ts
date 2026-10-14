import { z } from "zod"

import {
  localPostInputSchema,
  type PostDeleteOutcome,
  type PostUpdateResponse,
} from "@/lib/contracts/location-posts"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  deleteLocalPost,
  requestOrPublishLocalPost,
  updateLocalPostDraft,
} from "@/lib/server/posts"
import { route } from "@/lib/server/route"

// Not 60: its Google calls (write, then a read-back that may list every post)
// do not stop at ctx.deadline yet, so this keeps the platform default it ran
// under.
export const maxDuration = 300

const paramsSchema = z.object({ id: z.string(), postId: z.string() })

const updateBodySchema = z.intersection(localPostInputSchema, z.object({ expectedUpdatedAt: z.iso.datetime().optional() }))

export const PATCH = route({
  maxDuration,
  params: paramsSchema,
  body: updateBodySchema,
  handler: async ({ session, params, body, requestId }) => {
    const { id, postId } = params
    const post = await updateLocalPostDraft(
      session.organisationId,
      session,
      id,
      postId,
      body,
      requestId,
      body.expectedUpdatedAt
    )
    if (post.status === "published") {
      if (!gbpWritesEnabled(getServerEnv(), "posts")) {
        throw new ApiError(503, "publishing_paused", "Publishing is paused.")
      }
      return (await requestOrPublishLocalPost({
        organisationId: session.organisationId,
        session,
        locationId: id,
        postId,
        requestId,
      })) satisfies PostUpdateResponse
    }
    return { post } satisfies PostUpdateResponse
  },
})

export const DELETE = route({
  maxDuration,
  mfa: "step_up",
  params: paramsSchema,
  handler: async ({ session, params, requestId }) => {
    if (!gbpWritesEnabled(getServerEnv(), "posts")) {
      throw new ApiError(503, "publishing_paused", "Publishing is paused.")
    }
    return (await deleteLocalPost({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      postId: params.postId,
      requestId,
    })) satisfies PostDeleteOutcome
  },
})
