import "server-only"
import { z } from "zod"
import { approvedLodgingChange, listLodgingChangeSets } from "@/lib/server/gbp-change-sets"

import type {
  IndustryMutationResult,
  IndustryOperation,
  IndustryState,
} from "@/lib/contracts/location-industry"
import { retiredGoogleMessage } from "@/lib/domain/google-support"
import { executeAndConfirmGbpMutation, observeAndConfirmGbpMutation } from "@/lib/server/gbp-confirmation"
import { getDatabase, withTenant, withSessionConnection } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  googleLodgingApi,
} from "@/lib/server/google"
import {
  auditGbpMutation,
  cacheGbpSnapshot,
  resolveGbpLocationContext,
  startGbpMutation,
  stableGoogleHash,
  type GbpLocationContext,
} from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

async function context(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    resolveGbpLocationContext(sql, session, locationId)
  )
}

async function safe<T>(operation: () => Promise<T>) {
  try { return { data: await operation(), error: null } }
  catch (error) { return { data: null, error: error instanceof Error ? error.message : "Google request failed." } }
}

export async function loadIndustryManagement(session: Session, locationId: string): Promise<IndustryState> {
  const linked = await context(session, locationId)
  const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
  const options = { connectionKey: linked.connectionId }
  const calls = { data: null, error: retiredGoogleMessage("businessCalls") }
  const callInsights = calls
  const providerAttributes = { data: null, error: retiredGoogleMessage("healthcareProviderAttributes") }
  const insuranceNetworks = { data: null, error: retiredGoogleMessage("insuranceNetworks") }
  const healthcareServices = { data: null, error: null }
  const [lodging, lodgingUpdated] = await Promise.all([
    safe(() => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "get" }, options)),
    safe(() => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "getGoogleUpdated" }, options)),
  ])
  for (const [resourceType, resourceName, result] of [
    ["lodging", `${linked.googleLocationName}/lodging`, lodging],
  ] as const) {
    if (result.data) await cacheGbpSnapshot({ organisationId: session.organisationId, locationId, googleAccountId: linked.googleAccountId, resourceType, resourceName, payload: result.data })
  }
  return { lodging, lodgingUpdated, calls, callInsights, healthcareServices, providerAttributes, insuranceNetworks, canManage: linked.canPublish, writesEnabled: gbpWritesEnabled(getServerEnv(), "profileWrites"), ...(lodging.data ? { lodgingHash: stableGoogleHash(lodging.data) } : {}), lodgingChangeSets: await listLodgingChangeSets(session, linked) }
}

export type { IndustryOperation }

export async function confirmIndustryManagement(session: Session, locationId: string, mutationId: string, requestId: string): Promise<IndustryMutationResult> {
  const linked = await context(session, locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot manage this location.")
  return withSessionConnection((connection) => connection.begin(async (sql) => {
    await sql`select set_config('app.organisation_id', ${session.organisationId}, true)`
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${locationId}:lodging`}, 0))`
    const [attempt] = await sql<{ status: string; execution_state: string; confirmation_state: string; requested_payload: unknown; update_mask: string[]; google_response: unknown; target_resource_name: string | null; google_account_id: string | null; recovery_ready: boolean }[]>`
      select status, execution_state, confirmation_state, requested_payload, update_mask, google_response, target_resource_name, google_account_id,
        (status = 'ambiguous' or (status in ('started', 'validated') and created_at < now() - interval '5 minutes')) as recovery_ready
      from gbp_management_mutation where id = ${mutationId} and location_id = ${locationId} and resource_type = 'lodging'
    `
    if (!attempt) throw new ApiError(404, "mutation_not_found", "The lodging change was not found.")
    if (attempt.target_resource_name !== linked.googleLocationName || attempt.google_account_id !== linked.googleAccountId) {
      throw new ApiError(409, "google_target_changed", "This location is linked to a different Google target. The earlier change cannot be confirmed here.")
    }
    if (attempt.status === "succeeded" && attempt.confirmation_state === "confirmed") {
      return { id: mutationId, status: "succeeded", idempotent: true, confirmationState: "confirmed" }
    }
    if (!attempt.recovery_ready) throw new ApiError(409, "mutation_not_ready", "This lodging change cannot be checked yet. An interrupted request can be checked after five minutes.")
    const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
    const result = await observeAndConfirmGbpMutation({
      organisationId: session.organisationId,
      mutationId,
      payload: z.record(z.string(), z.unknown()).parse(attempt.requested_payload),
      updateMask: attempt.update_mask,
      executionState: attempt.execution_state === "accepted" ? "accepted" : "unknown",
      response: attempt.google_response == null ? undefined : z.record(z.string(), z.unknown()).parse(attempt.google_response),
      observe: () => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "get" }, { connectionKey: linked.connectionId }),
      onObserved: (response) => cacheGbpSnapshot({ organisationId: session.organisationId, locationId, googleAccountId: linked.googleAccountId, resourceType: "lodging", resourceName: `${linked.googleLocationName}/lodging`, payload: response }),
    })
    await auditGbpMutation({ organisationId: session.organisationId, session, action: "google.confirm_lodging", subjectType: "location", subjectId: locationId, requestId, metadata: { mutationId, executionState: result.executionState, confirmationState: result.confirmationState } })
    return result
  }))
}

