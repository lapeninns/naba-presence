import { NextResponse } from "next/server"
import { z } from "zod"

import {
  localPostInputSchema,
  postsListQuerySchema,
  type PostCreateResponse,
} from "@/lib/contracts/location-posts"
import { createLocalPostDraft, listLocalPosts } from "@/lib/server/posts"
import { route } from "@/lib/server/route"

const paramsSchema = z.object({ id: z.string() })

export const GET = route({
  params: paramsSchema,
  query: postsListQuerySchema,
  handler: ({ session, params, query }) =>
    listLocalPosts(session.organisationId, session, params.id, query),
})

export const POST = route({
  params: paramsSchema,
  body: localPostInputSchema,
  handler: async ({ session, params, body, requestId }) => {
    const post = await createLocalPostDraft(
      session.organisationId,
      session,
      params.id,
      body,
      requestId
    )
    return NextResponse.json({ post } satisfies PostCreateResponse, {
      status: 201,
    })
  },
})
