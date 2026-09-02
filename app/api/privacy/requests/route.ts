import { NextResponse } from "next/server"

import {
  privacyRequestCreateSchema,
  privacyRequestUpdateSchema,
  type PrivacyRequestType,
} from "@/lib/contracts/privacy"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ tenant }) => {
    const requests = await tenant(
      (sql) => sql`
        select
          id::text as id,
          request_type as "requestType",
          status,
          subject_reference as "subjectReference",
          reason,
          requested_by::text as "requestedBy",
          resolved_by::text as "resolvedBy",
          resolution_note as "resolutionNote",
          resolved_at as "resolvedAt",
          created_at as "createdAt",
          updated_at as "updatedAt"
        from privacy_request
        order by created_at desc
        limit 500
      `
    )
    return { requests }
  },
})

export const POST = route({
  roles: ["owner", "admin"],
  body: privacyRequestCreateSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const privacyRequest = await tenant(async (sql) => {
      const [row] = await sql`
        insert into privacy_request (
          organisation_id,
          request_type,
          subject_reference,
          reason,
          requested_by
        )
        values (
          ${session.organisationId},
          ${input.requestType},
          ${input.subjectReference},
          ${input.reason ?? null},
          ${session.userId}
        )
        returning
          id::text as id,
          request_type as "requestType",
          status,
          subject_reference as "subjectReference",
          created_at as "createdAt"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "privacy.request.created",
        subjectType: "privacy_request",
        subjectId: String(row.id),
        requestId,
        metadata: {
          requestType: input.requestType,
          subjectReference: input.subjectReference,
          clientRequestId,
        },
      })
      return row
    })
    return NextResponse.json({ request: privacyRequest }, { status: 201 })
  },
})

export const PATCH = route({
  roles: ["owner"],
  body: privacyRequestUpdateSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    if ("action" in input) {
      const result = await tenant(async (sql) => {
        const [privacyRequest] = await sql<
          {
            id: string
            requestType: PrivacyRequestType
            status: string
            subjectReference: string
          }[]
        >`
          select
            id::text as id,
            request_type as "requestType",
            status,
            subject_reference as "subjectReference"
          from privacy_request
          where id = ${input.id}
          for update
        `
        if (!privacyRequest) {
          throw new ApiError(
            404,
            "privacy_request_not_found",
            "Privacy request not found."
          )
        }
        const matches = await sql<{ id: string }[]>`
          select id::text as id
          from review
          where google_review_id_hash =
              ${sha256(privacyRequest.subjectReference)}
            or google_review_name_hash =
              ${sha256(privacyRequest.subjectReference)}
            or lower(coalesce(reviewer_display_name, '')) =
              lower(${privacyRequest.subjectReference})
          order by id
        `
        const reviewIds = matches.map(({ id }) => id)
        if (
          privacyRequest.requestType === "erasure" &&
          reviewIds.length
        ) {
          const holds = await sql<{ reviewId: string }[]>`
            select review_id::text as "reviewId"
            from legal_hold
            where review_id in ${sql(reviewIds)}
              and released_at is null
            order by review_id
          `
          if (holds.length) {
            return {
              blocked: true as const,
              holds: holds.map(({ reviewId }) => reviewId),
            }
          }
        }

        let reviewsAffected = 0
        let mediaRemoved = 0
        if (
          privacyRequest.requestType === "erasure" &&
          reviewIds.length
        ) {
          const media = await sql`
            delete from review_media_item
            where review_id in ${sql(reviewIds)}
            returning id
          `
          const reviews = await sql`
            update review
            set
              reviewer_display_name = 'Removed reviewer',
              reviewer_profile_photo_url = null,
              review_text = null,
              raw_payload = null
            where id in ${sql(reviewIds)}
            returning id
          `
          mediaRemoved = media.count
          reviewsAffected = reviews.count
        } else if (
          privacyRequest.requestType === "restriction" &&
          reviewIds.length
        ) {
          const reviews = await sql`
            update review
            set restricted_at = now()
            where id in ${sql(reviewIds)}
            returning id
          `
          reviewsAffected = reviews.count
        }
        // Access is fulfilled by the existing export route. Rectification
        // records the verified resolution without mutating provider data.
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "privacy.request.fulfilled",
          subjectType: "privacy_request",
          subjectId: input.id,
          requestId,
          metadata: {
            requestType: privacyRequest.requestType,
            reviewsMatched: reviewIds.length,
            reviewsAffected,
            mediaRemoved,
            resolutionNote: input.resolutionNote,
            clientRequestId,
          },
        })
        const [completed] = await sql`
          update privacy_request
          set
            status = 'completed',
            resolution_note = ${input.resolutionNote},
            resolved_by = ${session.userId},
            resolved_at = now()
          where id = ${input.id}
          returning
            id::text as id,
            request_type as "requestType",
            status,
            subject_reference as "subjectReference",
            resolution_note as "resolutionNote",
            resolved_at as "resolvedAt"
        `
        return { blocked: false as const, request: completed }
      })
      if (result.blocked) {
        return NextResponse.json(
          {
            error: "privacy_legal_hold",
            message:
              "Matching reviews are protected by an active legal hold.",
            holds: result.holds,
          },
          { status: 409 }
        )
      }
      return { request: result.request }
    }
    const privacyRequest = await tenant(async (sql) => {
      const [row] = await sql`
        update privacy_request
        set
          status = ${input.status},
          resolution_note = ${input.resolutionNote},
          resolved_by = case
            when ${input.status} in ('completed', 'rejected')
              then ${session.userId}
            else null
          end,
          resolved_at = case
            when ${input.status} in ('completed', 'rejected') then now()
            else null
          end
        where id = ${input.id}
        returning
          id::text as id,
          request_type as "requestType",
          status,
          subject_reference as "subjectReference",
          resolution_note as "resolutionNote",
          resolved_at as "resolvedAt"
      `
      if (!row) {
        throw new ApiError(
          404,
          "privacy_request_not_found",
          "Privacy request not found."
        )
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "privacy.request.status_changed",
        subjectType: "privacy_request",
        subjectId: input.id,
        requestId,
        metadata: {
          status: input.status,
          resolutionNote: input.resolutionNote,
          clientRequestId,
        },
      })
      return row
    })
    return { request: privacyRequest }
  },
})
