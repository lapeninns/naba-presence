import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"
import { googleOnboardingCreationSchema, type GoogleOnboardingCreation } from "@/lib/contracts/google-onboarding"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { onboardingPayloadMatches } from "@/lib/domain/google-onboarding-confirmation"
import { writeAudit } from "./audit"
import { auditExtendedGrants, extendClientHolders } from "./client-access"
import { getDatabase, jsonColumn, withTenant } from "./db"
import { gbpWritesEnabled, getServerEnv } from "./env"
import { stableGoogleHash } from "./gbp-management"
import { connectionAccessToken, createGoogleLocation, getGoogleLocation, GoogleMutationAmbiguousError } from "./google"
import { searchOnboardingMatches } from "./google-onboarding"
import { checkedOnboardingDraft, requireNoOnboardingMatchLink } from "./google-onboarding-drafts"
import { checkedOnboardingReview } from "./google-onboarding-reviews"
import { requireOnboardingServiceSupport } from "./google-onboarding-services"
import { ApiError } from "./http"
import type { Session } from "./session"

type CreationRow = {
  id: string; draft_id: string; review_id: string; review_hash: string;
  execution_state: GoogleOnboardingCreation["executionState"];
  confirmation_state: GoogleOnboardingCreation["confirmationState"];
  link_state: GoogleOnboardingCreation["linkState"];
  provider_resource_name: string | null; location_id: string | null; error_code: string | null;
  confirmation_response: Record<string, unknown> | null; created_at: Date; updated_at: Date;
  frozen: Awaited<ReturnType<typeof checkedOnboardingReview>>["frozen"];
}

function project(row: CreationRow) {
  return googleOnboardingCreationSchema.parse({ id: row.id, draftId: row.draft_id, reviewId: row.review_id,
    executionState: row.execution_state, confirmationState: row.confirmation_state, linkState: row.link_state,
    providerResourceName: row.provider_resource_name, locationId: row.location_id, errorCode: row.error_code, updatedAt: row.updated_at.toISOString() })
}

async function load(sql: TransactionSql, draftId: string) {
  const [row] = await sql<CreationRow[]>`select c.*, r.frozen from google_onboarding_creation c join google_onboarding_review r on r.id = c.review_id where c.draft_id = ${draftId} for update of c`
  return row
}

async function scoped(session: Session, accountId: string, draftId: string) {
  return withTenant(session.organisationId, async (sql) => {
    await checkedOnboardingDraft(sql, session, accountId, draftId)
    const row = await load(sql, draftId)
    if (!row) throw new ApiError(404, "onboarding_creation_not_found", "Creation has not started for this draft.")
    if (row.execution_state === "pending" && Date.now() - row.created_at.getTime() > 120_000) {
      await sql`update google_onboarding_creation set execution_state = 'unknown', confirmation_state = 'unresolved', error_code = 'onboarding_creation_interrupted', updated_at = now() where id = ${row.id}`
      return (await load(sql, draftId))!
    }
    return row
  })
}

export async function refreshOnboardingCreation(session: Session, accountId: string, draftId: string) {
  const row = await scoped(session, accountId, draftId)
  if (!row.provider_resource_name || row.execution_state === "pending") return project(row)
  let observed: Record<string, unknown> | null = null
  let errorCode: string | null = null
  try {
    const token = await connectionAccessToken(getDatabase(), session.organisationId, row.frozen.connectionId)
    observed = await getGoogleLocation(token, row.provider_resource_name, ["name", "languageCode", "title", "phoneNumbers", "profile", "storefrontAddress", "websiteUri", "categories", "metadata", "serviceArea", "storeCode", "openInfo", "relationshipData", "serviceItems", "labels", "adWordsLocationExtensions", "regularHours", "specialHours", "moreHours"], { connectionKey: row.frozen.connectionId, maxAttempts: 1 })
    if (observed?.name !== row.provider_resource_name || !onboardingPayloadMatches(row.frozen.payload, observed)) errorCode = "onboarding_readback_mismatch"
  } catch (error) { errorCode = error instanceof ApiError ? error.code : "onboarding_readback_failed" }
  return withTenant(session.organisationId, async (sql) => {
    await checkedOnboardingDraft(sql, session, accountId, draftId)
    await load(sql, draftId)
    await sql`update google_onboarding_creation set confirmation_state = ${errorCode ? "unresolved" : "confirmed"}, confirmation_response = ${observed === null ? null : jsonColumn(sql, observed)}, confirmation_observed_at = ${observed === null ? null : new Date()}, error_code = case when ${errorCode}::text is not null then ${errorCode} when link_state = 'failed' then error_code else null end, updated_at = now() where id = ${row.id}`
    return project((await load(sql, draftId))!)
  })
}

