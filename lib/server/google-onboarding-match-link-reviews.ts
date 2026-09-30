import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"
import { onboardingMatchLinkFrozenSchema, onboardingMatchLinkProviderSchema, onboardingMatchLinkReviewSchema, type OnboardingMatchLinkFrozen, type OnboardingMatchLinkInput } from "@/lib/contracts/google-onboarding-match-link"
import { writeAudit } from "./audit"
import { getDatabase, jsonColumn, withTenant } from "./db"
import { stableGoogleHash } from "./gbp-management"
import { connectionAccessToken, getGoogleLocation } from "./google"
import { resolveOnboardingAccountInTransaction } from "./google-onboarding"
import { discoverOnboardingAccessibleMatches } from "./google-onboarding-accessible-matches"
import { checkedOnboardingDraft, requireEditableOnboardingDraft } from "./google-onboarding-drafts"
import { ApiError } from "./http"
import type { Session } from "./session"

type Draft = Awaited<ReturnType<typeof checkedOnboardingDraft>>
type ReviewRow = {
  readonly id: string; readonly draft_id: string; readonly match_request_id: string;
  readonly frozen: OnboardingMatchLinkFrozen; readonly review_hash: string;
  readonly requested_by: string; readonly approved_by: string | null;
  readonly require_two_person_approval: boolean; readonly observed_at: Date; readonly approval_expires_at: Date;
}

async function approvalPolicy(sql: TransactionSql) {
  const [organisation] = await sql<{ require_two_person_approval: boolean }[]>`select require_two_person_approval from organisation limit 1`
  if (!organisation) throw new ApiError(404, "organisation_not_found", "Organisation not found.")
  return organisation.require_two_person_approval
}

async function requireActor(sql: TransactionSql, session: Session, draft: Draft, userId: string) {
  const [member] = await sql<{ role: string }[]>`select role from member where user_id = ${userId}`
  if (!member || (member.role !== "owner" && member.role !== "admin")) throw new ApiError(409, "approval_actor_access_changed", "An initiating or approving user's access changed. Generate a new review.")
  await resolveOnboardingAccountInTransaction(sql, { ...session, userId, role: member.role }, { accountId: draft.google_account_id, connectionId: draft.connection_id, clientId: draft.client_id ?? undefined })
}

async function mappingState(sql: TransactionSql, organisationId: string, draft: Draft, providerName: string, localName: string) {
  const [external] = await sql<{ id: string; google_connection_id: string; google_account_name: string }[]>`select id, google_connection_id, google_account_name from external_location where google_location_name = ${providerName}`
  const [link] = external ? await sql`select id from location_link where external_location_id = ${external.id} limit 1` : []
  const [local] = await sql`select id from location where name = ${localName} limit 1`
  const [routing] = await sql<{ organisation_id: string; external_location_id: string }[]>`select organisation_id, external_location_id from webhook_route where google_location_name = ${providerName}`
  const conflicts: OnboardingMatchLinkFrozen["conflicts"] = []
  if (external && (external.google_connection_id !== draft.connection_id || external.google_account_name !== draft.account_name)) conflicts.push("external_assignment")
  if (link) conflicts.push("existing_link")
  if (local) conflicts.push("local_name")
  if (routing && (routing.organisation_id !== organisationId || routing.external_location_id !== external?.id)) conflicts.push("webhook_assignment")
  return { externalLocationId: external?.id ?? null, conflicts }
}

function requireDraftBinding(draft: Draft, frozen: Pick<OnboardingMatchLinkFrozen, "revision" | "payloadHash" | "accountName" | "connectionId" | "clientId" | "matchCheckedAt" | "matchName">, matchRequestId: string) {
  if (draft.revision !== frozen.revision || draft.payload_hash !== frozen.payloadHash || draft.account_name !== frozen.accountName || draft.connection_id !== frozen.connectionId || draft.client_id !== frozen.clientId
    || draft.match_request_id !== matchRequestId || draft.match_result?.checkedAt !== frozen.matchCheckedAt
    || Date.now() - Date.parse(frozen.matchCheckedAt) >= 24 * 60 * 60 * 1000
    || !draft.match_result.matches.some((match) => match.name === frozen.matchName)) {
    throw new ApiError(409, "onboarding_match_link_review_stale", "The draft, account or matching evidence changed. Generate a new link review.")
  }
}

