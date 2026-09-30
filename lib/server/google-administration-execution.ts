import "server-only"
import type { AdministrationAccessRequest } from "@/lib/contracts/google-administration-review"
import { approvedGbpChange } from "@/lib/server/gbp-change-sets"
import { jsonColumn, withSessionConnection, withTenant } from "@/lib/server/db"
import { auditGbpMutation, settleGbpMutation, startGbpMutation } from "@/lib/server/gbp-management"
import { googleAccountManagementApi, GoogleMutationAmbiguousError } from "@/lib/server/google"
import { assertAdministrationAccessCurrent, readAdministrationAccessReview } from "@/lib/server/google-administration-reviews"
import { currentAdministrationContext, scopedAdministrationTarget } from "@/lib/server/google-administration-state"
import { loadAdministrationAccessAttempt, projectAdministrationAttempt, readAdministrationAccessAttempt, refreshAdministrationObservation } from "@/lib/server/google-administration-attempts"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"
import { requireNoUnresolvedPlaceAction } from "@/lib/server/google-account-change-lock"

async function withAdministrationLock<T>(session: Session, locationId: string, work: () => Promise<T>) {
  const linked = await currentAdministrationContext(session, locationId, false)
  return withSessionConnection((connection) => connection.begin(async (sql) => {
    const [claim] = await sql<{ acquired: boolean }[]>`select pg_try_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${linked.googleAccountId}:administration_access`}, 0)) as acquired`
    if (!claim?.acquired) throw new ApiError(409, "administration_in_progress", "Another administration action for this Google account is in progress. Check its saved outcome.")
    return work()
  }))
}

async function sendAdministrationAccess(linked: Awaited<ReturnType<typeof currentAdministrationContext>>, request: AdministrationAccessRequest, token: string) {
  const target = scopedAdministrationTarget(request, linked)
  const options = { connectionKey: linked.connectionId, mutation: true }
  switch (request.operation) {
    case "create_admin": return googleAccountManagementApi(token, { path: target.collection, method: "POST", payload: { role: request.payload.role, ...(request.payload.admin ? { admin: request.payload.admin } : { account: request.payload.account }) } }, options)
    case "update_admin": return googleAccountManagementApi(token, { path: target.target, method: "PATCH", updateMask: ["role"], payload: { name: request.payload.name, role: request.payload.role } }, options)
    case "delete_admin": return googleAccountManagementApi(token, { path: target.target, method: "DELETE" }, options)
    case "accept_invitation": return googleAccountManagementApi(token, { path: `${target.target}:accept`, method: "POST", payload: {} }, options)
    case "decline_invitation": return googleAccountManagementApi(token, { path: `${target.target}:decline`, method: "POST", payload: {} }, options)
  }
}

export async function executeAdministrationAccess(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string) {
  return withAdministrationLock(session, locationId, async () => {
    const existing = await loadAdministrationAccessAttempt(session, locationId, reviewId)
    if (existing) {
      if (existing.row.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed administration request changed.")
      return projectAdministrationAttempt(existing.row, true)
    }
    const review = await readAdministrationAccessReview(session, locationId, reviewId)
    if (review.changeSet.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed administration request changed.")
    const initial = await currentAdministrationContext(session, locationId)
    await approvedGbpChange({ session, linked: initial, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "administration_access" })
    const { linked, payload } = await assertAdministrationAccessCurrent(session, locationId, review)
    const current = await currentAdministrationContext(session, locationId)
    if (current.connectionId !== linked.connectionId || current.googleAccountId !== linked.googleAccountId || current.googleLocationName !== linked.googleLocationName || current.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_target_changed", "The linked Google target changed after review. Create a fresh review.")
    const change = await approvedGbpChange({ session, linked: current, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "administration_access" })
    const target = scopedAdministrationTarget(payload.request, current)
    const token = await current.accessToken()
    await requireNoUnresolvedPlaceAction(session, current.googleAccountId)
    await withTenant(session.organisationId, async (sql) => {
      const [unresolved] = await sql<{ id: string }[]>`
        select id from gbp_management_mutation where google_account_id = ${current.googleAccountId}
          and resource_type in ('account_admin', 'location_admin', 'invitation', 'location_lifecycle')
          and (status in ('started', 'validated', 'ambiguous') or confirmation_state in ('pending', 'unresolved') or local_reconciliation_state in ('pending', 'conflict')) limit 1
      `
      if (unresolved) throw new ApiError(409, "google_confirmation_unresolved", "An earlier administration change for this Google account is awaiting confirmation. Check its saved outcome before another write.")
    })
    const ready = await currentAdministrationContext(session, locationId)
    if (ready.connectionId !== current.connectionId || ready.googleAccountId !== current.googleAccountId || ready.googleLocationName !== current.googleLocationName || ready.credentialGeneration !== current.credentialGeneration) throw new ApiError(409, "google_target_changed", "The linked Google target or credentials changed before sending. Create a fresh review.")
    await approvedGbpChange({ session, linked: ready, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "administration_access" })
    const claim = await startGbpMutation({ organisationId: session.organisationId, session, locationId, googleAccountId: current.googleAccountId, resourceType: target.resourceType, operation: payload.request.operation, targetResourceName: target.target, requestId: reviewId, expectedGoogleHash: change.baseline_hash, payload, changeSetId: reviewId })
    if (claim.idempotent) return readAdministrationAccessAttempt(session, locationId, reviewId)
    await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.administration.requested", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id, payloadHash: expectedPayloadHash } })
    await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'pending', confirmation_state = 'pending' where id = ${claim.id}`)
    try {
      const response = await sendAdministrationAccess(current, payload.request, token)
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'accepted', google_response = ${response === null ? null : jsonColumn(sql, response)} where id = ${claim.id}`)
    } catch (error) {
      const rejected = error instanceof ApiError && !(error instanceof GoogleMutationAmbiguousError)
      await withTenant(session.organisationId, (sql) => sql`
        update gbp_management_mutation set status = ${rejected ? "failed" : "ambiguous"},
          execution_state = ${rejected ? "rejected" : "unknown"}, confirmation_state = ${rejected ? "unrecorded" : "unresolved"},
          last_error_code = ${rejected ? "administration_provider_rejected" : "administration_outcome_unknown"} where id = ${claim.id}
      `)
      if (rejected) {
        await settleGbpMutation({ organisationId: session.organisationId, mutationId: claim.id, status: "failed", errorCode: "administration_provider_rejected" })
        await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.administration.rejected", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id } })
        return readAdministrationAccessAttempt(session, locationId, reviewId, false)
      }
    }
    const attempt = await loadAdministrationAccessAttempt(session, locationId, reviewId)
    if (!attempt) throw new ApiError(409, "administration_attempt_not_found", "The administration request needs an operational check before another write.")
    return refreshAdministrationObservation(session, locationId, attempt.row, requestId)
  })
}

export async function refreshAdministrationAccessAttempt(session: Session, locationId: string, reviewId: string, requestId: string) {
  return withAdministrationLock(session, locationId, async () => {
    const attempt = await loadAdministrationAccessAttempt(session, locationId, reviewId)
    if (!attempt) throw new ApiError(404, "administration_attempt_not_found", "No administration request is recorded for this review.")
    if (attempt.row.executionState === "rejected") return projectAdministrationAttempt(attempt.row, true)
    if ((attempt.row.status === "started" || attempt.row.status === "validated") && attempt.row.createdAt.getTime() > Date.now() - 5 * 60_000) throw new ApiError(409, "administration_not_ready", "An interrupted request can be checked after five minutes. Read its saved status first.")
    if (attempt.row.executionState === "pending" || attempt.row.executionState === "unrecorded") {
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'unknown' where id = ${attempt.row.id}`)
      return refreshAdministrationObservation(session, locationId, { ...attempt.row, executionState: "unknown" }, requestId)
    }
    return refreshAdministrationObservation(session, locationId, attempt.row, requestId)
  })
}
