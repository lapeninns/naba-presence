import "server-only"

import type { TransactionSql } from "postgres"

import {
  bannedPhraseChecks,
  replyRepetitionChecks,
  contentChecks,
} from "@/lib/domain/content-checks"
import { sha256 } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"

export async function loadBannedPhrases(
  sql: TransactionSql
): Promise<string[]> {
  const [row] = await sql<{ bannedPhrases: string[] }[]>`
    select banned_phrases as "bannedPhrases" from organisation
    where id = nullif(current_setting('app.organisation_id', true), '')::uuid
  `
  return row?.bannedPhrases ?? []
}

/** A warning consent names the exact text, policy and findings the person saw. */
export async function assertContentChecks(
  sql: TransactionSql,
  input: {
    locationId?: string
    allowEmpty?: boolean
    kind: "post" | "description"
    body: string
    offerEndDate?: string | null
    contentWarningAcknowledgement?: string | null
  }
): Promise<string | null> {
  const bannedPhrases = await loadBannedPhrases(sql)
  const [zone] = await sql<{ timezone: string }[]>`
    select coalesce(
      (select timezone from location where id = ${input.locationId ?? null}),
      default_timezone
    ) as timezone from organisation
    where id = nullif(current_setting('app.organisation_id', true), '')::uuid
  `
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone?.timezone ?? "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const reasons = contentChecks({ ...input, bannedPhrases, today })
  const acknowledgement = sha256(
    JSON.stringify({
      version: "content-v1",
      kind: input.kind,
      allowEmpty: input.allowEmpty ?? false,
      body: input.body,
      offerEndDate: input.offerEndDate ?? null,
      bannedPhrases,
      reasons,
    })
  )
  if (reasons.some((reason) => reason.severity === "fail")) {
    throw new ApiError(
      422,
      "content_checks_failed",
      "Update the content before saving or publishing.",
      { details: { reasons } }
    )
  }
  if (
    reasons.length &&
    input.contentWarningAcknowledgement !== acknowledgement
  ) {
    throw new ApiError(
      409,
      "content_warning_acknowledgement_required",
      "Read and acknowledge the content warnings before continuing.",
      { details: { reasons, contentWarningAcknowledgement: acknowledgement } }
    )
  }
  return reasons.length ? acknowledgement : null
}

/** Google LocalPost dates are calendar values, not host-local timestamps. */
export function postOfferEndDate(input: {
  topicType: string
  event?: Record<string, unknown> | null
}): string | null {
  if (input.topicType !== "OFFER") return null
  const schedule = input.event?.schedule as Record<string, unknown> | undefined
  const date = schedule?.endDate as Record<string, unknown> | undefined
  if (
    !date ||
    !Number.isInteger(date.year) ||
    !Number.isInteger(date.month) ||
    !Number.isInteger(date.day)
  )
    return null
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`
}

/** Re-read comparison evidence in the caller's tenant transaction. */
export async function storedReplyContentChecks(
  sql: TransactionSql,
  input: { draftId: string; body: string; reviewText: string | null }
) {
  const [context] = await sql<
    { reviewId: string; clientId: string | null; source: string }[]
  >`
    select r.id::text as "reviewId", l.client_id::text as "clientId", d.source
    from draft d join review r on r.id = d.review_id
    join location l on l.id = r.location_id where d.id = ${input.draftId}
  `
  const recent = context?.clientId
    ? await sql<{ body: string }[]>`
    select rr.current_body as body from review_reply rr
    join review r on r.id = rr.review_id join location l on l.id = r.location_id
    where l.client_id = ${context.clientId} and r.id <> ${context.reviewId}
      and rr.publish_status = 'published' and rr.current_body is not null
    order by rr.google_reply_updated_at desc nulls last, rr.id desc limit 30
  `
    : []
  return [
    ...bannedPhraseChecks(input.body, await loadBannedPhrases(sql)),
    ...replyRepetitionChecks({
      body: input.body,
      recentPublishedReplies: recent.map((row) => row.body),
      ratingOnlyTemplate:
        context?.source === "template" && !input.reviewText?.trim(),
    }),
  ]
}
