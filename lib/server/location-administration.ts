import "server-only"

import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  createGoogleLocation,
  deleteGoogleLocation,
  getGoogleUpdatedLocation,
  googleAccountManagementApi,
  googleVerificationApi,
  GoogleMutationAmbiguousError,
  patchGoogleLocation,
  searchGoogleLocations,
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

const COMPLETE_LOCATION_MASK = [
  "name", "title", "phoneNumbers", "profile", "storefrontAddress",
  "websiteUri", "categories", "metadata", "serviceArea", "storeCode",
  "openInfo", "relationshipData", "serviceItems", "labels", "regularHours",
  "specialHours", "moreHours",
]

async function context(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    resolveGbpLocationContext(sql, session, locationId)
  )
}

function mutationErrorCode(error: unknown, fallback: string) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : fallback
}

async function safe<T>(operation: () => Promise<T>) {
  try {
    return { data: await operation(), error: null }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Google request failed.",
    }
  }
}

export async function loadLocationAdministration(
  session: Session,
  locationId: string
) {
  const linked = await context(session, locationId)
  const token = await connectionAccessToken(
    getDatabase(), session.organisationId, linked.connectionId
  )
  const options = { connectionKey: linked.connectionId }
  const [voice, verifications, verificationOptions, updated, locationAdmins, accountAdmins, invitations] =
    await Promise.all([
      safe(() => googleVerificationApi(token, { path: `${linked.googleLocationName}/VoiceOfMerchantState` }, options)),
      safe(() => googleVerificationApi(token, { path: `${linked.googleLocationName}/verifications?pageSize=100` }, options)),
      safe(() => googleVerificationApi(token, { path: `${linked.googleLocationName}:fetchVerificationOptions`, method: "POST", payload: { languageCode: "en" } }, options)),
      safe(() => getGoogleUpdatedLocation(token, linked.googleLocationName, COMPLETE_LOCATION_MASK, options)),
      safe(() => googleAccountManagementApi(token, { path: `${linked.googleLocationName}/admins` }, options)),
      safe(() => googleAccountManagementApi(token, { path: `${linked.accountName}/admins` }, options)),
      safe(() => googleAccountManagementApi(token, { path: `${linked.accountName}/invitations` }, options)),
    ])
  for (const [resourceType, resourceName, result] of [
    ["verification", `${linked.googleLocationName}/VoiceOfMerchantState`, voice],
    ["google_update", `${linked.googleLocationName}:getGoogleUpdated`, updated],
    ["location_admin", `${linked.googleLocationName}/admins`, locationAdmins],
    ["account_admin", `${linked.accountName}/admins`, accountAdmins],
    ["invitation", `${linked.accountName}/invitations`, invitations],
  ] as const) {
    if (result.data) {
      await cacheGbpSnapshot({
        organisationId: session.organisationId,
        locationId,
        googleAccountId: linked.googleAccountId,
        resourceType,
        resourceName,
        payload: result.data,
      })
    }
  }
  return {
    voice,
    verifications,
    verificationOptions,
    googleUpdated: updated,
    locationAdmins,
    accountAdmins,
    invitations,
    accountName: linked.accountName,
    googleLocationName: linked.googleLocationName,
    canManage: linked.canPublish,
    writesEnabled: getServerEnv().PUBLISH_ENABLED,
  }
}

type AdministrationOperation =
  | "start_verification" | "complete_verification"
  | "create_admin" | "update_admin" | "delete_admin"
  | "accept_invitation" | "decline_invitation" | "transfer_location"
  | "create_location" | "delete_location" | "accept_google_update"

