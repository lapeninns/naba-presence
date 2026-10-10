import "server-only"
import { approvedGbpChange } from "@/lib/server/gbp-change-sets"
import { jsonColumn, withSessionConnection, withTenant } from "@/lib/server/db"
import { auditGbpMutation, settleGbpMutation, startGbpMutation } from "@/lib/server/gbp-management"
import { deleteGoogleLocation, googleAccountManagementApi, GoogleMutationAmbiguousError } from "@/lib/server/google"
import { currentAdministrationContext } from "@/lib/server/google-administration-state"
import { loadLifecycleAttempt, projectLifecycleAttempt, readLifecycleAttempt, refreshLifecycleObservation } from "@/lib/server/google-lifecycle-attempts"
import { assertLifecycleCurrent, readLifecycleReview } from "@/lib/server/google-lifecycle-reviews"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"
import { requireNoUnresolvedPlaceAction } from "@/lib/server/google-account-change-lock"

async function withLifecycleLock<T>(session: Session, locationId: string, work: () => Promise<T>) {
  const linked = await currentAdministrationContext(session, locationId, false)
  return withSessionConnection((connection) => connection.begin(async (sql) => {
    const [claim] = await sql<{ acquired: boolean }[]>`select pg_try_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${linked.googleAccountId}:administration_access`}, 0)) as acquired`
    if (!claim?.acquired) throw new ApiError(409, "administration_in_progress", "Another access or lifecycle action for this Google account is in progress. Read its saved outcome.")
    return work()
  }))
}
function sameBinding(before: Awaited<ReturnType<typeof currentAdministrationContext>>, after: Awaited<ReturnType<typeof currentAdministrationContext>>) {
  if (before.connectionId !== after.connectionId || before.googleAccountId !== after.googleAccountId || before.googleLocationName !== after.googleLocationName || before.credentialGeneration !== after.credentialGeneration) throw new ApiError(409, "google_target_changed", "The exact linked Google target or credentials changed before sending. Create a fresh lifecycle review.")
}
export async function executeLifecycle(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string) {
  return withLifecycleLock(session, locationId, async () => {
    const existing = await loadLifecycleAttempt(session, locationId, reviewId)
    if (existing) {
      if (existing.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed lifecycle request changed.")
      return projectLifecycleAttempt(existing)
    }
    const review = await readLifecycleReview(session, locationId, reviewId)
    if (review.changeSet.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed lifecycle request changed.")
    const initial = await currentAdministrationContext(session, locationId)
    await approvedGbpChange({ session, linked: initial, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "location_lifecycle" })
    const { linked, payload } = await assertLifecycleCurrent(session, locationId, review)
    const token = await linked.accessToken()
    await requireNoUnresolvedPlaceAction(session, linked.googleAccountId)
    await withTenant(session.organisationId, async (sql) => {
      const [unresolved] = await sql<{ id: string }[]>`select id from gbp_management_mutation
        where google_account_id = ${linked.googleAccountId}
          and resource_type in ('account_admin', 'location_admin', 'invitation', 'location_lifecycle')
          and (status in ('started', 'validated', 'ambiguous') or confirmation_state in ('pending', 'unresolved') or local_reconciliation_state in ('pending', 'conflict')) limit 1`
      if (unresolved) throw new ApiError(409, "google_confirmation_unresolved", "An earlier access or lifecycle change is awaiting confirmation. Read its saved outcome before another write.")
    })
    const ready = await currentAdministrationContext(session, locationId)
    sameBinding(linked, ready)
    const change = await approvedGbpChange({ session, linked: ready, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "location_lifecycle" })
    const claim = await startGbpMutation({ organisationId: session.organisationId, session, locationId, googleAccountId: ready.googleAccountId, resourceType: "location_lifecycle", operation: payload.request.operation, targetResourceName: ready.googleLocationName, requestId: reviewId, expectedGoogleHash: change.baseline_hash, payload, changeSetId: reviewId })
    if (claim.idempotent) return readLifecycleAttempt(session, locationId, reviewId)
    await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.lifecycle.requested", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id, payloadHash: expectedPayloadHash } })
    await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'pending', confirmation_state = 'pending' where id = ${claim.id}`)
    try {
      const response = payload.request.operation === "transfer_location"
        ? await googleAccountManagementApi(token, { path: `${ready.googleLocationName}:transfer`, method: "POST", payload: payload.request.payload }, { connectionKey: ready.connectionId, mutation: true })
        : await deleteGoogleLocation(token, ready.googleLocationName, { connectionKey: ready.connectionId })
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'accepted', google_response = ${response === null ? null : jsonColumn(sql, response)} where id = ${claim.id}`)
    } catch (error) {
      const rejected = error instanceof ApiError && !(error instanceof GoogleMutationAmbiguousError)
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation
        set status = ${rejected ? "failed" : "ambiguous"}, execution_state = ${rejected ? "rejected" : "unknown"},
          confirmation_state = ${rejected ? "unrecorded" : "unresolved"}, last_error_code = ${rejected ? "lifecycle_provider_rejected" : "lifecycle_outcome_unknown"}
        where id = ${claim.id}`)
      if (rejected) {
        await settleGbpMutation({ organisationId: session.organisationId, mutationId: claim.id, status: "failed", errorCode: "lifecycle_provider_rejected" })
        await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.lifecycle.rejected", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id } })
        return readLifecycleAttempt(session, locationId, reviewId, false)
      }
    }
    const row = await loadLifecycleAttempt(session, locationId, reviewId)
    if (!row) throw new ApiError(409, "lifecycle_attempt_not_found", "An operational lifecycle check is required before another write.")
    return refreshLifecycleObservation(session, locationId, row, requestId)
  })
}
export async function refreshLifecycleAttempt(session: Session, locationId: string, reviewId: string, requestId: string) {
  return withLifecycleLock(session, locationId, async () => {
    const row = await loadLifecycleAttempt(session, locationId, reviewId)
    if (!row) throw new ApiError(404, "lifecycle_attempt_not_found", "No lifecycle request is recorded for this review.")
    if (row.executionState === "rejected") return projectLifecycleAttempt(row)
    if ((row.status === "started" || row.status === "validated") && row.createdAt.getTime() > Date.now() - 5 * 60_000) throw new ApiError(409, "lifecycle_not_ready", "An interrupted lifecycle request can be checked after five minutes. Read its saved status first.")
    if (row.executionState === "pending" || row.executionState === "unrecorded") {
      await withTenant(session.organisationId, (sql) => sql`update gbp_management_mutation set execution_state = 'unknown' where id = ${row.id}`)
      return refreshLifecycleObservation(session, locationId, { ...row, executionState: "unknown" }, requestId)
    }
    return refreshLifecycleObservation(session, locationId, row, requestId)
  })
}
