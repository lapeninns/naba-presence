import "server-only"

import type {
  IndustryMutationResult,
  IndustryOperation,
  IndustryState,
} from "@/lib/contracts/location-industry"
import { getDatabase, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  googleHealthcareApi,
  googleLodgingApi,
  GoogleMutationAmbiguousError,
} from "@/lib/server/google"
import {
  auditGbpMutation,
  cacheGbpSnapshot,
  resolveGbpLocationContext,
  settleGbpMutation,
  startGbpMutation,
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

function errorCode(error: unknown, fallback: string) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : fallback
}

export async function loadIndustryManagement(session: Session, locationId: string): Promise<IndustryState> {
  const linked = await context(session, locationId)
  const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
  const options = { connectionKey: linked.connectionId }
  // Only APIs Google still serves. Business Calls (retired 2023-05-30) and
  // healthProviderAttributes/insuranceNetworks (retired 2024-07-01) are no
  // longer asked; snapshots cached from them before then are never read and
  // age out with the retention purge.
  const [lodging, lodgingUpdated, healthcareServices] = await Promise.all([
    safe(() => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "get" }, options)),
    safe(() => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "getGoogleUpdated" }, options)),
    safe(() => googleHealthcareApi(token, { accountName: linked.accountName, locationName: linked.googleLocationName, resource: "serviceList" }, options)),
  ])
  for (const [resourceType, resourceName, result] of [
    ["lodging", `${linked.googleLocationName}/lodging`, lodging],
    ["healthcare_services", `${linked.accountName}/${linked.googleLocationName}/serviceList`, healthcareServices],
  ] as const) {
    if (result.data) await cacheGbpSnapshot({ organisationId: session.organisationId, locationId, googleAccountId: linked.googleAccountId, resourceType, resourceName, payload: result.data })
  }
  return { lodging, lodgingUpdated, healthcareServices, canManage: linked.canPublish, writesEnabled: gbpWritesEnabled(getServerEnv(), "profileWrites") }
}

export type { IndustryOperation }

export async function mutateIndustryManagement(input: {
  session: Session
  locationId: string
  operation: IndustryOperation
  payload: Record<string, unknown>
  updateMask: string[]
  requestId: string
}): Promise<IndustryMutationResult> {
  const linked = await context(input.session, input.locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
  if (!gbpWritesEnabled(getServerEnv(), "profileWrites")) throw new ApiError(503, "google_writes_paused", "Google writes are paused.")
  const token = await connectionAccessToken(getDatabase(), input.session.organisationId, linked.connectionId)
  const resourceType = input.operation === "update_lodging" ? "lodging" : "healthcare_services"
  const attempt = await startGbpMutation({ organisationId: input.session.organisationId, session: input.session, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType, operation: input.operation, targetResourceName: linked.googleLocationName, requestId: input.requestId, updateMask: input.updateMask, payload: input.payload })
  if (attempt.idempotent) return attempt
  try {
    let response: Record<string, unknown>
    if (input.operation === "update_lodging") {
      response = await googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "patch", updateMask: input.updateMask, payload: input.payload }, { connectionKey: linked.connectionId })
    } else {
      response = await googleHealthcareApi(token, { accountName: linked.accountName, locationName: linked.googleLocationName, resource: "serviceList", method: "PATCH", updateMask: input.updateMask, payload: input.payload }, { connectionKey: linked.connectionId })
    }
    // A 2xx that is not the updated resource may still have written: settle
    // it uncertain instead of caching it as the live state.
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new GoogleMutationAmbiguousError("Google did not return the updated resource.")
    await cacheGbpSnapshot({ organisationId: input.session.organisationId, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType, resourceName: `${linked.googleLocationName}/${resourceType}`, payload: response })
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: "succeeded", response })
    await auditGbpMutation({ organisationId: input.session.organisationId, session: input.session, action: `google.${input.operation}`, subjectType: "location", subjectId: input.locationId, requestId: input.requestId, metadata: { updateMask: input.updateMask } })
    return { id: attempt.id, status: "succeeded", response, idempotent: false }
  } catch (error) {
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed", errorCode: errorCode(error, `${input.operation}_failed`) })
    throw error
  }
}
