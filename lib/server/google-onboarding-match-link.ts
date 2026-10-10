import "server-only"

import type { TransactionSql } from "postgres"
import { onboardingMatchLinkOperationSchema, type OnboardingMatchLinkOperation } from "@/lib/contracts/google-onboarding-match-link"
import { writeAudit } from "./audit"
import { auditExtendedGrants, extendClientHolders } from "./client-access"
import { jsonColumn, withTenant } from "./db"
import { stableGoogleHash } from "./gbp-management"
import { checkedOnboardingDraft } from "./google-onboarding-drafts"
import { checkedOnboardingMatchLinkReview, observeOnboardingMatchLinkProvider } from "./google-onboarding-match-link-reviews"
import { ApiError } from "./http"
import type { Session } from "./session"

type OperationRow = {
  readonly id: string; readonly draft_id: string; readonly review_id: string; readonly review_hash: string;
  readonly state: OnboardingMatchLinkOperation["state"]; readonly attempt_generation: number;
  readonly location_id: string | null; readonly external_location_id: string | null;
  readonly error_code: string | null; readonly updated_at: Date;
}

function project(row: OperationRow) {
  return onboardingMatchLinkOperationSchema.parse({ id: row.id, draftId: row.draft_id, reviewId: row.review_id,
    state: row.state, attemptGeneration: row.attempt_generation, locationId: row.location_id,
    externalLocationId: row.external_location_id, errorCode: row.error_code, updatedAt: row.updated_at.toISOString() })
}

async function load(sql: TransactionSql, draftId: string, reviewId?: string) {
  const rows = reviewId
    ? await sql<OperationRow[]>`select * from google_onboarding_match_link where draft_id = ${draftId} and review_id = ${reviewId} for update`
    : await sql<OperationRow[]>`select * from google_onboarding_match_link where draft_id = ${draftId} order by (state in ('pending', 'linked')) desc, created_at desc, id desc limit 1 for update`
  return rows[0]
}

async function settleInterrupted(sql: TransactionSql, session: Session, row: OperationRow, requestId: string) {
  if (row.state !== "pending" || Date.now() - row.updated_at.getTime() <= 120_000) return row
  const [settled] = await sql<OperationRow[]>`update google_onboarding_match_link set state = 'failed', error_code = 'onboarding_match_link_interrupted', updated_at = now() where id = ${row.id} returning *`
  if (!settled) throw new ApiError(500, "onboarding_match_link_not_found", "The interrupted operation could not be restored.")
  await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.match_link_interrupted", subjectType: "google_onboarding_draft", subjectId: row.draft_id, requestId, metadata: { operationId: row.id, attemptGeneration: row.attempt_generation } })
  return settled
}

export async function getOnboardingMatchLink(session: Session, accountId: string, draftId: string, requestId: string) {
  return withTenant(session.organisationId, async (sql) => {
    await checkedOnboardingDraft(sql, session, accountId, draftId)
    const row = await load(sql, draftId)
    if (!row) throw new ApiError(404, "onboarding_match_link_not_found", "No existing-match link operation has started for this draft.")
    return project(await settleInterrupted(sql, session, row, requestId))
  })
}

