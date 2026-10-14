import { NextResponse } from "next/server"
import { z } from "zod"

import {
  localPostInputSchema,
  postsListQuerySchema,
  type PostCreateResponse,
} from "@/lib/contracts/location-posts"
import { readPostsListResponse } from "@/lib/server/listing-reads"
import { createLocalPostDraft } from "@/lib/server/posts"
import { route } from "@/lib/server/route"

// Not 60: its Google calls (up to 100 live post pages on a first page) do not
// stop at ctx.deadline yet, so this keeps the platform default it ran under.
export const maxDuration = 300

const paramsSchema = z.object({ id: z.string() })

export const GET = route({
  maxDuration,
  params: paramsSchema,
  query: postsListQuerySchema,
  // The read lives in lib/server/listing-reads.ts so the posts page's
  // streamed server prefetch produces exactly what this route answers.
  handler: ({ session, params, query }) =>
    readPostsListResponse(session, params.id, query),
})

export const POST = route({
  maxDuration,
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
