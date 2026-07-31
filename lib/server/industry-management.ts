import "server-only"

import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  googleBusinessCallsApi,
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

export async function loadIndustryManagement(session: Session, locationId: string) {
  const linked = await context(session, locationId)
  const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
  const options = { connectionKey: linked.connectionId }
  const [lodging, lodgingUpdated, calls, callInsights, healthcareServices, providerAttributes, insuranceNetworks] = await Promise.all([
    safe(() => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "get" }, options)),
    safe(() => googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "getGoogleUpdated" }, options)),
    safe(() => googleBusinessCallsApi(token, { locationName: linked.googleLocationName, operation: "settings" }, options)),
    safe(() => googleBusinessCallsApi(token, { locationName: linked.googleLocationName, operation: "insights", filter: 'metricType=AGGREGATE_COUNT' }, options)),
    safe(() => googleHealthcareApi(token, { accountName: linked.accountName, locationName: linked.googleLocationName, resource: "serviceList" }, options)),
    safe(() => googleHealthcareApi(token, { accountName: linked.accountName, locationName: linked.googleLocationName, resource: "healthProviderAttributes" }, options)),
    safe(() => googleHealthcareApi(token, { accountName: linked.accountName, locationName: linked.googleLocationName, resource: "insuranceNetworks" }, options)),
  ])
  for (const [resourceType, resourceName, result] of [
    ["lodging", `${linked.googleLocationName}/lodging`, lodging],
    ["business_calls", `${linked.googleLocationName}/businesscallssettings`, calls],
    ["business_call_insights", `${linked.googleLocationName}/businesscallsinsights`, callInsights],
    ["healthcare_services", `${linked.accountName}/${linked.googleLocationName}/serviceList`, healthcareServices],
    ["healthcare_provider_attributes", `${linked.accountName}/${linked.googleLocationName}/healthProviderAttributes`, providerAttributes],
    ["insurance_networks", `${linked.accountName}/${linked.googleLocationName}/insuranceNetworks`, insuranceNetworks],
  ] as const) {
    if (result.data) await cacheGbpSnapshot({ organisationId: session.organisationId, locationId, googleAccountId: linked.googleAccountId, resourceType, resourceName, payload: result.data })
  }
  return { lodging, lodgingUpdated, calls, callInsights, healthcareServices, providerAttributes, insuranceNetworks, canManage: linked.canPublish, writesEnabled: getServerEnv().PUBLISH_ENABLED }
}

export type IndustryOperation = "update_lodging" | "update_business_calls" | "update_healthcare_services" | "update_healthcare_provider_attributes"

export async function mutateIndustryManagement(input: {
  session: Session
  locationId: string
  operation: IndustryOperation
  payload: Record<string, unknown>
  updateMask: string[]
  requestId: string
}) {
  const linked = await context(input.session, input.locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
  if (!getServerEnv().PUBLISH_ENABLED) throw new ApiError(503, "google_writes_paused", "Google writes are paused.")
  const token = await connectionAccessToken(getDatabase(), input.session.organisationId, linked.connectionId)
  const resourceType = input.operation === "update_lodging" ? "lodging" : input.operation === "update_business_calls" ? "business_calls" : input.operation === "update_healthcare_services" ? "healthcare_services" : "healthcare_provider_attributes"
  const attempt = await startGbpMutation({ organisationId: input.session.organisationId, session: input.session, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType, operation: input.operation, targetResourceName: linked.googleLocationName, requestId: input.requestId, updateMask: input.updateMask, payload: input.payload })
  if (attempt.idempotent) return attempt
  try {
    let response: Record<string, unknown>
    if (input.operation === "update_lodging") {
      response = await googleLodgingApi(token, { locationName: linked.googleLocationName, operation: "patch", updateMask: input.updateMask, payload: input.payload }, { connectionKey: linked.connectionId })
    } else if (input.operation === "update_business_calls") {
      response = await googleBusinessCallsApi(token, { locationName: linked.googleLocationName, operation: "patch", updateMask: input.updateMask, payload: input.payload }, { connectionKey: linked.connectionId })
    } else {
      response = await googleHealthcareApi(token, { accountName: linked.accountName, locationName: linked.googleLocationName, resource: input.operation === "update_healthcare_services" ? "serviceList" : "healthProviderAttributes", method: "PATCH", updateMask: input.updateMask, payload: input.payload }, { connectionKey: linked.connectionId })
    }
    await cacheGbpSnapshot({ organisationId: input.session.organisationId, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType, resourceName: `${linked.googleLocationName}/${resourceType}`, payload: response })
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: "succeeded", response })
    await auditGbpMutation({ organisationId: input.session.organisationId, session: input.session, action: `google.${input.operation}`, subjectType: "location", subjectId: input.locationId, requestId: input.requestId, metadata: { updateMask: input.updateMask } })
    return { id: attempt.id, status: "succeeded", response, idempotent: false }
  } catch (error) {
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed", errorCode: errorCode(error, `${input.operation}_failed`) })
    throw error
  }
}
