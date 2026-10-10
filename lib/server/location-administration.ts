import "server-only"

import {
  ADMINISTRATION_RESOURCE_NAME_PATTERNS,
  INVALID_ADMINISTRATION_RESOURCE_NAME,
  isAdministrationNamedOperation,
  type AdministrationFailure,
  type AdministrationMutationResult,
  type AdministrationNamedOperation,
  type AdministrationOperation,
  type AdministrationState,
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
import { requireGbpDispatch } from "@/lib/server/pause-controls"
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
    let failure: AdministrationFailure = "unknown"
    if (error instanceof ApiError) {
      if (
        error.status === 401 ||
        error.reconnectRequired ||
        error.code === "insufficient_scope"
      )
        failure = "reconnect_required"
      else if (error.status === 403) failure = "permission_denied"
      else if (error.status === 404) failure = "not_found"
      else if (error.status === 429 || error.status >= 500)
        failure = "transient"
    } else if (
      error instanceof TypeError ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      failure = "transient"
    }
    return {
      data: null,
      error: "This Google resource could not be loaded.",
      failure,
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
  const [updated, locationAdmins, accountAdmins, invitations] =
    await Promise.all([
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

/**
 * The Google resource name a name-bearing operation may act on, after
 * checking it both against the exact resource shape and against the linked
 * location/account resolved server-side for this request.
 *
 * `payload.name` is client-supplied and is interpolated into a Google URL
 * path, so a name that merely looks valid but belongs to another location or
 * account, or to a different resource type, must never reach the provider.
 * Rejections use the route's validation error shape (400 invalid_request).
 */
export function scopedAdministrationResourceName(
  operation: AdministrationNamedOperation,
  name: unknown,
  linked: { googleLocationName: string; accountName: string }
): string {
  const parents: Record<AdministrationNamedOperation, string[]> = {
    complete_verification: [`${linked.googleLocationName}/verifications/`],
    update_admin: [
      `${linked.googleLocationName}/admins/`,
      `${linked.accountName}/admins/`,
    ],
    delete_admin: [
      `${linked.googleLocationName}/admins/`,
      `${linked.accountName}/admins/`,
    ],
    accept_invitation: [`${linked.accountName}/invitations/`],
    decline_invitation: [`${linked.accountName}/invitations/`],
  }
  if (
    typeof name === "string" &&
    ADMINISTRATION_RESOURCE_NAME_PATTERNS[operation].test(name) &&
    parents[operation].some(
      (parent) =>
        name.startsWith(parent) && !name.slice(parent.length).includes("/")
    )
  ) {
    return name
  }
  throw new ApiError(
    400,
    "invalid_request",
    "The request did not pass validation.",
    { fieldErrors: { "payload.name": INVALID_ADMINISTRATION_RESOURCE_NAME } }
  )
}

export async function mutateLocationAdministration(input: {
  session: Session
  locationId: string
  operation: AdministrationOperation
  payload: Record<string, unknown>
  requestId: string
}): Promise<AdministrationMutationResult> {
  // A client-supplied resource name is checked against the linked location
  // and account first, so a hostile name is always a 400 whatever happens to
  // the operation next. Name-bearing operations then go to their reviewed
  // workflows; this path never sends them.
  if (isAdministrationNamedOperation(input.operation)) {
    const named = await context(input.session, input.locationId)
    scopedAdministrationResourceName(input.operation, input.payload.name, {
      googleLocationName: named.googleLocationName,
      accountName: named.accountName,
    })
  }
  if (
    input.operation === "start_verification" ||
    input.operation === "complete_verification"
  ) {
    throw new ApiError(
      409,
      "verification_review_required",
      "Open Verification to review and approve this request before sending it to Google."
    )
  }
  if (
    [
      "create_admin",
      "update_admin",
      "delete_admin",
      "accept_invitation",
      "decline_invitation",
    ].includes(input.operation)
  ) {
    throw new ApiError(
      409,
      "administration_review_required",
      "Open People with access to review and approve the exact administrator or invitation before sending it to Google."
    )
  }
  if (
    input.operation === "transfer_location" ||
    input.operation === "delete_location"
  ) {
    throw new ApiError(
      409,
      "lifecycle_review_required",
      "Review and approve the exact account transfer or managed-location deletion before sending it to Google."
    )
  }
  const linked = await context(input.session, input.locationId)
  if (!linked.canPublish)
    throw new ApiError(
      403,
      "publish_not_allowed",
      "You cannot manage this Google location."
    )
  await requireGbpDispatch("profileWrites", {
    code: "google_writes_paused",
    message: "Google writes are paused.",
  })
  // Validated before a token is fetched or a mutation row is recorded.
  const resourceName = isAdministrationNamedOperation(input.operation)
    ? scopedAdministrationResourceName(input.operation, input.payload.name, {
        googleLocationName: linked.googleLocationName,
        accountName: linked.accountName,
      })
    : null
  const target = resourceName ?? linked.googleLocationName
  const adminScope = resourceName
    ? resourceName.startsWith(`${linked.accountName}/`)
      ? "account"
      : "location"
    : input.payload.scope
  const resourceType = input.operation.includes("verification")
    ? "verification"
    : input.operation.includes("admin")
      ? adminScope === "account"
        ? "account_admin"
        : "location_admin"
      : input.operation.includes("invitation")
        ? "invitation"
        : "location_lifecycle"
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
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
        failure instanceof GoogleMutationAmbiguousError
          ? "ambiguous"
          : "failed",
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