export async function submitOnboardingMatchLink(session: Session, accountId: string, draftId: string, reviewId: string, expectedReviewHash: string, requestId: string) {
  const initial = await withTenant(session.organisationId, async (sql) => {
    await checkedOnboardingDraft(sql, session, accountId, draftId)
    const loaded = await load(sql, draftId, reviewId)
    const existing = loaded ? await settleInterrupted(sql, session, loaded, requestId) : null
    if (existing && existing.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "Restore the exact approved mapping before retrying.")
    if (existing?.state === "linked" || existing?.state === "pending") return { existing, review: null }
    const review = await checkedOnboardingMatchLinkReview(sql, session, accountId, draftId, reviewId)
    if (review.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "Restore the exact approved mapping before linking.")
    if (!review.approved_by) throw new ApiError(409, "approval_required", "Approve this exact mapping before linking.")
    if (review.frozen.conflicts.length) throw new ApiError(409, "onboarding_match_link_conflict", "Resolve mapping conflicts and generate a new review.")
    return { existing: null, review }
  })
  if (initial.existing) return project(initial.existing)
  const review = initial.review
  if (!review) throw new ApiError(500, "onboarding_match_link_review_not_found", "Restore the approved review before linking.")
  let observed: Awaited<ReturnType<typeof observeOnboardingMatchLinkProvider>>
  try {
    observed = await observeOnboardingMatchLinkProvider(session, accountId, draftId, { expectedRevision: review.frozen.revision, expectedMatchCheckedAt: review.frozen.matchCheckedAt, matchName: review.frozen.matchName, localName: review.frozen.localName })
  } catch (error) {
    if (error instanceof ApiError && error.code === "onboarding_match_link_started") {
      const started = await withTenant(session.organisationId, async (sql) => {
        await checkedOnboardingDraft(sql, session, accountId, draftId)
        return load(sql, draftId, reviewId)
      })
      if (started && started.review_hash === expectedReviewHash && (started.state === "pending" || started.state === "linked")) return project(started)
    }
    throw error
  }
  if (stableGoogleHash(observed) !== stableGoogleHash(review.frozen.provider)) throw new ApiError(409, "onboarding_match_provider_changed", "Google's resource details changed after approval. Generate a new link review.")
  const claimed = await withTenant(session.organisationId, async (sql) => {
    await checkedOnboardingDraft(sql, session, accountId, draftId)
    const existing = await load(sql, draftId, reviewId)
    if (existing?.state === "linked" || existing?.state === "pending") return { row: existing, execute: false }
    const current = await checkedOnboardingMatchLinkReview(sql, session, accountId, draftId, reviewId)
    if (!current.approved_by || current.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "The mapping approval changed. Restore the review before linking.")
    const rows = existing
      ? await sql<OperationRow[]>`update google_onboarding_match_link set state = 'pending', attempt_generation = attempt_generation + 1, error_code = null, updated_at = now() where id = ${existing.id} returning *`
      : await sql<OperationRow[]>`insert into google_onboarding_match_link (organisation_id, draft_id, review_id, review_hash, actor_user_id) values (${session.organisationId}, ${draftId}, ${reviewId}, ${expectedReviewHash}, ${session.userId}) returning *`
    const row = rows[0]
    if (!row) throw new ApiError(500, "onboarding_match_link_claim_failed", "The link operation could not be saved. Restore status before retrying.")
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.match_link_started", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { operationId: row.id, reviewId, reviewHash: expectedReviewHash, attemptGeneration: row.attempt_generation } })
    return { row, execute: true }
  })
  if (!claimed.execute) return project(claimed.row)
  try {
    return await withTenant(session.organisationId, async (sql) => {
      await checkedOnboardingDraft(sql, session, accountId, draftId)
      const row = await load(sql, draftId, reviewId)
      if (!row) throw new ApiError(500, "onboarding_match_link_not_found", "Restore the link operation before retrying.")
      if (row.state !== "pending" || row.attempt_generation !== claimed.row.attempt_generation) return project(row)
      const current = await checkedOnboardingMatchLinkReview(sql, session, accountId, draftId, reviewId, reviewId)
      if (!current.approved_by || current.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "The approval changed before linking. Generate a new review.")
      const frozen = current.frozen
      if (!frozen.externalLocationId) {
        const raw = { name: observed.name, title: observed.title, ...(observed.address ? { storefrontAddress: observed.address } : {}),
          metadata: { ...(observed.placeId ? { placeId: observed.placeId } : {}), ...(observed.verified !== null ? { hasVoiceOfMerchant: observed.verified } : {}) } }
        const inserted = await sql`insert into external_location (organisation_id, google_connection_id, google_account_name, google_location_name, title, address_json, verified, raw_payload, raw_content_expires_at)
          values (${session.organisationId}, ${frozen.connectionId}, ${frozen.accountName}, ${observed.name}, ${observed.title}, ${observed.address ? jsonColumn(sql, observed.address) : null}, ${observed.verified === true}, ${jsonColumn(sql, raw)}, now() + interval '30 days') on conflict (organisation_id, google_location_name) do nothing returning id`
        if (!inserted.length) throw new ApiError(409, "onboarding_match_link_review_stale", "The provider mapping changed while linking. Generate a new review.")
      }
      const [external] = await sql<{ id: string; google_connection_id: string; google_account_name: string }[]>`select id, google_connection_id, google_account_name from external_location where google_location_name = ${observed.name} for update`
      if (!external || (frozen.externalLocationId && external.id !== frozen.externalLocationId) || external.google_connection_id !== frozen.connectionId || external.google_account_name !== frozen.accountName) throw new ApiError(409, "onboarding_external_target_conflict", "The existing provider assignment changed. Generate a new review.")
      const [priorLink] = await sql`select id from location_link where external_location_id = ${external.id}`
      if (priorLink) throw new ApiError(409, "onboarding_existing_link", "This resource already has a local mapping. Review that mapping.")
      const [location] = await sql<{ id: string }[]>`insert into location (organisation_id, name, address_json, timezone, client_id) values (${session.organisationId}, ${frozen.localName}, ${observed.address ? jsonColumn(sql, observed.address) : null}, 'Europe/London', ${frozen.clientId}) on conflict (organisation_id, name) do nothing returning id`
      if (!location) throw new ApiError(409, "onboarding_local_name_conflict", "The local name was claimed while linking. Generate a new review.")
      await sql`insert into location_link (organisation_id, location_id, external_location_id, is_active) values (${session.organisationId}, ${location.id}, ${external.id}, true)`
      await sql`insert into webhook_route (google_location_name, organisation_id, external_location_id) values (${observed.name}, ${session.organisationId}, ${external.id}) on conflict (google_location_name) do nothing`
      const [routing] = await sql`select google_location_name from webhook_route where google_location_name = ${observed.name} and organisation_id = ${session.organisationId} and external_location_id = ${external.id}`
      if (!routing) throw new ApiError(409, "onboarding_webhook_route_conflict", "The routing assignment changed. Generate a new review.")
      if (frozen.clientId) await auditExtendedGrants(sql, { organisationId: session.organisationId, actorUserId: session.userId, clientId: frozen.clientId, requestId, extended: await extendClientHolders(sql, { organisationId: session.organisationId, clientId: frozen.clientId, locationIds: [location.id] }) })
      await sql`insert into sync_checkpoint (organisation_id, external_location_id, sync_type, status, next_attempt_at) values (${session.organisationId}, ${external.id}, 'backfill', 'pending', now()) on conflict (organisation_id, external_location_id, sync_type) do nothing`
      const [linked] = await sql<OperationRow[]>`update google_onboarding_match_link set state = 'linked', location_id = ${location.id}, external_location_id = ${external.id}, error_code = null, updated_at = now() where id = ${row.id} returning *`
      if (!linked) throw new ApiError(500, "onboarding_match_link_result_failed", "The mapping result could not be saved. Restore status before retrying.")
      await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.match_linked", subjectType: "location", subjectId: location.id, requestId, metadata: { operationId: row.id, reviewId, externalLocationId: external.id, attemptGeneration: row.attempt_generation } })
      return project(linked)
    })
  } catch (error) {
    return withTenant(session.organisationId, async (sql) => {
      const code = error instanceof ApiError ? error.code : "onboarding_match_link_failed"
      await sql`select id from google_onboarding_draft where id = ${draftId} for update`
      await sql`update google_onboarding_match_link set state = 'failed', error_code = ${code}, updated_at = now() where id = ${claimed.row.id} and state = 'pending' and attempt_generation = ${claimed.row.attempt_generation}`
      const row = await load(sql, draftId, reviewId)
      if (!row) throw error
      if (row.state === "failed" && row.attempt_generation === claimed.row.attempt_generation) await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.match_link_failed", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { operationId: row.id, errorCode: code, attemptGeneration: row.attempt_generation } })
      return project(row)
    })
  }
}