export async function submitOnboardingCreation(session: Session, accountId: string, draftId: string, reviewId: string, expectedReviewHash: string, requestId: string) {
  const initial = await withTenant(session.organisationId, async (sql) => {
    await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireNoOnboardingMatchLink(sql, draftId)
    const existing = await load(sql, draftId)
    if (existing) {
      if (existing.review_id !== reviewId || existing.review_hash !== expectedReviewHash) throw new ApiError(409, "onboarding_creation_started", "This draft already has a creation attempt. Recover that operation.")
      return { existing, review: null }
    }
    const review = await checkedOnboardingReview(sql, session, accountId, draftId, reviewId)
    if (!review.approved_by) throw new ApiError(409, "approval_required", "Approve the reviewed creation before submitting it.")
    if (review.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "Restore the exact approved review before submitting.")
    return { existing: null, review }
  })
  if (initial.existing) return project(initial.existing)
  const review = initial.review!
  if (!gbpWritesEnabled(getServerEnv(), "profileWrites")) throw new ApiError(503, "google_writes_paused", "Google listing writes are paused.")
  const matches = await searchOnboardingMatches(session, accountId, { connectionId: review.frozen.connectionId, clientId: review.frozen.clientId ?? undefined, pageSize: 10, search: { kind: "location", location: businessInformationPayloadSchema.strip().parse(review.frozen.payload) } })
  if (stableGoogleHash(matches.matches) !== stableGoogleHash(review.frozen.matchResult.matches)) throw new ApiError(409, "onboarding_matches_changed", "Google's matches changed after approval. Search and review again.")
  const token = await connectionAccessToken(getDatabase(), session.organisationId, review.frozen.connectionId)
  await requireOnboardingServiceSupport(token, review.frozen.payload, review.frozen.connectionId)
  const claimed = await withTenant(session.organisationId, async (sql) => {
    await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireNoOnboardingMatchLink(sql, draftId)
    const current = await checkedOnboardingReview(sql, session, accountId, draftId, reviewId)
    const existing = await load(sql, draftId)
    if (existing) {
      if (existing.review_id !== reviewId || existing.review_hash !== expectedReviewHash) throw new ApiError(409, "onboarding_creation_started", "Another approved review already started creation for this draft. Recover that operation.")
      return { row: existing, execute: false }
    }
    if (!current.approved_by || current.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "The creation approval changed. Review again.")
    if (!gbpWritesEnabled(getServerEnv(), "profileWrites")) throw new ApiError(503, "google_writes_paused", "Google listing writes are paused.")
    await sql`insert into google_onboarding_creation (organisation_id, draft_id, review_id, review_hash, actor_user_id) values (${session.organisationId}, ${draftId}, ${reviewId}, ${expectedReviewHash}, ${session.userId})`
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.creation_started", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { reviewId, providerRequestId: current.frozen.providerRequestId } })
    return { row: (await load(sql, draftId))!, execute: true }
  })
  if (!claimed.execute) return project(claimed.row)
  let response: Record<string, unknown>
  try {
    response = await createGoogleLocation(token, { accountName: review.frozen.accountName, requestId: review.frozen.providerRequestId, validateOnly: false, payload: review.frozen.payload }, { connectionKey: review.frozen.connectionId })
  } catch (error) {
    const rejected = error instanceof ApiError && !(error instanceof GoogleMutationAmbiguousError)
    return withTenant(session.organisationId, async (sql) => {
      await sql`update google_onboarding_creation set execution_state = ${rejected ? "rejected" : "unknown"}, confirmation_state = 'unresolved', error_code = ${error instanceof ApiError ? error.code : "onboarding_creation_unconfirmed"}, updated_at = now() where id = ${claimed.row.id}`
      return project((await load(sql, draftId))!)
    })
  }
  const resource = z.object({ name: z.string().regex(/^locations\/[^/\s]+$/) }).safeParse(response)
  await withTenant(session.organisationId, async (sql) => {
    await sql`update google_onboarding_creation set execution_state = ${resource.success ? "accepted" : "unknown"}, provider_resource_name = ${resource.success ? resource.data.name : null}, provider_response = ${response && typeof response === "object" ? jsonColumn(sql, response) : null}, confirmation_state = ${resource.success ? "pending" : "unresolved"}, error_code = ${resource.success ? null : "onboarding_creation_resource_missing"}, updated_at = now() where id = ${claimed.row.id}`
  })
  if (!resource.success) return project(await scoped(session, accountId, draftId))
  const confirmed = await refreshOnboardingCreation(session, accountId, draftId)
  if (confirmed.confirmationState !== "confirmed") return confirmed
  return linkOnboardingCreation(session, accountId, draftId, review.frozen.payload.title!, requestId)
}