function reviewHash(frozen: OnboardingMatchLinkFrozen, requiresSecondApprover: boolean) {
  return stableGoogleHash({ frozen, requiresSecondApprover })
}

function project(row: ReviewRow, session: Session) {
  return onboardingMatchLinkReviewSchema.parse({ ...row.frozen, id: row.id, reviewHash: row.review_hash, requestedBy: row.requested_by, approvedBy: row.approved_by,
    requiresSecondApprover: row.require_two_person_approval, canApprove: row.frozen.conflicts.length === 0 && (!row.require_two_person_approval || row.requested_by !== session.userId),
    observedAt: row.observed_at.toISOString(), approvalExpiresAt: row.approval_expires_at.toISOString() })
}

export async function observeOnboardingMatchLinkProvider(session: Session, accountId: string, draftId: string, input: OnboardingMatchLinkInput) {
  const discovery = await discoverOnboardingAccessibleMatches(session, accountId, draftId, input)
  const candidate = discovery.matches.find((match) => match.matchName === input.matchName)
  if (!candidate || candidate.status !== "accessible") throw new ApiError(409, "onboarding_match_not_accessible", "This match has no unambiguous identity in the selected account. Refresh discovery or review ownership options.")
  const draft = await withTenant(session.organisationId, (sql) => checkedOnboardingDraft(sql, session, accountId, draftId))
  const token = await connectionAccessToken(getDatabase(), session.organisationId, draft.connection_id)
  const response = await getGoogleLocation(token, candidate.location.name, ["name", "title", "storefrontAddress", "metadata"], { connectionKey: draft.connection_id })
  const parsed = z.object({ name: z.literal(candidate.location.name), title: z.string().min(1), storefrontAddress: z.record(z.string(), z.unknown()).optional(), metadata: z.object({ placeId: z.string().optional(), hasVoiceOfMerchant: z.boolean().optional() }).optional() }).safeParse(response)
  if (!parsed.success || (candidate.location.placeId && parsed.data.metadata?.placeId !== candidate.location.placeId)) throw new ApiError(502, "onboarding_match_identity_unconfirmed", "Google did not confirm this resource identity. Refresh matching before linking.")
  return onboardingMatchLinkProviderSchema.parse({ name: parsed.data.name, title: parsed.data.title, ...(parsed.data.metadata?.placeId ? { placeId: parsed.data.metadata.placeId } : {}), address: parsed.data.storefrontAddress ?? null, verified: parsed.data.metadata?.hasVoiceOfMerchant ?? null })
}

export async function previewOnboardingMatchLink(session: Session, accountId: string, draftId: string, input: OnboardingMatchLinkInput, requestId: string) {
  const initial = await withTenant(session.organisationId, async (sql) => {
    const draft = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    await requireActor(sql, session, draft, draft.requested_by)
    return { draft, policy: await approvalPolicy(sql) }
  })
  const provider = await observeOnboardingMatchLinkProvider(session, accountId, draftId, input)
  return withTenant(session.organisationId, async (sql) => {
    const draft = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    await requireActor(sql, session, draft, initial.draft.requested_by)
    const frozen = onboardingMatchLinkFrozenSchema.parse({ draftId, revision: input.expectedRevision, payloadHash: initial.draft.payload_hash,
      accountId, accountName: initial.draft.account_name, connectionId: initial.draft.connection_id, clientId: initial.draft.client_id,
      matchCheckedAt: input.expectedMatchCheckedAt, matchName: input.matchName, provider, localName: input.localName,
      ...await mappingState(sql, session.organisationId, draft, provider.name, input.localName) })
    if (!initial.draft.match_request_id) throw new ApiError(409, "onboarding_matches_stale", "Search for matches again.")
    requireDraftBinding(draft, frozen, initial.draft.match_request_id)
    if (await approvalPolicy(sql) !== initial.policy) throw new ApiError(409, "approval_policy_changed", "The approval policy changed during discovery. Generate a new review.")
    const [row] = await sql<ReviewRow[]>`insert into google_onboarding_match_link_review (organisation_id, draft_id, match_request_id, frozen, review_hash, requested_by, require_two_person_approval)
      values (${session.organisationId}, ${draftId}, ${initial.draft.match_request_id}, ${jsonColumn(sql, frozen)}, ${reviewHash(frozen, initial.policy)}, ${session.userId}, ${initial.policy}) returning *`
    if (!row) throw new ApiError(500, "onboarding_match_link_review_failed", "The link review could not be saved. Retry review.")
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.match_link_reviewed", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { reviewId: row.id, reviewHash: row.review_hash, conflictCount: frozen.conflicts.length } })
    return project(row, session)
  })
}

