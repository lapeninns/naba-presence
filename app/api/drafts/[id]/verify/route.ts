import type { TransactionSql } from "postgres"

import {
  reviewIdParamsSchema,
  type VerifyResult,
} from "@/lib/contracts/reviews"
import { writeAudit } from "@/lib/server/audit"
import {
  buildEvidenceHash,
  runSemanticVerification,
  verifyStoredDraft,
} from "@/lib/server/drafts"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

type DraftRecord = {
  id: string
  body: string
  review_id: string
  review_text: string | null
  reviewer_name: string | null
  location_name: string
  location_id: string
  rating: number | null
  update_time: Date
  detected_language_code: string | null
  language: string | null
  tone: string | null
  business_context: string | null
  draft_policy_version: string | null
}

async function loadDraft(
  sql: TransactionSql,
  draftId: string
): Promise<DraftRecord> {
  const [draft] = await sql<DraftRecord[]>`
    select
      d.id::text as id,
      d.body,
      d.review_id::text as review_id,
      d.language,
      d.tone,
      d.business_context,
      d.draft_policy_version,
      r.review_text,
      r.reviewer_display_name as reviewer_name,
      r.detected_language_code,
      r.update_time,
      r.location_id::text as location_id,
      l.name as location_name,
      r.star_rating as rating
    from draft d
    join review r on r.id = d.review_id
    join location l on l.id = r.location_id
    where d.id = ${draftId}
    limit 1
  `
  if (!draft) {
    throw new ApiError(404, "draft_not_found", "Draft not found.")
  }
  return draft
}

/**
 * The language the draft was WRITTEN in, not the review's detected one. The
 * generating route resolved `languageOverride ?? (confident detection : the
 * organisation default)` and verified against that, so re-verifying against
 * `review.detected_language_code` can invent — or hide — a language_mismatch
 * on a draft nobody touched. `buildEvidenceHash` already commits to
 * `draft.language`; this keeps both entry points on the same input.
 */
function expectedLanguage(draft: DraftRecord): string | null {
  return draft.language ?? draft.detected_language_code
}

export const POST = route({
  roles: ["owner", "admin", "member"],
  params: reviewIdParamsSchema,
  handler: async ({ session, params, requestId, clientRequestId, tenant }) => {
    const { id } = params

    // Load, commit, call the provider with no connection held, then settle —
    // see the note in app/api/reviews/[id]/drafts/route.ts.
    const draft = await tenant(async (sql) => {
      const record = await loadDraft(sql, id)
      await requireLocationAccess(sql, session, record.location_id)
      return record
    })

    const semantic = await runSemanticVerification({
      body: draft.body,
      reviewText: draft.review_text,
      reviewerName: draft.reviewer_name,
      locationName: draft.location_name,
      rating: draft.rating,
      expectedLanguage: expectedLanguage(draft) ?? "en",
    })

    const result = await tenant(async (sql) => {
      const current = await loadDraft(sql, id)
      await requireLocationAccess(sql, session, current.location_id)
      const verification = await verifyStoredDraft(sql, {
        draftId: current.id,
        body: current.body,
        reviewText: current.review_text,
        reviewerName: current.reviewer_name,
        locationName: current.location_name,
        rating: current.rating,
        expectedLanguage: expectedLanguage(current),
        semantic,
        // Re-bind the evidence contract to the review as it stands now. This
        // is the whole point of the button: a review that changed after the
        // draft was written answers `stale_draft_evidence` at publish time
        // and tells the operator to re-verify, which until now recorded a
        // fresh verdict against a hash it never touched.
        evidenceHash: buildEvidenceHash({
          reviewId: current.review_id,
          updateTime: current.update_time.toISOString(),
          reviewText: current.review_text,
          rating: current.rating,
          location: current.location_name,
          language: current.language,
          tone: current.tone,
          businessContext: current.business_context,
          draftPolicyVersion: current.draft_policy_version,
        }),
      })
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "review.draft.verified",
        subjectType: "review",
        subjectId: current.review_id,
        requestId,
        metadata: {
          draftId: id,
          verdict: verification.verdict,
          semanticPass: semantic.status,
          clientRequestId,
        },
      })
      return verification
    })
    return { verification: result } satisfies VerifyResult
  },
})
