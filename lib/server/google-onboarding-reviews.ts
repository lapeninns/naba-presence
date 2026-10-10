import "server-only"

import { randomUUID } from "node:crypto"
import type { TransactionSql } from "postgres"
import { z } from "zod"
import { googleOnboardingReviewSchema, type GoogleOnboardingReview, type googleOnboardingReviewInputSchema } from "@/lib/contracts/google-onboarding"
import { writeAudit } from "./audit"
import { getDatabase, jsonColumn, withTenant } from "./db"
import { gbpWritesEnabled, getServerEnv } from "./env"
import { stableGoogleHash } from "./gbp-management"
import { connectionAccessToken, createGoogleLocation, googleAccountManagementApi } from "./google"
import { checkedOnboardingDraft, requireEditableOnboardingDraft } from "./google-onboarding-drafts"
import { requireOnboardingServiceSupport } from "./google-onboarding-services"
import { ApiError } from "./http"
import type { Session } from "./session"

type Draft = Awaited<ReturnType<typeof checkedOnboardingDraft>>
type ReviewInput = z.infer<typeof googleOnboardingReviewInputSchema>
type Frozen = Pick<GoogleOnboardingReview, "draftId" | "revision" | "accountId" | "accountName" | "connectionId" | "clientId" | "providerRequestId" | "payload" | "matchResult" | "decision">
type ReviewRow = {
  id: string; draft_id: string; revision: number; match_request_id: string;
  frozen: Frozen; review_hash: string; requested_by: string; approved_by: string | null;
  require_two_person_approval: boolean; validated_at: Date; approval_expires_at: Date;
}

function requireWritesEnabled() {
  if (!gbpWritesEnabled(getServerEnv(), "profileWrites")) throw new ApiError(503, "google_writes_paused", "Google listing writes are paused.")
}

async function requireManager(sql: TransactionSql, userId: string) {
  const [member] = await sql<{ role: string }[]>`select role from member where user_id = ${userId}`
  if (!member || (member.role !== "owner" && member.role !== "admin")) throw new ApiError(409, "approval_actor_access_changed", "An initiating or approving user's access changed. Generate a new review.")
}

async function policy(sql: TransactionSql) {
  const [organisation] = await sql<{ require_two_person_approval: boolean }[]>`select require_two_person_approval from organisation limit 1`
  if (!organisation) throw new ApiError(404, "organisation_not_found", "Organisation not found.")
  return organisation.require_two_person_approval
}

