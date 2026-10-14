import "server-only"

import { randomUUID } from "node:crypto"

import type { TransactionSql } from "postgres"

import {
  verificationReasonSchema,
  type DraftResult,
  type draftInputSchema,
} from "@/lib/contracts/reviews"
import type { z } from "zod"
import { ratingOnlyReply } from "@/lib/domain/rating-only"
import { DRAFT_POLICY_VERSION } from "@/lib/domain/reply-policy"
import {
  isAllowedReviewTransition,
  type ReviewWorkflowState,
} from "@/lib/domain/workflow"
import {
  AiOutputError,
  generateReply,
  semanticVerificationEnabled,
  type AiUsage,
} from "@/lib/server/ai"
import {
  releaseDraftCredit,
  reserveDraftCredit,
  settleDraftCredit,
  type ExistingGeneration,
} from "@/lib/server/ai-credits"
import { finishVerifyUsage, reserveVerifyUsage } from "@/lib/server/ai-usage"
import { writeAudit } from "@/lib/server/audit"
import { hasTimeFor } from "@/lib/server/deadline"
import {
  buildEvidenceHash,
  runSemanticVerification,
  SEMANTIC_UNAVAILABLE,
  verifyStoredDraft,
  type SemanticOutcome,
} from "@/lib/server/drafts"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  intentConflict,
  requestScopedKeyPart,
} from "@/lib/server/mutation-operations"
import { requireScopesEnabled } from "@/lib/server/pause-controls"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

/**
 * Creating a reply draft: THE ONLY implementation, shared by the drafts
 * route (`POST /api/reviews/{id}/drafts`) and the bulk template-reply
 * family (lib/server/bulk-families/reviews.ts), so a batch drafts, checks
 * and charges exactly as a person pressing the button would.
 */

type Tenant = <T>(fn: (sql: TransactionSql) => Promise<T>) => Promise<T>

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

/**
 * How long a generation may stay unfinished before a retry is told its
 * draft will not appear. Longer than the drafts route's `maxDuration`, so
 * past it the request that reserved the credit has ended one way or another
 * (a 409 from a concurrent publish, or the function killed). Rows settled
 * before the draft was stored come from before the charge moved into phase
 * three; a reservation this old is released here, so the customer is not
 * charged and the next click can start again at once.
 */
const GENERATION_SETTLE_GRACE_SECONDS = 120

/**
 * Kept back from the request deadline after the last provider call for
 * phase three: one transaction that re-reads the review, stores the draft,
 * runs the rule checks, charges the credit and writes the audits.
 */
export const PHASE_THREE_RESERVE_MS = 5_000

/**
 * The least time worth giving the semantic pass. With less left before the
 * deadline the pass is skipped and the draft stored `pending` (the same
 * outcome as a provider outage), rather than starting a call the platform
 * would kill before the draft is saved.
 */
export const MIN_VERIFY_MS = 10_000

function generationNotRepeatable(): ApiError {
  return new ApiError(
    409,
    "generation_not_repeatable",
    "That generation did not produce a reply. Generate again."
  )
}

/**
 * A retry of a generation already in the ledger (same generation key). It
 * never reserves or calls the provider again: the finished draft is
 * returned as it was stored, a generation still running answers 409
 * `generation_in_progress` (which the client resends under the same key),
 * and one that ended without a draft answers 409 `generation_not_repeatable`
 * so the next click starts a new generation. "released" means this call
 * released an abandoned reservation: the caller answers
 * `generation_not_repeatable` once that release has committed.
 */
async function replayGeneration(
  sql: TransactionSql,
  reviewId: string,
  generation: ExistingGeneration
): Promise<DraftResult | "released"> {
  if (generation.reviewId !== reviewId) throw intentConflict()
  const inProgress = new ApiError(
    409,
    "generation_in_progress",
    "This reply is still being written. Try again in a moment."
  )
  if (generation.status === "reserved") {
    // This transaction holds the organisation row lock (reserveDraftCredit),
    // so the release cannot interleave with the ledger's own writes.
    const abandoned = await sql<{ id: string }[]>`
      update ai_usage
      set status = 'released', credits = 0, settled_at = now()
      where id = ${generation.id}
        and status = 'reserved'
        and created_at < now() - make_interval(
          secs => ${GENERATION_SETTLE_GRACE_SECONDS}
        )
      returning id::text as id
    `
    if (abandoned.length === 0) throw inProgress
    return "released"
  }
  if (generation.status === "settled" && generation.draftId) {
    const [stored] = await sql<
      {
        draftId: string
        body: string
        evidenceHash: string | null
        verificationId: string | null
        verdict: DraftResult["verification"]["verdict"] | null
        reasons: unknown
      }[]
    >`
      select
        d.id::text as "draftId",
        d.body,
        d.evidence_hash as "evidenceHash",
        v.id::text as "verificationId",
        v.verdict,
        v.reasons
      from draft d
      left join lateral (
        select id, verdict, reasons
        from verification_result
        where draft_id = d.id
        order by created_at desc
        limit 1
      ) v on true
      where d.id = ${generation.draftId} and d.review_id = ${reviewId}
    `
    if (stored?.verificationId && stored.verdict) {
      return {
        draftId: stored.draftId,
        body: stored.body,
        bodyBytes: Buffer.byteLength(stored.body, "utf8"),
        evidenceHash: stored.evidenceHash,
        verification: {
          id: stored.verificationId,
          verdict: stored.verdict,
          reasons: verificationReasonSchema.array().parse(stored.reasons),
        },
      }
    }
    // Settled moments ago: phase three is still writing the draft.
    const [recent] = await sql<{ recent: boolean }[]>`
      select settled_at > now() - make_interval(
        secs => ${GENERATION_SETTLE_GRACE_SECONDS}
      ) as recent
      from ai_usage
      where id = ${generation.id}
    `
    if (recent?.recent) throw inProgress
  }
  throw generationNotRepeatable()
}

