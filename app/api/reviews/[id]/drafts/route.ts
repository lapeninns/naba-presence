import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import {
  draftInputSchema,
  reviewIdParamsSchema,
  type DraftResult,
} from "@/lib/contracts/reviews"
import { ratingOnlyReply } from "@/lib/domain/rating-only"
import { DRAFT_POLICY_VERSION } from "@/lib/domain/reply-policy"
import {
  isAllowedReviewTransition,
  type ReviewWorkflowState,
} from "@/lib/domain/workflow"
import { AiOutputError, generateReply, type AiUsage } from "@/lib/server/ai"
import {
  releaseDraftCredit,
  reserveDraftCredit,
  settleDraftCredit,
  tokenBackstopReached,
} from "@/lib/server/ai-credits"
import { recordAiUsageDetached } from "@/lib/server/ai-usage"
import { writeAudit } from "@/lib/server/audit"
import {
  buildEvidenceHash,
  runSemanticVerification,
  verifyStoredDraft,
  type SemanticOutcome,
} from "@/lib/server/drafts"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

type ReviewRecord = {
  review_text: string | null
  rating: number | null
  reviewer_name: string | null
  language: string | null
  language_confidence: number | null
  default_language: string
  location_id: string
  location_name: string
  update_time: Date
  restricted_at: Date | null
  workflow_status: ReviewWorkflowState
}

async function loadReview(
  sql: TransactionSql,
  reviewId: string
): Promise<ReviewRecord> {
  const [review] = await sql<ReviewRecord[]>`
    select
      r.review_text,
      r.star_rating as rating,
      r.reviewer_display_name as reviewer_name,
      r.detected_language_code as language,
      r.language_confidence::float as language_confidence,
      o.default_language_code as default_language,
      r.location_id::text as location_id,
      l.name as location_name,
      r.update_time,
      r.restricted_at,
      r.workflow_status
    from review r
    join location l on l.id = r.location_id
    join organisation o on o.id = r.organisation_id
    where r.id = ${reviewId}
    limit 1
  `
  if (!review) {
    throw new ApiError(404, "review_not_found", "Review not found.")
  }
  return review
}

/**
 * Both writes below move the review to `drafted`, and
 * `enforce_review_workflow_transition` permits that from every state except
 * `publish_requested` — where a raised PL/pgSQL exception is not an ApiError
 * and would leave the operator with an opaque 500. Answer the 409 the copy
 * already exists for instead, and check it again in the settle transaction
 * because a publish can start while the provider call is in flight.
 */
function assertDraftable(review: ReviewRecord) {
  if (review.restricted_at) {
    throw new ApiError(
      409,
      "review_restricted",
      "This review is restricted from reply processing."
    )
  }
  if (!isAllowedReviewTransition(review.workflow_status, "drafted")) {
    throw new ApiError(
      409,
      "publish_in_progress",
      "A publish for this reply is already under way."
    )
  }
}