function freeze(draft: Draft, input: ReviewInput): Frozen {
  if (draft.revision !== input.expectedRevision) throw new ApiError(409, "onboarding_draft_stale", "Restore the latest draft before reviewing creation.")
  const matches = draft.match_result
  if (!matches || !draft.match_request_id || matches.checkedAt !== input.expectedMatchCheckedAt) throw new ApiError(409, "onboarding_matches_required", "Search the current draft and review its matches before continuing.")
  if (Date.now() - Date.parse(matches.checkedAt) >= 24 * 60 * 60 * 1000) throw new ApiError(409, "onboarding_matches_expired", "Search again before reviewing creation.")
  const expected = [...new Set(matches.matches.map((match) => match.name))].sort()
  if (JSON.stringify(expected) !== JSON.stringify([...input.decision.acknowledgedMatchNames].sort())) throw new ApiError(409, "onboarding_matches_unacknowledged", "Review every returned match before choosing to create a separate listing.")
  if (!draft.payload.title || !draft.payload.languageCode) throw new ApiError(422, "onboarding_details_required", "Provide the business name and language before validating creation.")
  if (draft.payload.serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY" && draft.payload.storefrontAddress && Object.keys(draft.payload.storefrontAddress).length) throw new ApiError(422, "onboarding_storefront_not_applicable", "Remove the storefront address for a business that only visits customers.")
  return {
    draftId: draft.id, revision: draft.revision, accountId: draft.google_account_id,
    accountName: draft.account_name, connectionId: draft.connection_id, clientId: draft.client_id,
    providerRequestId: draft.provider_request_id, payload: draft.payload, matchResult: matches,
    decision: { ...input.decision, acknowledgedMatchNames: expected },
  }
}

function reviewHash(frozen: Frozen, requiresSecondApprover: boolean) {
  return stableGoogleHash({ frozen, requiresSecondApprover })
}

function project(row: ReviewRow, session: Session) {
  return googleOnboardingReviewSchema.parse({
    ...row.frozen, id: row.id, reviewHash: row.review_hash,
    requestedBy: row.requested_by, approvedBy: row.approved_by,
    requiresSecondApprover: row.require_two_person_approval,
    canApprove: !row.require_two_person_approval || row.requested_by !== session.userId,
    validatedAt: row.validated_at.toISOString(), approvalExpiresAt: row.approval_expires_at.toISOString(),
  })
}

export async function previewOnboardingCreation(session: Session, accountId: string, draftId: string, input: ReviewInput, requestId: string) {
  requireWritesEnabled()
  const initial = await withTenant(session.organisationId, async (sql) => {
    const draft = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    await requireManager(sql, draft.requested_by)
    return { frozen: freeze(draft, input), policy: await policy(sql), matchRequestId: draft.match_request_id }
  })
  const token = await connectionAccessToken(getDatabase(), session.organisationId, initial.frozen.connectionId)
  const access = await googleAccountManagementApi(token, { path: initial.frozen.accountName }, { connectionKey: initial.frozen.connectionId })
  if (!z.object({ name: z.literal(initial.frozen.accountName) }).safeParse(access).success) throw new ApiError(502, "onboarding_account_unconfirmed", "Google did not confirm access to the selected account.")
  const validationRequestId = randomUUID()
  await requireOnboardingServiceSupport(token, initial.frozen.payload, initial.frozen.connectionId)
  const response = await createGoogleLocation(token, { accountName: initial.frozen.accountName, requestId: validationRequestId, validateOnly: true, payload: initial.frozen.payload }, { connectionKey: initial.frozen.connectionId })
  if (!z.record(z.string(), z.unknown()).safeParse(response).success || Object.hasOwn(response, "error")) throw new ApiError(502, "onboarding_validation_unconfirmed", "Google returned an incomplete validation response. Validate again before approval.")
  requireWritesEnabled()
  return withTenant(session.organisationId, async (sql) => {
    const current = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    await requireManager(sql, current.requested_by)
    const currentPolicy = await policy(sql)
    if (currentPolicy !== initial.policy) throw new ApiError(409, "approval_policy_changed", "The approval policy changed during validation. Generate a new review.")
    const frozen = freeze(current, input)
    const hash = reviewHash(frozen, currentPolicy)
    if (current.match_request_id !== initial.matchRequestId || hash !== reviewHash(initial.frozen, initial.policy)) throw new ApiError(409, "onboarding_review_stale", "The draft or matching evidence changed during validation. Review again.")
    const [row] = await sql<ReviewRow[]>`
      insert into google_onboarding_review (organisation_id, draft_id, revision, match_request_id, frozen, review_hash, requested_by, require_two_person_approval, validation_request_id, validation_response)
      values (${session.organisationId}, ${draftId}, ${current.revision}, ${current.match_request_id}, ${jsonColumn(sql, frozen)}, ${hash}, ${session.userId}, ${currentPolicy}, ${validationRequestId}, ${jsonColumn(sql, response)}) returning *
    `
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.reviewed", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { reviewId: row.id, reviewHash: hash } })
    return project(row, session)
  })
}

export async function checkedOnboardingReview(sql: TransactionSql, session: Session, accountId: string, draftId: string, reviewId: string) {
  const draft = await checkedOnboardingDraft(sql, session, accountId, draftId)
  const [row] = await sql<ReviewRow[]>`select * from google_onboarding_review where id = ${reviewId} and draft_id = ${draftId} for update`
  if (!row) throw new ApiError(404, "onboarding_review_not_found", "This creation review was not found.")
  if (row.approval_expires_at.getTime() <= Date.now()) throw new ApiError(409, "approval_expired", "This review expired. Generate a new review.")
  if (await policy(sql) !== row.require_two_person_approval) throw new ApiError(409, "approval_policy_changed", "The approval policy changed. Generate a new review.")
  await requireManager(sql, draft.requested_by)
  await requireManager(sql, row.requested_by)
  if (row.approved_by) await requireManager(sql, row.approved_by)
  const frozen = freeze(draft, { expectedRevision: row.revision, expectedMatchCheckedAt: row.frozen.matchResult.checkedAt, decision: row.frozen.decision })
  if (draft.match_request_id !== row.match_request_id || reviewHash(row.frozen, row.require_two_person_approval) !== row.review_hash || reviewHash(frozen, row.require_two_person_approval) !== row.review_hash) throw new ApiError(409, "onboarding_review_stale", "The reviewed content, target or matches changed. Generate a new review.")
  return row
}

export async function getOnboardingReview(session: Session, accountId: string, draftId: string, reviewId: string) {
  return withTenant(session.organisationId, async (sql) => project(await checkedOnboardingReview(sql, session, accountId, draftId, reviewId), session))
}

export async function approveOnboardingCreation(session: Session, accountId: string, draftId: string, reviewId: string, expectedReviewHash: string, requestId: string) {
  requireWritesEnabled()
  return withTenant(session.organisationId, async (sql) => {
    const row = await checkedOnboardingReview(sql, session, accountId, draftId, reviewId)
    if (row.review_hash !== expectedReviewHash) throw new ApiError(409, "approval_stale", "The reviewed details changed. Restore the review before approving.")
    if (row.require_two_person_approval && row.requested_by === session.userId) throw new ApiError(409, "second_approver_required", "A different authorised user must approve this creation.")
    if (row.approved_by) return project(row, session)
    const [approved] = await sql<ReviewRow[]>`update google_onboarding_review set approved_by = ${session.userId}, approved_at = now() where id = ${row.id} returning *`
    await writeAudit(sql, { organisationId: session.organisationId, actorUserId: session.userId, action: "google.onboarding.approved", subjectType: "google_onboarding_draft", subjectId: draftId, requestId, metadata: { reviewId, reviewHash: row.review_hash } })
    return project(approved, session)
  })
}
