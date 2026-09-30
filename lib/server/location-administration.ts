import "server-only"

import type {
  AdministrationMutationResult,
  AdministrationOperation,
  AdministrationState,
} from "@/lib/contracts/location-administration"
import { getDatabase, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  createGoogleLocation,
  getGoogleUpdatedLocation,
  googleAccountManagementApi,
  GoogleMutationAmbiguousError,
  patchGoogleLocation,
  searchGoogleLocations,
} from "@/lib/server/google"
import {
  auditGbpMutation,
  cacheGbpSnapshot,
  googleCreateRequestId,
  resolveGbpLocationContext,
  settleGbpMutation,
  startGbpMutation,
} from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const COMPLETE_LOCATION_MASK = [
  "name",
  "title",
  "phoneNumbers",
  "profile",
  "storefrontAddress",
  "websiteUri",
  "categories",
  "metadata",
  "serviceArea",
  "storeCode",
  "openInfo",
  "relationshipData",
  "serviceItems",
  "labels",
  "regularHours",
  "specialHours",
  "moreHours",
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
): Promise<AdministrationState> {
  const linked = await context(session, locationId)
  const token = await connectionAccessToken(
    getDatabase(),
    session.organisationId,
    linked.connectionId
  )
  const options = { connectionKey: linked.connectionId }
  const [
    updated,
    locationAdmins,
    accountAdmins,
    invitations,
  ] = await Promise.all([
    safe(() =>
      getGoogleUpdatedLocation(
        token,
        linked.googleLocationName,
        COMPLETE_LOCATION_MASK,
        options
      )
    ),
    safe(() =>
      googleAccountManagementApi(
        token,
        { path: `${linked.googleLocationName}/admins` },
        options
      )
    ),
    safe(() =>
      googleAccountManagementApi(
        token,
        { path: `${linked.accountName}/admins` },
        options
      )
    ),
    safe(() =>
      googleAccountManagementApi(
        token,
        { path: `${linked.accountName}/invitations` },
        options
      )
    ),
  ])
  for (const [resourceType, resourceName, result] of [
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
    voice: { data: null, error: "verification_workflow_moved" },
    verifications: { data: null, error: "verification_workflow_moved" },
    verificationOptions: { data: null, error: "verification_workflow_moved" },
    googleUpdated: updated,
    locationAdmins,
    accountAdmins,
    invitations,
    accountName: linked.accountName,
    googleLocationName: linked.googleLocationName,
    canManage: linked.canPublish,
    writesEnabled: gbpWritesEnabled(getServerEnv(), "profileWrites"),
  }
}

export type { AdministrationOperation }

export async function mutateLocationAdministration(input: {
  session: Session
  locationId: string
  operation: AdministrationOperation
  payload: Record<string, unknown>
  requestId: string
}): Promise<AdministrationMutationResult> {
  if (input.operation === "start_verification" || input.operation === "complete_verification") {
    throw new ApiError(409, "verification_review_required", "Open Verification to review and approve this request before sending it to Google.")
  }
  if (["create_admin", "update_admin", "delete_admin", "accept_invitation", "decline_invitation"].includes(input.operation)) {
    throw new ApiError(409, "administration_review_required", "Open People with access to review and approve the exact administrator or invitation before sending it to Google.")
  }
  if (input.operation === "transfer_location" || input.operation === "delete_location") {
    throw new ApiError(409, "lifecycle_review_required", "Review and approve the exact account transfer or managed-location deletion before sending it to Google.")
  }
  const linked = await context(input.session, input.locationId)
  if (!linked.canPublish)
    throw new ApiError(
      403,
      "publish_not_allowed",
      "You cannot manage this Google location."
    )
  if (!gbpWritesEnabled(getServerEnv(), "profileWrites"))
    throw new ApiError(503, "google_writes_paused", "Google writes are paused.")
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
  const target =
    typeof input.payload.name === "string"
      ? input.payload.name
      : linked.googleLocationName
  const resourceType = input.operation.includes("admin")
      ? input.payload.scope === "account"
        ? "account_admin"
        : "location_admin"
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
    if (input.operation === "create_location") {
      const location = input.payload.location as Record<string, unknown>
      // Google dedupes locations.create by this parameter, so it identifies
      // the location being created rather than this HTTP request: a retry
      // after a lost response carries a fresh ctx.requestId and would
      // otherwise create a second real listing.
      const createRequestId = googleCreateRequestId({
        organisationId: input.session.organisationId,
        accountName: linked.accountName,
        payload: location,
      })
      await createGoogleLocation(
        token,
        {
          accountName: linked.accountName,
          requestId: createRequestId,
          validateOnly: true,
          payload: location,
        },
        { connectionKey: linked.connectionId }
      )
      await settleGbpMutation({
        organisationId: input.session.organisationId,
        mutationId: attempt.id,
        status: "validated",
      })
      response = await createGoogleLocation(
        token,
        {
          accountName: linked.accountName,
          requestId: createRequestId,
          validateOnly: false,
          payload: location,
        },
        { connectionKey: linked.connectionId }
      )
    } else {
      const updateMask = input.payload.updateMask as string[]
      const payload = input.payload.location as Record<string, unknown>
      await patchGoogleLocation(
        token,
        {
          locationName: linked.googleLocationName,
          updateMask,
          validateOnly: true,
          payload,
        },
        { connectionKey: linked.connectionId }
      )
      await settleGbpMutation({
        organisationId: input.session.organisationId,
        mutationId: attempt.id,
        status: "validated",
      })
      response = await patchGoogleLocation(
        token,
        {
          locationName: linked.googleLocationName,
          updateMask,
          validateOnly: false,
          payload,
        },
        { connectionKey: linked.connectionId }
      )
    }
    await settleGbpMutation({
      organisationId: input.session.organisationId,
      mutationId: attempt.id,
      status: "succeeded",
      response,
    })
    await auditGbpMutation({
      organisationId: input.session.organisationId,
      session: input.session,
      action: `google.${input.operation}`,
      subjectType: "location",
      subjectId: input.locationId,
      requestId: input.requestId,
    })
    return { id: attempt.id, status: "succeeded", response, idempotent: false }
  } catch (error) {
    const failure = error
    await settleGbpMutation({
      organisationId: input.session.organisationId,
      mutationId: attempt.id,
      status:
        failure instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed",
      errorCode: mutationErrorCode(failure, `${input.operation}_failed`),
    })
    throw failure
  }
}

export async function matchGoogleLocations(input: {
  session: Session
  locationId: string
  location: Record<string, unknown>
}) {
  const linked = await context(input.session, input.locationId)
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
  return searchGoogleLocations(
    token,
    { location: input.location, pageSize: 10 },
    { connectionKey: linked.connectionId }
  )
}
