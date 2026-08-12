import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const requestType = z.enum([
  "access",
  "rectification",
  "erasure",
  "restriction",
])
const status = z.enum(["pending", "in_progress", "completed", "rejected"])
const createSchema = z.object({
  requestType,
  subjectReference: z.string().trim().min(3).max(240),
  reason: z.string().trim().max(2000).optional(),
})
const statusUpdateSchema = z.object({
  id: z.uuid(),
  status,
  resolutionNote: z.string().trim().min(3).max(2000),
})
const fulfilSchema = z.object({
  id: z.uuid(),
  action: z.literal("fulfil"),
  resolutionNote: z.string().trim().min(3).max(2000),
})
const updateSchema = z.union([fulfilSchema, statusUpdateSchema])

export async function GET() {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const requests = await withTenant(
      session.organisationId,
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
    return NextResponse.json({ requests })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = createSchema.parse(await request.json())
    const privacyRequest = await withTenant(
      session.organisationId,
      async (sql) => {
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
          requestId: rid.id,
          metadata: {
            requestType: input.requestType,
            subjectReference: input.subjectReference,
            clientRequestId: rid.clientId,
          },
        })
        return row
      }
    )
    return NextResponse.json({ request: privacyRequest }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner"])
    const input = updateSchema.parse(await request.json())
    if ("action" in input) {
      const result = await withTenant(
        session.organisationId,
        async (sql) => {
          const [privacyRequest] = await sql<
            {
              id: string
              requestType:
                | "access"
                | "rectification"
                | "erasure"
                | "restriction"
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
            requestId: rid.id,
            metadata: {
              requestType: privacyRequest.requestType,
              reviewsMatched: reviewIds.length,
              reviewsAffected,
              mediaRemoved,
              resolutionNote: input.resolutionNote,
              clientRequestId: rid.clientId,
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
        }
      )
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
      return NextResponse.json({ request: result.request })
    }
    const privacyRequest = await withTenant(
      session.organisationId,
      async (sql) => {
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
          requestId: rid.id,
          metadata: {
            status: input.status,
            resolutionNote: input.resolutionNote,
            clientRequestId: rid.clientId,
          },
        })
        return row
      }
    )
    return NextResponse.json({ request: privacyRequest })
  } catch (error) {
    return apiError(error)
  }
}