/**
 * The draft, and whether it is a retry's replay of a generation already in
 * the ledger (the route answers 200 for a replay, 201 for a new draft).
 */
export type ReviewDraftOutcome = DraftResult & { replayed: boolean }

export type CreateReviewDraftInput = {
  session: Session
  reviewId: string
  input: z.output<typeof draftInputSchema>
  requestId: string
  clientRequestId?: string | null
  tenant: Tenant
  /**
   * The new draft's id. Defaults to a random one; the bulk template family
   * passes one derived from its child, so a re-run claim finds the draft it
   * already made instead of drafting again.
   */
  draftId?: string
  /**
   * Only the rating template, never a model-written reply: a review that
   * has text by the time it is read is refused (409 template_review_has_text).
   */
  templateOnly?: boolean
  /**
   * The request deadline (epoch ms, lib/server/deadline.ts). Each provider
   * call is sized to what is left of it, and the semantic pass is skipped
   * when too little remains. Without one only OPENAI_TIMEOUT_MS bounds them.
   */
  deadline?: number
}

export async function createReviewDraft({
  session,
  reviewId: id,
  input,
  requestId,
  clientRequestId,
  tenant,
  draftId: givenDraftId,
  templateOnly = false,
  deadline,
}: CreateReviewDraftInput): Promise<ReviewDraftOutcome> {
  // DRAFTS_ENABLED is the hard override; the operator pause table
  // (lib/server/pause-controls.ts) pauses drafts without a redeploy.
  await requireScopesEnabled("drafts", {
    code: "drafts_paused",
    message: "Draft generation is temporarily paused.",
  })
  const correlationId = requestId
  // The stable generation id: the request's Idempotency-Key intent when
  // the client sent one (a retry resends it), else this request's id. A
  // retry under the same key finds the first reservation and never pays
  // a second credit.
  const generationKey = requestScopedKeyPart(requestId)

  // Phase one: the gates and the evidence the provider needs. It COMMITS
  // before the OpenAI calls below - a provider that takes 30 seconds must
  // never hold a pooled connection idle in a transaction, or one AI incident
  // drains the pool for sign-in, the inbox and the job runner alike. This is
  // the intent -> provider -> settle shape lib/server/publishing uses.
  // Allocated up front so the credit reservation can name the draft that
  // phase three inserts.
  const draftId = givenDraftId ?? randomUUID()
  // The reservation lives in this transaction too: only an AI-written draft
  // (no typed body, a review with text) costs a credit. The verification
  // pass reserves its token budget here as well (no credit), so the
  // backstop holds across every provider call this request makes.
  const phaseOne = await tenant(async (sql) => {
    const record = await loadReview(sql, id)
    await requireLocationAccess(sql, session, record.location_id)
    assertDraftable(record)
    if (templateOnly && record.review_text?.trim())
      throw new ApiError(
        409,
        "template_review_has_text",
        "This review has text now, so it needs a personal reply."
      )
    const needsModel = !input.body && Boolean(record.review_text?.trim())
    let reservationId: string | null = null
    if (needsModel) {
      const reservation = await reserveDraftCredit(sql, {
        organisationId: session.organisationId,
        model: getServerEnv().OPENAI_MODEL_DRAFT,
        reviewId: id,
        draftId,
        generationKey,
        userId: session.userId,
      })
      if (reservation.kind === "existing") {
        return {
          replay: await replayGeneration(sql, id, reservation.generation),
        }
      }
      reservationId = reservation.id
    }
    const verifyReservation = semanticVerificationEnabled()
      ? await reserveVerifyUsage(sql, {
          organisationId: session.organisationId,
          model: getServerEnv().OPENAI_MODEL_VERIFY,
          reviewId: id,
          draftId,
          requestKey: `${correlationId}:verification`,
          userId: session.userId,
        })
      : null
    return {
      replay: null,
      review: record,
      reservationId,
      verifyReservationId:
        verifyReservation && "id" in verifyReservation
          ? verifyReservation.id
          : null,
      verifyRefused:
        verifyReservation && "refused" in verifyReservation
          ? verifyReservation.refused
          : null,
    }
  })
  if (phaseOne.replay === "released") throw generationNotRepeatable()
  if (phaseOne.replay) return { ...phaseOne.replay, replayed: true }
  const { review, reservationId, verifyReservationId, verifyRefused } = phaseOne

  const language =
    input.languageOverride ??
    (review.language && (review.language_confidence ?? 0) >= 0.7
      ? review.language
      : review.default_language)
  const isRatingOnly = !review.review_text?.trim()

  // Phase two: no connection is held here. A failed provider call releases
  // the reservation (the customer does not pay); a billed but unreadable
  // response keeps its tokens on the released row for the backstop. The
  // call is sized to the request deadline, keeping phase three's time back.
  const generated: {
    reply: string
    language: string
    usage?: AiUsage
    model?: string
  } = input.body
    ? { reply: input.body, language }
    : isRatingOnly
      ? ratingOnlyReply(review.rating, language, review.reviewer_name)
      : await generateReply(
          {
            reviewText: review.review_text,
            rating: review.rating,
            reviewerName: review.reviewer_name,
            locationName: review.location_name,
            language,
            tone: input.tone,
            businessContext: input.businessContext,
          },
          { deadline, reserveMs: PHASE_THREE_RESERVE_MS }
        ).catch(async (error: unknown) => {
          if (reservationId) {
            await releaseDraftCredit(tenant, {
              id: reservationId,
              usage: error instanceof AiOutputError ? error.usage : undefined,
            })
          }
          if (verifyReservationId) {
            await finishVerifyUsage(tenant, { id: verifyReservationId })
          }
          throw error
        })
  // The credit is NOT charged here: it is settled in phase three, in the
  // transaction that stores the draft, so the customer pays exactly when a
  // draft exists. Until then the reservation only holds the credit. A throw
  // from here to phase three's commit releases it (`releaseHeld`), keeping
  // the provider's tokens for the backstop; a function killed in between
  // leaves it `reserved` for the job-tick reaper to release
  // (STALE_RESERVATION_MINUTES), or a retry past
  // GENERATION_SETTLE_GRACE_SECONDS.
  const releaseHeld = async (error: unknown): Promise<never> => {
    if (reservationId) {
      await releaseDraftCredit(tenant, {
        id: reservationId,
        usage: generated.usage,
      })
    }
    throw error
  }
  const source = input.body ? "human" : isRatingOnly ? "template" : "ai"
  // Past the token backstop semantic verification is skipped. A request key
  // already in the ledger (one key reused for two calls) is never read as
  // the backstop: the pass did not run, so the draft is left `pending`
  // (`unavailable`) rather than settled on the rule checks alone. So is a
  // pass there is no longer time for before the deadline: phase three must
  // still run, and a kill after the provider call stores nothing.
  const outOfTime =
    deadline !== undefined &&
    !hasTimeFor(deadline, PHASE_THREE_RESERVE_MS + MIN_VERIFY_MS)
  const semantic: SemanticOutcome =
    verifyRefused === "backstop"
      ? { status: "skipped", reasons: [] }
      : verifyRefused === "duplicate" || (verifyReservationId && outOfTime)
        ? { status: "unavailable", reasons: [SEMANTIC_UNAVAILABLE] }
        : await runSemanticVerification(
            {
              body: generated.reply,
              reviewText: review.review_text,
              reviewerName: review.reviewer_name,
              locationName: review.location_name,
              rating: review.rating,
              expectedLanguage: language,
            },
            { deadline, reserveMs: PHASE_THREE_RESERVE_MS }
          ).catch(async (error: unknown) => {
            if (verifyReservationId) {
              await finishVerifyUsage(tenant, { id: verifyReservationId })
            }
            return releaseHeld(error)
          })

  // Verification usage is written in its own transaction against the
  // period it was reserved in; a ledger failure never fails the request.
  // A pass skipped for time releases its reservation (no usage).
  if (verifyReservationId) {
    await finishVerifyUsage(tenant, {
      id: verifyReservationId,
      usage: semantic.usage,
      model: semantic.model,
    })
  }

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
    if (templateOnly && current.review_text?.trim())
      throw new ApiError(
        409,
        "template_review_has_text",
        "This review has text now, so it needs a personal reply."
      )
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
    // The charge, last and in this transaction: it commits with the draft
    // or not at all.
    if (reservationId && generated.usage && generated.model) {
      await settleDraftCredit(sql, {
        id: reservationId,
        usage: generated.usage,
        model: generated.model,
        draftId,
      })
    }
    return {
      draftId: draft.id,
      body: generated.reply,
      bodyBytes: Buffer.byteLength(generated.reply, "utf8"),
      evidenceHash,
      verification,
    } satisfies DraftResult
  }).catch(releaseHeld)
  return { ...result, replayed: false }
}
