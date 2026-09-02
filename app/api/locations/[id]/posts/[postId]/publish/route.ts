import { NextResponse } from "next/server"
import { z } from "zod"

import type { PostPublishOutcome } from "@/lib/contracts/location-posts"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { requestOrPublishLocalPost } from "@/lib/server/posts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

export const POST = route({
  params: z.object({ id: z.string(), postId: z.string() }),
  handler: async ({ session, params, requestId }) => {
    if (!getServerEnv().PUBLISH_ENABLED) {
      throw new ApiError(503, "publishing_paused", "Google Posts publishing is paused.")
    }
    const outcome = (await requestOrPublishLocalPost({
      organisationId: session.organisationId,
      session,
      locationId: params.id,
      postId: params.postId,
      requestId,
    })) satisfies PostPublishOutcome
    return NextResponse.json(outcome, {
      status: outcome.status === "awaiting_approval" ? 202 : 200,
    })
  },
})