export const POST = route({
  roles: ["owner", "admin", "member"],
  params: reviewIdParamsSchema,
  body: draftInputSchema,
  handler: async ({
    session,
    params,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    if (!getServerEnv().DRAFTS_ENABLED) {
      throw new ApiError(
        503,
        "drafts_paused",
        "Draft generation is temporarily paused."
      )
    }
    const { id } = params
    const correlationId = requestId

    // Phase one: the gates and the evidence the provider needs. It COMMITS
    // before the OpenAI calls below - a provider that takes 30 seconds must
    // never hold a pooled connection idle in a transaction, or one AI incident
    // drains the pool for sign-in, the inbox and the job runner alike. This is
    // the intent -> provider -> settle shape lib/server/publishing uses.
    // Allocated up front so the credit reservation can name the draft that
    // phase three inserts.
    const draftId = randomUUID()
    // The reservation lives in this transaction too: only an AI-written draft
    // (no typed body, a review with text) costs a credit.
    const { review, reservationId, backstopReached } = await tenant(
      async (sql) => {
        const record = await loadReview(sql, id)
        await requireLocationAccess(sql, session, record.location_id)
        assertDraftable(record)
        const needsModel = !input.body && Boolean(record.review_text?.trim())
        const reservation = needsModel
          ? await reserveDraftCredit(sql, {
              organisationId: session.organisationId,
              model: getServerEnv().OPENAI_MODEL_DRAFT,
              reviewId: id,
              draftId,
              requestId: correlationId,
              userId: session.userId,
            })
          : null
        return {
          review: record,
          reservationId: reservation,
          backstopReached: await tokenBackstopReached(
            sql,
            session.organisationId
          ),
        }
      }
    )

    const language =
      input.languageOverride ??
      (review.language && (review.language_confidence ?? 0) >= 0.7
        ? review.language
        : review.default_language)
    const isRatingOnly = !review.review_text?.trim()

    // Phase two: no connection is held here. A failed provider call releases
    // the reservation (the customer does not pay); a billed but unreadable
    // response keeps its tokens on the released row for the backstop.
    const generated: {
      reply: string
      language: string
      usage?: AiUsage
      model?: string
    } = input.body
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
          }).catch(async (error: unknown) => {
            if (reservationId) {
              await releaseDraftCredit(tenant, {
                id: reservationId,
                usage: error instanceof AiOutputError ? error.usage : undefined,
              })
            }
            throw error
          })
    // Settle straight away: the provider was paid for whatever happens to the
    // draft in phase three (a 409 from a concurrent sync, a later throw).
    if (reservationId && generated.usage && generated.model) {
      await settleDraftCredit(tenant, {
        id: reservationId,
        usage: generated.usage,
        model: generated.model,
        draftId,
      })
    }
    const source = input.body ? "human" : isRatingOnly ? "template" : "ai"
    // Past the token backstop semantic verification is skipped. The draft then
    // stays `pending`, so it still cannot be published unverified.
    const semantic: SemanticOutcome = backstopReached
      ? { status: "skipped", reasons: [] }
      : await runSemanticVerification({
          body: generated.reply,
          reviewText: review.review_text,
          reviewerName: review.reviewer_name,
          locationName: review.location_name,
          rating: review.rating,
          expectedLanguage: language,
        })

    // Verification usage is recorded in its own transaction; a ledger failure
    // never fails the request.
    await recordAiUsageDetached(tenant, [
      ...(semantic.usage && semantic.model
        ? [
            {
              organisationId: session.organisationId,
              kind: "verify" as const,
              credits: 0,
              model: semantic.model,
              usage: semantic.usage,
              reviewId: id,
              draftId,
              requestId: `${correlationId}:verification`,
              userId: session.userId,
            },
          ]
        : []),
    ])

    // Phase three: settle. The review is re-read because a sync can land
    // while the provider is thinking, and the evidence hash has to describe
    // the review this draft is stored against — not the one phase one saw, or
    // the draft is stale the moment it is written. The deterministic checks
    // re-run against that re-read for the same reason; only the semantic
    // reasons above are from the earlier snapshot.
    const result = await tenant(async (sql) => {
      const current = await loadReview(sql, id)
      await requireLocationAccess(sql, session, current.location_id)
      assertDraftable(current)
      const evidenceHash = buildEvidenceHash({
        reviewId: id,
        updateTime: current.update_time.toISOString(),
        reviewText: current.review_text,
        rating: current.rating,
        location: current.location_name,
        language,
        tone: input.tone,
        businessContext: input.businessContext,
        draftPolicyVersion: DRAFT_POLICY_VERSION,
      })
      const [draft] = await sql<{ id: string }[]>`
        insert into draft (
          id,
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
          ${draftId},
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
      // `drafted` first: from `new` there is no edge straight to `verified`.
      await sql`
        update review
        set workflow_status = 'drafted'
        where id = ${id}
      `
      const verification = await verifyStoredDraft(sql, {
        draftId: draft.id,
        body: generated.reply,
        reviewText: current.review_text,
        reviewerName: current.reviewer_name,
        locationName: current.location_name,
        rating: current.rating,
        expectedLanguage: language,
        semantic,
      })
      // `pending` stays at `drafted` alongside `fail`: a draft whose semantic
      // pass could not run has not been verified, and `verified` is what the
      // publish button reads.
      await sql`
        update review
        set workflow_status = ${
          verification.verdict === "pass" || verification.verdict === "warn"
            ? "verified"
            : "drafted"
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
          clientRequestId,
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
          semanticPass: semantic.status,
          clientRequestId,
        },
      })
      return {
        draftId: draft.id,
        body: generated.reply,
        bodyBytes: Buffer.byteLength(generated.reply, "utf8"),
        evidenceHash,
        verification,
      } satisfies DraftResult
    })
    return NextResponse.json(result, { status: 201 })
  },
})
