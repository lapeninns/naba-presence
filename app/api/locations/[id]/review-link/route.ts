import { NextResponse } from "next/server"

import {
  reviewLinkActionSchema,
  reviewLinkCreateSchema,
  reviewLinkParamsSchema,
  type ReviewLinkResponse,
} from "@/lib/domain/review-link-contract"
import {
  requireLocationAccess,
  requireLocationAction,
} from "@/lib/server/permissions"
import {
  createReviewLink,
  readReviewLinkState,
  REVIEW_LINK_LOCATION_NOT_FOUND,
  reviewLinkBaseUrl,
  updateReviewLink,
} from "@/lib/server/review-links"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * A location's review link (lib/server/review-links.ts): the short link to
 * Google's review form and its QR code. Reading is DB-only; anyone who can
 * see the location may read it, and changing it is the "edit" action.
 * Every write answers with the whole state, as GET does.
 */
export const GET = route({
  params: reviewLinkParamsSchema,
  handler: async ({ request, session, params, tenant }) => {
    const reviewLink = await tenant(async (sql) => {
      await requireLocationAccess(
        sql,
        session,
        params.id,
        REVIEW_LINK_LOCATION_NOT_FOUND
      )
      return readReviewLinkState(
        sql,
        session,
        params.id,
        reviewLinkBaseUrl(request)
      )
    })
    return NextResponse.json({ reviewLink } satisfies ReviewLinkResponse, {
      headers: { "Cache-Control": "no-store" },
    })
  },
})

export const POST = route({
  params: reviewLinkParamsSchema,
  body: reviewLinkCreateSchema,
  handler: async ({ request, session, params, body, requestId, tenant }) => {
    const baseUrl = reviewLinkBaseUrl(request)
    const { reviewLink, created } = await tenant(async (sql) => {
      await requireLocationAction(
        sql,
        session,
        params.id,
        "edit",
        REVIEW_LINK_LOCATION_NOT_FOUND
      )
      const result = await createReviewLink(sql, {
        session,
        locationId: params.id,
        requestId,
        baseUrl,
        caption: body.caption,
      })
      return {
        created: result.created,
        reviewLink: await readReviewLinkState(sql, session, params.id, baseUrl),
      }
    })
    return NextResponse.json({ reviewLink } satisfies ReviewLinkResponse, {
      status: created ? 201 : 200,
      headers: { "Cache-Control": "no-store" },
    })
  },
})

export const PATCH = route({
  params: reviewLinkParamsSchema,
  body: reviewLinkActionSchema,
  handler: async ({ request, session, params, body, requestId, tenant }) => {
    const baseUrl = reviewLinkBaseUrl(request)
    const reviewLink = await tenant(async (sql) => {
      await requireLocationAction(
        sql,
        session,
        params.id,
        "edit",
        REVIEW_LINK_LOCATION_NOT_FOUND
      )
      await updateReviewLink(sql, {
        session,
        locationId: params.id,
        requestId,
        baseUrl,
        action: body,
      })
      return readReviewLinkState(sql, session, params.id, baseUrl)
    })
    return NextResponse.json({ reviewLink } satisfies ReviewLinkResponse, {
      headers: { "Cache-Control": "no-store" },
    })
  },
})