export async function mutateLocationAdministration(input: {
  session: Session
  locationId: string
  operation: AdministrationOperation
  payload: Record<string, unknown>
  requestId: string
}) {
  const linked = await context(input.session, input.locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot manage this Google location.")
  if (!getServerEnv().PUBLISH_ENABLED) throw new ApiError(503, "google_writes_paused", "Google writes are paused.")
  const token = await connectionAccessToken(getDatabase(), input.session.organisationId, linked.connectionId)
  const target = typeof input.payload.name === "string" ? input.payload.name : linked.googleLocationName
  const resourceType = input.operation.includes("verification")
    ? "verification"
    : input.operation.includes("admin")
      ? (input.payload.scope === "account" ? "account_admin" : "location_admin")
      : input.operation.includes("invitation")
        ? "invitation"
        : "location_lifecycle"
  const attempt = await startGbpMutation({
    organisationId: input.session.organisationId,
    session: input.session,
    locationId: input.locationId,
    googleAccountId: linked.googleAccountId,
    resourceType,
    operation: input.operation,
    targetResourceName: target,
    requestId: input.requestId,
    payload: input.payload,
  })
  if (attempt.idempotent) return attempt
  try {
    let response: unknown
    if (input.operation === "start_verification") {
      response = await googleVerificationApi(token, { path: `${linked.googleLocationName}:verify`, method: "POST", payload: input.payload }, { connectionKey: linked.connectionId, mutation: true })
    } else if (input.operation === "complete_verification") {
      response = await googleVerificationApi(token, { path: `${String(input.payload.name)}:complete`, method: "POST", payload: { pin: input.payload.pin } }, { connectionKey: linked.connectionId, mutation: true })
    } else if (input.operation === "create_admin") {
      const parent = input.payload.scope === "account" ? linked.accountName : linked.googleLocationName
      response = await googleAccountManagementApi(token, { path: `${parent}/admins`, method: "POST", payload: { admin: input.payload.admin, role: input.payload.role, ...(input.payload.account ? { account: input.payload.account } : {}) } }, { connectionKey: linked.connectionId, mutation: true })
    } else if (input.operation === "update_admin") {
      response = await googleAccountManagementApi(token, { path: String(input.payload.name), method: "PATCH", updateMask: ["role"], payload: { name: input.payload.name, role: input.payload.role } }, { connectionKey: linked.connectionId, mutation: true })
    } else if (input.operation === "delete_admin") {
      response = await googleAccountManagementApi(token, { path: String(input.payload.name), method: "DELETE" }, { connectionKey: linked.connectionId, mutation: true })
    } else if (input.operation === "accept_invitation" || input.operation === "decline_invitation") {
      response = await googleAccountManagementApi(token, { path: `${String(input.payload.name)}:${input.operation === "accept_invitation" ? "accept" : "decline"}`, method: "POST", payload: {} }, { connectionKey: linked.connectionId, mutation: true })
    } else if (input.operation === "transfer_location") {
      response = await googleAccountManagementApi(token, { path: `${linked.googleLocationName}:transfer`, method: "POST", payload: { destinationAccount: input.payload.destinationAccount } }, { connectionKey: linked.connectionId, mutation: true })
    } else if (input.operation === "create_location") {
      await createGoogleLocation(token, { accountName: linked.accountName, requestId: input.requestId, validateOnly: true, payload: input.payload.location as Record<string, unknown> }, { connectionKey: linked.connectionId })
      await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: "validated" })
      response = await createGoogleLocation(token, { accountName: linked.accountName, requestId: input.requestId, validateOnly: false, payload: input.payload.location as Record<string, unknown> }, { connectionKey: linked.connectionId })
    } else if (input.operation === "delete_location") {
      response = await deleteGoogleLocation(token, linked.googleLocationName, { connectionKey: linked.connectionId })
    } else {
      const updateMask = input.payload.updateMask as string[]
      const payload = input.payload.location as Record<string, unknown>
      await patchGoogleLocation(token, { locationName: linked.googleLocationName, updateMask, validateOnly: true, payload }, { connectionKey: linked.connectionId })
      await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: "validated" })
      response = await patchGoogleLocation(token, { locationName: linked.googleLocationName, updateMask, validateOnly: false, payload }, { connectionKey: linked.connectionId })
    }
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: "succeeded", response })
    await auditGbpMutation({ organisationId: input.session.organisationId, session: input.session, action: `google.${input.operation}`, subjectType: "location", subjectId: input.locationId, requestId: input.requestId })
    return { id: attempt.id, status: "succeeded", response, idempotent: false }
  } catch (error) {
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed", errorCode: mutationErrorCode(error, `${input.operation}_failed`) })
    throw error
  }
}

export async function matchGoogleLocations(input: {
  session: Session
  locationId: string
  location: Record<string, unknown>
}) {
  const linked = await context(input.session, input.locationId)
  const token = await connectionAccessToken(getDatabase(), input.session.organisationId, linked.connectionId)
  return searchGoogleLocations(token, { location: input.location, pageSize: 10 }, { connectionKey: linked.connectionId })
}
