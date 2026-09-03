import "server-only"

import type { TransactionSql } from "postgres"

import type { VerificationVerdict } from "@/lib/contracts/reviews"
import {
  deterministicVerification,
  verificationVerdict,
  type VerificationReason,
} from "@/lib/domain/verification"
import { semanticVerification, type SemanticInput } from "@/lib/server/ai"
import { sha256 } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"

export type EvidenceInput = {
  reviewId: string
  updateTime: string
  reviewText: string | null
  rating: number | null
  location: string
  // Nullable because drafts written before 0006_reply_lifecycle.sql added the
  // columns carry nulls, and lib/server/publishing/intent.ts recomputes the
  // hash from those same columns: both sides must hash the same null for a
  // legacy draft to stay publishable.
  language: string | null
  tone: string | null
  businessContext: string | null
  draftPolicyVersion: string | null
}

export function buildEvidenceHash(input: EvidenceInput): string {
  return sha256(
    JSON.stringify({
      reviewId: input.reviewId,
      updateTime: input.updateTime,
      reviewText: input.reviewText,
      rating: input.rating,
      location: input.location,
      language: input.language,
      tone: input.tone,
      businessContext: input.businessContext,
      draftPolicyVersion: input.draftPolicyVersion,
    })
  )
}

/**
 * What became of the semantic pass for this draft.
 *
 *   `ran`          the provider answered; `reasons` are its verdict.
 *   `skipped`      deliberately not attempted (kill switch off, or no key).
 *                  The deterministic checks stand alone and the draft is
 *                  publishable — the degraded mode docs/runbook.md prescribes.
 *   `unavailable`  attempted and the provider failed. The operator's text is
 *                  still saved, but the draft settles `pending`, which
 *                  lib/server/publishing/intent.ts refuses to publish.
 */
export type SemanticOutcome = {
  status: "ran" | "skipped" | "unavailable"
  reasons: VerificationReason[]
}

const SEMANTIC_UNAVAILABLE: VerificationReason = {
  code: "semantic_verification_unavailable",
  severity: "warn",
  message:
    "The AI verification pass could not run. Re-verify before publishing.",
}

/**
 * The provider half of verification, run with NO transaction open.
 *
 * Both callers commit their read before this and open a second transaction to
 * write the verdict, because a pooled connection left idle in a transaction
 * for the length of an OpenAI call drains the pool for the whole process —
 * the same intent → provider → settle shape lib/server/publishing uses.
 */
export async function runSemanticVerification(
  input: SemanticInput
): Promise<SemanticOutcome> {
  try {
    const result = await semanticVerification(input)
    return result.ran
      ? { status: "ran", reasons: result.reasons }
      : { status: "skipped", reasons: [] }
  } catch (error) {
    // A provider that is down or rate-limiting must not lose the reply the
    // operator just typed. Anything else — a rejected request, a schema the
    // provider no longer honours — is our bug and still surfaces.
    if (
      error instanceof ApiError &&
      (error.status === 429 || error.status >= 500)
    ) {
      return { status: "unavailable", reasons: [SEMANTIC_UNAVAILABLE] }
    }
    throw error
  }
}

export type StoredDraftVerification = {
  id: string
  verdict: VerificationVerdict
  reasons: VerificationReason[]
}

/**
 * Settle a stored draft: the deterministic checks (recomputed here, against
 * the review as this transaction reads it) plus whatever the semantic pass
 * outside the transaction produced.
 *
 * `evidenceHash` rebinds the draft's evidence contract. Re-verification
 * passes it: without that, a review whose content changed after the draft was
 * written answers `stale_draft_evidence` at publish time and telling the
 * operator to "re-verify the draft" — which is what that error says — could
 * never clear it.
 */
export async function verifyStoredDraft(
  sql: TransactionSql,
  input: {
    draftId: string
    body: string
    reviewText: string | null
    reviewerName?: string | null
    locationName: string
    rating: number | null
    expectedLanguage?: string | null
    semantic: SemanticOutcome
    evidenceHash?: string
  }
): Promise<StoredDraftVerification> {
  const otherLocations = await sql<{ name: string }[]>`
    select name from location where name <> ${input.locationName}
  `
  const reasons = [
    ...deterministicVerification({
      body: input.body,
      reviewText: input.reviewText,
      locationName: input.locationName,
      otherLocationNames: otherLocations.map((location) => location.name),
      rating: input.rating,
      expectedLanguage: input.expectedLanguage,
    }),
    ...input.semantic.reasons,
  ]
  const checked = verificationVerdict(reasons)
  // A deterministic failure is a failure whatever the provider did. Otherwise
  // an unavailable semantic pass means the draft has not been verified —
  // `pending`, not a `pass` that would let unchecked text reach Google.
  const verdict: VerificationVerdict =
    checked === "fail"
      ? "fail"
      : input.semantic.status === "unavailable"
        ? "pending"
        : checked
  // Name only the layers that actually ran: an auditor reading a stored row
  // must be able to tell a draft that faced both from one that saw the
  // regexes alone.
  const checksVersion =
    input.semantic.status === "ran"
      ? "deterministic-v1+semantic-v2"
      : "deterministic-v1"
  const [verification] = await sql<{ id: string }[]>`
    insert into verification_result (
      organisation_id,
      draft_id,
      verdict,
      reasons,
      checks_version
    )
    select
      organisation_id,
      id,
      ${verdict},
      ${sql.json(reasons)},
      ${checksVersion}
    from draft
    where id = ${input.draftId}
    returning id::text as id
  `
  await sql`
    update draft
    set
      verification_status = ${verdict},
      evidence_hash = coalesce(${input.evidenceHash ?? null}::text, evidence_hash)
    where id = ${input.draftId}
  `
  return { id: verification.id, verdict, reasons }
}
