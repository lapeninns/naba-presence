import "server-only"
import { approvedGbpChange } from "@/lib/server/gbp-change-sets"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { auditGbpMutation } from "@/lib/server/gbp-management"
import { createGooglePlaceActionLink, deleteGooglePlaceActionLink, patchGooglePlaceActionLink, GoogleMutationAmbiguousError } from "@/lib/server/google"
import { requireNoUnresolvedAccountChange, withGoogleAccountChangeLock } from "@/lib/server/google-account-change-lock"
import { reportAttemptOutcome } from "@/lib/server/notifications/attempt-events"
import { loadPlaceActionAttempt, projectPlaceActionAttempt, readPlaceActionAttempt, refreshPlaceActionObservation } from "@/lib/server/place-action-attempts"
import { currentPlaceActionContext } from "@/lib/server/place-action-review-state"
import { assertPlaceActionCurrent, readPlaceActionReview, requireSamePlaceActionBinding } from "@/lib/server/place-action-reviews"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

export async function executePlaceAction(session: Session, locationId: string, reviewId: string, expectedPayloadHash: string, requestId: string) {
  return withGoogleAccountChangeLock(session, locationId, async () => {
    const existing = await loadPlaceActionAttempt(session, locationId, reviewId)
    if (existing) {
      if (existing.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed action link request changed.")
      return projectPlaceActionAttempt(existing)
    }
    const review = await readPlaceActionReview(session, locationId, reviewId)
    if (review.changeSet.payloadHash !== expectedPayloadHash) throw new ApiError(409, "approval_stale", "The reviewed action link request changed.")
    const initial = await currentPlaceActionContext(session, locationId)
    await approvedGbpChange({ session, linked: initial, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "place_action" })
    const { linked, payload } = await assertPlaceActionCurrent(session, locationId, review)
    await requireNoUnresolvedAccountChange(session, linked.googleAccountId)
    const token = await linked.accessToken(), ready = await currentPlaceActionContext(session, locationId)
    requireSamePlaceActionBinding(linked, ready)
    await approvedGbpChange({ session, linked: ready, changeSetId: reviewId, payload: review.changeSet.payload, updateMask: [], resourceType: "place_action" })
    const request = payload.request
    const claim = await withTenant(session.organisationId, async (sql) => {
      const [row] = await sql<{ id: string }[]>`insert into place_action_mutation (
        organisation_id, location_id, external_location_id, actor_user_id, google_account_id,
        operation, status, idempotency_key, requested_payload, google_link_name, change_set_id,
        execution_state, confirmation_state
      ) values (${session.organisationId}, ${locationId}, ${ready.externalLocationId}, ${session.userId}, ${ready.googleAccountId},
        ${request.operation}, 'started', ${`place_action:${reviewId}`}, ${jsonColumn(sql, payload)},
        ${request.operation === "create" ? null : request.name}, ${reviewId}, 'pending', 'pending')
        on conflict (organisation_id, change_set_id) where change_set_id is not null do nothing returning id`
      return row
    })
    if (!claim) return readPlaceActionAttempt(session, locationId, reviewId)
    await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.place_action.requested", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id, payloadHash: expectedPayloadHash } })
    const options = { connectionKey: ready.connectionId }
    try {
      const response = request.operation === "create" ? await createGooglePlaceActionLink(token, { locationName: ready.googleLocationName, payload: request.payload }, options)
        : request.operation === "update" ? await patchGooglePlaceActionLink(token, { name: request.name, payload: request.payload }, options)
        : await deleteGooglePlaceActionLink(token, request.name, options)
      await withTenant(session.organisationId, (sql) => sql`update place_action_mutation set execution_state = 'accepted',
        google_response = ${response === null ? null : jsonColumn(sql, response)} where id = ${claim.id}`)
    } catch (error) {
      const rejected = error instanceof ApiError && !(error instanceof GoogleMutationAmbiguousError)
      await withTenant(session.organisationId, (sql) => sql`update place_action_mutation
        set status = ${rejected ? "failed" : "ambiguous"}, execution_state = ${rejected ? "rejected" : "unknown"},
          confirmation_state = ${rejected ? "unrecorded" : "unresolved"},
          last_error_code = ${rejected ? "place_action_provider_rejected" : "place_action_outcome_unknown"},
          confirmation_error_code = ${rejected ? "place_action_provider_rejected" : "place_action_outcome_unknown"}, finished_at = now() where id = ${claim.id}`)
      if (rejected) {
        await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.place_action.rejected", subjectType: "location", subjectId: locationId, requestId, metadata: { reviewId, mutationId: claim.id } })
        await reportAttemptOutcome({ organisationId: session.organisationId, locationId, family: "links", attemptId: claim.id, outcome: { kind: "publication_failed", reason: "provider_rejected" } })
        return readPlaceActionAttempt(session, locationId, reviewId, false)
      }
    }
    const row = await loadPlaceActionAttempt(session, locationId, reviewId)
    if (!row) throw new ApiError(409, "place_action_attempt_not_found", "The action link request needs an operational check before another write.")
    return refreshPlaceActionObservation(session, locationId, row, requestId)
  })
}
export async function refreshPlaceActionAttempt(session: Session, locationId: string, reviewId: string, requestId: string) {
  return withGoogleAccountChangeLock(session, locationId, async () => {
    const row = await loadPlaceActionAttempt(session, locationId, reviewId)
    if (!row) throw new ApiError(404, "place_action_attempt_not_found", "No action link request is recorded for this review.")
    if (row.executionState === "rejected") return projectPlaceActionAttempt(row)
    if (row.status === "started" && row.createdAt.getTime() > Date.now() - 5 * 60_000) throw new ApiError(409, "place_action_not_ready", "An interrupted action link request can be checked after five minutes. Read its saved status first.")
    if (["pending", "unrecorded"].includes(row.executionState)) {
      await withTenant(session.organisationId, (sql) => sql`update place_action_mutation set execution_state = 'unknown' where id = ${row.id}`)
      return refreshPlaceActionObservation(session, locationId, { ...row, executionState: "unknown" }, requestId)
    }
    return refreshPlaceActionObservation(session, locationId, row, requestId)
  })
}
