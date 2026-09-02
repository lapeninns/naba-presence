import { z } from "zod"

import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  deleteLocalPost,
  localPostInputSchema,
  requestOrPublishLocalPost,
  updateLocalPostDraft,
} from "@/lib/server/posts"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string(), postId: z.string() })

export const PATCH = route({
  params: paramsSchema,
  body: localPostInputSchema,
  handler: async ({ session, params, body, requestId }) => {
    const { id, postId } = params
    const post = await updateLocalPostDraft(
      session.organisationId,
      session,
      id,
      postId,
      body,
      requestId
    )
    if (post.status === "published") {
      if (!getServerEnv().PUBLISH_ENABLED) {
        throw new ApiError(503, "publishing_paused", "Publishing is paused.")
      }
      return requestOrPublishLocalPost({
        organisationId: session.organisationId,
        session,
        locationId: id,
        postId,
        requestId,
      })
    }
    return { post }
  },
})

export const DELETE = route({
  params: paramsSchema,
  handler: ({ session, params, requestId }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Publishing is paused.")
    }
    return deleteLocalPost({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      postId: params.postId,
      requestId,
    })
  },
})
