import "server-only"

import type { TransactionSql } from "postgres"

import {
  deterministicVerification,
  verificationVerdict,
} from "@/lib/domain/verification"
import { semanticVerification } from "@/lib/server/ai"

export async function verifyStoredDraft(
  sql: TransactionSql,
  draft: {
    id: string
    body: string
    review_text: string | null
    location_name: string
    rating: number
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
      locationName: draft.location_name,
      rating: draft.rating,
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
      'deterministic-v1+semantic-v1'
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