export async function linkOnboardingCreation(session: Session, accountId: string, draftId: string, localName: string, requestId: string) {
  const existing = await scoped(session, accountId, draftId)
  if (existing.link_state === "linked") return project(existing)
  const confirmed = await refreshOnboardingCreation(session, accountId, draftId)
  if (confirmed.confirmationState !== "confirmed") return confirmed
  try {
    return await withTenant(session.organisationId, async (sql) => {
      await checkedOnboardingDraft(sql, session, accountId, draftId)
      const row = (await load(sql, draftId))!
      if (row.link_state === "linked") return project(row)
      if (row.confirmation_state !== "confirmed" || !row.provider_resource_name || !row.confirmation_response) throw new ApiError(409, "onboarding_confirmation_required", "Confirm the provider resource before linking.")
      const observed = row.confirmation_response
      const address = z.record(z.string(), z.unknown()).safeParse(observed.storefrontAddress)
      const verified = z.object({ hasVoiceOfMerchant: z.literal(true) }).safeParse(observed.metadata).success
      await sql`insert into external_location (organisation_id, google_connection_id, google_account_name, google_location_name, title, address_json, verified, raw_payload, raw_content_expires_at)
        values (${session.organisationId}, ${row.frozen.connectionId}, ${row.frozen.accountName}, ${row.provider_resource_name}, ${row.frozen.payload.title!}, ${address.success ? jsonColumn(sql, address.data) : null}, ${verified}, ${jsonColumn(sql, observed)}, now() + interval '30 days') on conflict (organisation_id, google_location_name) do nothing`
      const [external] = await sql<{ id: string; google_connection_id: string; google_account_name: string }[]>`select id, google_connection_id, google_account_name from external_location where google_location_name = ${row.provider_resource_name} for update`
      if (!external || external.google_connection_id !== row.frozen.connectionId || external.google_account_name !== row.frozen.accountName) throw new ApiError(409, "onboarding_external_target_conflict", "This provider resource has a different connection or account assignment. Resolve its existing mapping.")
      const [priorLink] = await sql`select id from location_link where external_location_id = ${external.id}`
      if (priorLink) throw new ApiError(409, "onboarding_existing_link", "This provider resource already has a local mapping. Review that mapping before continuing.")
      const [location] = await sql<{ id: string }[]>`insert into location (organisation_id, name, address_json, timezone, client_id) values (${session.organisationId}, ${localName}, ${address.success ? jsonColumn(sql, address.data) : null}, 'Europe/London', ${row.frozen.clientId}) on conflict (organisation_id, name) do nothing returning id`
      if (!location) throw new ApiError(409, "onboarding_local_name_conflict", "A local listing already uses this name. Choose a distinct local name to finish linking; Google creation will not be repeated.")
      await sql`insert into location_link (organisation_id, location_id, external_location_id, is_active) values (${session.organisationId}, ${location.id}, ${external.id}, true)`
      await sql`insert into webhook_route (google_location_name, organisation_id, external_location_id) values (${row.provider_resource_name}, ${session.organisationId}, ${external.id}) on conflict (google_location_name) do nothing`
      const [route] = await sql`select google_location_name from webhook_route where google_location_name = ${row.provider_resource_name} and organisation_id = ${session.organisationId} and external_location_id = ${external.id}`
      if (!route) throw new ApiError(409, "onboarding_webhook_route_conflict", "This provider resource has an existing routing assignment. Resolve that assignment before linking.")
      if (row.frozen.clientId) await auditExtendedGrants(sql, { organisationId: session.organisationId, actorUserId: session.userId, clientId: row.frozen.clientId, requestId, extended: await extendClientHolders(sql, { organisationId: session.organisationId, clientId: row.frozen.clientId, locationIds: [location.id] }) })
      await sql`insert into sync_checkpoint (organisation_id, external_location_id, sync_type, status, next_attempt_at) values (${session.organisationId}, ${external.id}, 'backfill', 'pending', now()) on conflict (organisation_id, external_location_id, sync_type) do nothing`
      await sql`update google_onboarding_creation set link_state = 'linked', location_id = ${location.id}, error_code = null, updated_at = now() where id = ${row.id}`
      await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.linked", subjectType: "location", subjectId: location.id, requestId, metadata: { creationId: row.id, externalLocationId: external.id } })
      return project((await load(sql, draftId))!)
    })
  } catch (error) {
    return withTenant(session.organisationId, async (sql) => {
      await checkedOnboardingDraft(sql, session, accountId, draftId)
      await sql`update google_onboarding_creation set link_state = 'failed', error_code = ${error instanceof ApiError ? error.code : "onboarding_local_link_failed"}, updated_at = now() where draft_id = ${draftId} and link_state <> 'linked'`
      return project((await load(sql, draftId))!)
    })
  }
}