export async function checkedOnboardingMatchLinkReview(sql: TransactionSql, session: Session, accountId: string, draftId: string, reviewId: string, allowedMatchLinkReviewId?: string) {
  const draft = await checkedOnboardingDraft(sql, session, accountId, draftId)
  await requireEditableOnboardingDraft(sql, draftId, allowedMatchLinkReviewId)
  const [row] = await sql<ReviewRow[]>`select * from google_onboarding_match_link_review where id = ${reviewId} and draft_id = ${draftId} for update`
  if (!row) throw new ApiError(404, "onboarding_match_link_review_not_found", "This link review was not found.")
  if (row.approval_expires_at.getTime() <= Date.now()) throw new ApiError(409, "approval_expired", "This review expired. Generate a new link review.")
  if (await approvalPolicy(sql) !== row.require_two_person_approval) throw new ApiError(409, "approval_policy_changed", "The approval policy changed. Generate a new review.")
  await requireActor(sql, session, draft, draft.requested_by)
  await requireActor(sql, session, draft, row.requested_by)
  if (row.approved_by) await requireActor(sql, session, draft, row.approved_by)
  requireDraftBinding(draft, row.frozen, row.match_request_id)
  const current = { ...row.frozen, ...await mappingState(sql, session.organisationId, draft, row.frozen.provider.name, row.frozen.localName) }
  if (reviewHash(row.frozen, row.require_two_person_approval) !== row.review_hash || reviewHash(current, row.require_two_person_approval) !== row.review_hash) throw new ApiError(409, "onboarding_match_link_review_stale", "The mapping or reviewed content changed. Generate a new link review.")
  return row
}

export async function getOnboardingMatchLinkReview(session: Session, accountId: string, draftId: string, reviewId: string) {
  return withTenant(session.organisationId, async (sql) => project(await checkedOnboardingMatchLinkReview(sql, session, accountId, draftId, reviewId), session))
}

export async function approveOnboardingMatchLink(session: Session, accountId: string, draftId: string, reviewId: string, expectedReviewHash: string, requestId: string) {
  const initial = await withTenant(session.organisationId, (sql) => checkedOnboardingMatchLinkReview(sql, session, accountId, draftId, reviewId))
  if (initial.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "Restore the exact reviewed mapping before approving.")
  if (initial.frozen.conflicts.length) throw new ApiError(409, "onboarding_match_link_conflict", "Resolve the existing mapping conflict and generate a new review.")
  if (initial.require_two_person_approval && initial.requested_by === session.userId) throw new ApiError(409, "second_approver_required", "A different authorised user must approve this link.")
  const observed = await observeOnboardingMatchLinkProvider(session, accountId, draftId, { expectedRevision: initial.frozen.revision, expectedMatchCheckedAt: initial.frozen.matchCheckedAt, matchName: initial.frozen.matchName, localName: initial.frozen.localName })
  if (stableGoogleHash(observed) !== stableGoogleHash(initial.frozen.provider)) throw new ApiError(409, "onboarding_match_provider_changed", "Google's resource details changed after review. Generate a new link review.")
  return withTenant(session.organisationId, async (sql) => {
    const current = await checkedOnboardingMatchLinkReview(sql, session, accountId, draftId, reviewId)
    if (current.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "The review changed. Restore it before approving.")
    if (current.approved_by) return project(current, session)
    const [approved] = await sql<ReviewRow[]>`update google_onboarding_match_link_review set approved_by = ${session.userId}, approved_at = now() where id = ${reviewId} returning *`
    if (!approved) throw new ApiError(500, "onboarding_match_link_approval_failed", "The approval could not be saved. Restore the review before retrying.")
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.match_link_approved", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { reviewId, reviewHash: expectedReviewHash } })
    return project(approved, session)
  })
}