export async function mutateIndustryManagement(input: {
  session: Session
  locationId: string
  operation: IndustryOperation
  payload: Record<string, unknown>
  updateMask: string[]
  requestId: string
  changeSetId?: string
}): Promise<IndustryMutationResult> {
  if (input.operation === "update_healthcare_services") throw new ApiError(409, "service_review_required", "Use the general Services editor to review and approve the exact service changes before sending.")
  const linked = await context(input.session, input.locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
  if (input.operation === "update_business_calls" || input.operation === "update_healthcare_provider_attributes") {
    throw new ApiError(410, "provider_capability_retired", retiredGoogleMessage(
      input.operation === "update_business_calls" ? "businessCalls" : "healthcareProviderAttributes"
    ))
  }
  if (!gbpWritesEnabled(getServerEnv(), "profileWrites")) throw new ApiError(503, "google_writes_paused", "Google writes are paused.")
  return publishReviewedLodging(input, linked)
}

async function publishReviewedLodging(input: Parameters<typeof mutateIndustryManagement>[0], initial: GbpLocationContext): Promise<IndustryMutationResult> {
  const changeSetId = input.changeSetId
  if (!changeSetId) throw new ApiError(409, "approval_required", "Review and approve the exact lodging change before publishing.")
  return withSessionConnection((connection) => connection.begin(async (lock) => {
    await lock`select pg_advisory_xact_lock(hashtextextended(${`${input.session.organisationId}:${input.locationId}:lodging`}, 0))`
    const linked = await context(input.session, input.locationId)
    if (!linked.canPublish || linked.connectionId !== initial.connectionId) throw new ApiError(409, "google_target_changed", "Location access or its connection changed. Refresh the review.")
    const change = await approvedLodgingChange(input.session, linked, changeSetId, input.payload, input.updateMask)
    const [existing] = await withTenant(input.session.organisationId, (sql) => sql<{ id: string; status: string; executionState: IndustryMutationResult["executionState"]; confirmationState: IndustryMutationResult["confirmationState"] }[]>`
      select id, status, execution_state as "executionState", confirmation_state as "confirmationState" from gbp_management_mutation where change_set_id = ${changeSetId}
    `)
    if (existing) return { ...existing, idempotent: true }
    const token = await linked.accessToken()
    const baseline = await googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "get" }, { connectionKey: linked.connectionId })
    if (stableGoogleHash(baseline) !== change.baseline_hash) throw new ApiError(409, "google_baseline_stale", "Google changed after review. Generate and approve a new preview.")
    await approvedLodgingChange(input.session, await context(input.session, input.locationId), changeSetId, input.payload, input.updateMask)
    const attempt = await startGbpMutation({ organisationId: input.session.organisationId, session: input.session, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType: "lodging", operation: "update_lodging", targetResourceName: linked.googleLocationName, requestId: changeSetId, expectedGoogleHash: change.baseline_hash, updateMask: change.update_mask, payload: change.payload, changeSetId, blockUnresolved: true, lockHeld: true })
    if (attempt.idempotent) return attempt
    const result = await executeAndConfirmGbpMutation({
      organisationId: input.session.organisationId, mutationId: attempt.id, payload: change.payload, updateMask: change.update_mask,
      execute: () => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "patch", updateMask: change.update_mask, payload: change.payload }, { connectionKey: linked.connectionId }),
      observe: () => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "get" }, { connectionKey: linked.connectionId }),
      onObserved: (response) => cacheGbpSnapshot({ organisationId: input.session.organisationId, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType: "lodging", resourceName: `${linked.googleLocationName}/lodging`, payload: response }),
    })
    await auditGbpMutation({ organisationId: input.session.organisationId, session: input.session, action: "google.update_lodging", subjectType: "location", subjectId: input.locationId, requestId: input.requestId, metadata: { changeSetId, approvedBy: change.approved_by, requestedBy: change.requested_by, executionState: result.executionState, confirmationState: result.confirmationState } })
    return result
  }))
}
