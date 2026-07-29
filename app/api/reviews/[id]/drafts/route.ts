import { NextResponse } from "next/server"
import { z } from "zod"

import { ratingOnlyReply } from "@/lib/domain/rating-only"
import { DRAFT_POLICY_VERSION } from "@/lib/domain/reply-policy"
import { generateReply } from "@/lib/server/ai"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import {
  buildEvidenceHash,
  verifyStoredDraft,
} from "@/lib/server/drafts"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  tone: z
    .enum(["warm_professional", "concise", "empathetic"])
    .default("warm_professional"),
  languageOverride: z.string().trim().min(2).max(12).nullable().default(null),
  businessContext: z.string().trim().max(2000).nullable().default(null),
  body: z.string().trim().min(1).max(4096).optional(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), [
      "owner",
      "admin",
      "member",
    ])
    if (!getServerEnv().DRAFTS_ENABLED) {
      throw new ApiError(
        503,
        "drafts_paused",
        "Draft generation is temporarily paused."
      )
    }
    const { id } = await context.params
    const input = inputSchema.parse(await request.json().catch(() => ({})))
    const correlationId = rid.id
    const result = await withTenant(session.organisationId, async (sql) => {
      const [review] = await sql<
        {
          review_text: string | null
          rating: number
          reviewer_name: string | null
          language: string | null
          language_confidence: number | null
          default_language: string
          location_id: string
          location_name: string
          update_time: Date
        }[]
      >`
        select
          r.review_text,
          r.star_rating as rating,
          r.reviewer_display_name as reviewer_name,
          r.detected_language_code as language,
          r.language_confidence::float as language_confidence,
          o.default_language_code as default_language,
          r.location_id::text as location_id,
          l.name as location_name,
          r.update_time
        from review r
        join location l on l.id = r.location_id
        join organisation o on o.id = r.organisation_id
        where r.id = ${id}
        limit 1
      `
      if (!review) {
        throw new ApiError(404, "review_not_found", "Review not found.")
      }
      await requireLocationAccess(sql, session, review.location_id)
      const language =
        input.languageOverride ??
        (review.language && (review.language_confidence ?? 0) >= 0.7
          ? review.language
          : review.default_language)
      const evidenceHash = buildEvidenceHash({
        reviewId: id,
        updateTime: review.update_time.toISOString(),
        reviewText: review.review_text,
        rating: review.rating,
        location: review.location_name,
        language,
        tone: input.tone,
        businessContext: input.businessContext,
        draftPolicyVersion: DRAFT_POLICY_VERSION,
      })
      const isRatingOnly = !review.review_text?.trim()
      const generated = input.body
        ? { reply: input.body, language }
        : isRatingOnly
          ? ratingOnlyReply(review.rating, language, review.reviewer_name)
          : await generateReply({
              reviewText: review.review_text,
              rating: review.rating,
              reviewerName: review.reviewer_name,
              locationName: review.location_name,
              language,
              tone: input.tone,
              businessContext: input.businessContext,
            })
      const source = input.body ? "human" : isRatingOnly ? "template" : "ai"
      const [draft] = await sql<{ id: string }[]>`
        insert into draft (
          organisation_id,
          review_id,
          source,
          body,
          body_bytes,
          evidence_hash,
          tone,
          language,
          business_context,
          draft_policy_version,
          model_name,
          verification_status,
          created_by
        )
        values (
          ${session.organisationId},
          ${id},
          ${source},
          ${generated.reply},
          ${Buffer.byteLength(generated.reply, "utf8")},
          ${evidenceHash},
          ${input.tone},
          ${language},
          ${input.businessContext},
          ${DRAFT_POLICY_VERSION},
          ${source === "ai" ? getServerEnv().OPENAI_MODEL_DRAFT : null},
          'pending',
          ${session.userId}
        )
        returning id::text as id
      `
      await sql`
        update review
        set workflow_status = 'drafted'
        where id = ${id}
      `
      const verification = await verifyStoredDraft(sql, {
        id: draft.id,
        body: generated.reply,
        review_text: review.review_text,
        reviewer_name: review.reviewer_name,
        location_name: review.location_name,
        rating: review.rating,
        detected_language_code: language,
      })
      await sql`
        update review
        set workflow_status = ${
          verification.verdict === "fail" ? "drafted" : "verified"
        }
        where id = ${id}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: input.body ? "review.draft.edited" : "review.draft.generated",
        subjectType: "review",
        subjectId: id,
        requestId: correlationId,
        metadata: {
          draftId: draft.id,
          evidenceHash,
          source,
          language: generated.language,
          verificationVerdict: verification.verdict,
          clientRequestId: rid.clientId,
        },
      })
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "review.draft.verification_completed",
        subjectType: "review",
        subjectId: id,
        requestId: `${correlationId}:verification`,
        metadata: {
          draftId: draft.id,
          verdict: verification.verdict,
          reasons: verification.reasons,
          clientRequestId: rid.clientId,
        },
      })
      return {
        draftId: draft.id,
        body: generated.reply,
        bodyBytes: Buffer.byteLength(generated.reply, "utf8"),
        evidenceHash,
        verification,
      }
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}
