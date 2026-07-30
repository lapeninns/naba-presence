import "server-only"

import type { TransactionSql } from "postgres"

import {
  deterministicVerification,
  verificationVerdict,
} from "@/lib/domain/verification"
import { semanticVerification } from "@/lib/server/ai"
import { sha256 } from "@/lib/server/crypto"

export type EvidenceInput = {
  reviewId: string
  updateTime: string
  reviewText: string | null
  rating: number | null
  location: string
  language: string
  tone: string
  businessContext: string | null
  draftPolicyVersion: string
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

export async function verifyStoredDraft(
  sql: TransactionSql,
  draft: {
    id: string
    body: string
    review_text: string | null
    reviewer_name?: string | null
    location_name: string
    rating: number | null
    detected_language_code?: string | null
  }
) {
  const otherLocations = await sql<{ name: string }[]>`
    select name from location where name <> ${draft.location_name}
  `
  const reasons = [
    ...deterministicVerification({
      body: draft.body,
      reviewText: draft.review_text,
      locationName: draft.location_name,
      otherLocationNames: otherLocations.map((location) => location.name),
      rating: draft.rating,
      expectedLanguage: draft.detected_language_code,
    }),
    ...(await semanticVerification({
      body: draft.body,
      reviewText: draft.review_text,
      reviewerName: draft.reviewer_name,
      locationName: draft.location_name,
      rating: draft.rating,
      expectedLanguage: draft.detected_language_code ?? "en",
    })),
  ]
  const verdict = verificationVerdict(reasons)
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
      'deterministic-v1+semantic-v2'
    from draft
    where id = ${draft.id}
    returning id::text as id
  `
  await sql`
    update draft
    set verification_status = ${verdict}
    where id = ${draft.id}
  `
  return { id: verification.id, verdict, reasons }
}
