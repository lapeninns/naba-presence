import "server-only"

import type { TransactionSql } from "postgres"

import {
  bannedPhraseChecks,
  replyRepetitionChecks,
  contentChecks,
} from "@/lib/domain/content-checks"
import type { VerificationReason } from "@/lib/domain/verification"
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

/** The token a content-warning consent carries (see assertContentChecks). */
export function contentWarningConsent(input: {
  kind: "post" | "description"
  allowEmpty: boolean
  body: string
  bannedPhrases: readonly string[]
  warnings: readonly VerificationReason[]
}): string {
  return sha256(
    JSON.stringify({
      version: "content-v2",
      kind: input.kind,
      allowEmpty: input.allowEmpty,
      body: input.body,
      bannedPhrases: input.bannedPhrases,
      warnings: input.warnings,
    })
  )
}

/**
 * A warning consent names the exact text, policy and warnings the person saw.
 *
 * It binds what the warnings are about, not the dates around them: an
 * offer's end date only ever produces a fail (`offer_expired`), which no
 * consent can pass, so it is left out. That lets one consent cover every
 * occurrence a repeating schedule generates from its template (each moves
 * the event dates by its offsets but keeps the text) and every listing of a
 * bulk post batch, while any change to the text, the organisation's policy
 * or the warning set still makes the consent stale.
 */
export async function assertContentChecks(
  sql: TransactionSql,
  input: {
    locationId?: string
    /**
     * Kept in the consent token only (it no longer changes the checks), so
     * consents already stored on posts stay valid.
     */
    allowEmpty?: boolean
    kind: "post" | "description"
    body: string
    offerEndDate?: string | null
    contentWarningAcknowledgement?: string | null
    /**
     * For a request that has no way to carry a consent: warnings refuse
     * with this message, and without a token to acknowledge, so the person
     * is sent where they can acknowledge them instead.
     */
    warningsAcknowledgedElsewhere?: string
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
  const reasons = contentChecks({
    kind: input.kind,
    body: input.body,
    offerEndDate: input.offerEndDate,
    bannedPhrases,
    today,
  })
  const acknowledgement = contentWarningConsent({
    kind: input.kind,
    allowEmpty: input.allowEmpty ?? false,
    body: input.body,
    bannedPhrases,
    warnings: reasons.filter((reason) => reason.severity === "warn"),
  })
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
    input.contentWarningAcknowledgement !== acknowledgement &&
    input.warningsAcknowledgedElsewhere
  ) {
    throw new ApiError(
      409,
      "content_warning_acknowledgement_required",
      input.warningsAcknowledgedElsewhere,
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

/** Where a description's warnings can be acknowledged, for paths that cannot. */
export const DESCRIPTION_WARNINGS_ELSEWHERE =
  "This description has content warnings to acknowledge. Edit the description in the profile editor (the listing’s Profile tab), acknowledge the warnings there, then publish it from there."

/** Whether a Google business-information update mask writes the description. */
export function maskWritesDescription(updateMask: readonly string[]): boolean {
  return updateMask.some(
    (field) => field === "profile" || field === "profile.description"
  )
}

/**
 * The description content checks for a business-information write (the
 * business-information editor, a Google change put back): the same checks,
 * the same fail (422 `content_checks_failed`) and the organisation's banned
 * phrases as the profile editor's save. These requests carry no consent, so
 * a warning refuses (409 `content_warning_acknowledgement_required`, no
 * token) with a pointer to the profile editor, where it can be given.
 */
export async function assertBusinessDescriptionChecks(
  sql: TransactionSql,
  input: {
    locationId: string
    updateMask: readonly string[]
    payload: { profile?: { description?: string } }
  }
): Promise<void> {
  if (!maskWritesDescription(input.updateMask)) return
  await assertContentChecks(sql, {
    kind: "description",
    locationId: input.locationId,
    body: input.payload.profile?.description ?? "",
    warningsAcknowledgedElsewhere: DESCRIPTION_WARNINGS_ELSEWHERE,
  })
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
  input: {
    draftId?: string | null
    reviewId?: string
    body: string
    reviewText: string | null
  }
) {
  const [context] = await sql<
    { reviewId: string; clientId: string | null; source: string | null }[]
  >`
    select r.id::text as "reviewId", l.client_id::text as "clientId", d.source
    from review r join location l on l.id = r.location_id
    left join draft d on d.id = ${input.draftId ?? null} and d.review_id = r.id
    where r.id = coalesce(${input.reviewId ?? null}::uuid,
      (select review_id from draft where id = ${input.draftId ?? null}))
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
