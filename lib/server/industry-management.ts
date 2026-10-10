import "server-only"

import type { TransactionSql } from "postgres"

import type {
  IndustryMutationResult,
  IndustryOperation,
  IndustryState,
} from "@/lib/contracts/location-industry"
import {
  industryMismatches,
  maskedFieldBaseline,
} from "@/lib/domain/readback/industry"
import { isRecord } from "@/lib/domain/readback/compare"
import { getDatabase, jsonColumn, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  googleHealthcareApi,
  googleLodgingApi,
  GoogleMutationAmbiguousError,
} from "@/lib/server/google"
import {
  cacheGbpSnapshot,
  cacheGbpSnapshotAfterWrite,
  gbpManagementAttemptStore,
  gbpManagementIdempotencyKey,
  requireFreshMaskedBaseline,
  resolveGbpLocationContext,
  stableGoogleHash,
  type GbpLocationContext,
} from "@/lib/server/gbp-management"
import { idempotencyKey, runGbpWrite } from "@/lib/server/gbp-write"
import { ApiError } from "@/lib/server/http"
import { requestScopedKeyPart } from "@/lib/server/mutation-operations"
import type { Session } from "@/lib/server/session"

async function context(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    resolveGbpLocationContext(sql, session, locationId)
  )
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

type IndustryResourceType = "lodging" | "healthcare_services"

/**
 * The one resource name each industry resource is cached and recorded
 * under. Load and write must agree: the healthcare snapshot used to be cached
 * as `{account}/{location}/serviceList` on load but `{location}/healthcare_services`
 * after a write, so the write never refreshed the snapshot the load reads.
 */
export function industryResourceName(
  resourceType: IndustryResourceType,
  linked: Pick<GbpLocationContext, "accountName" | "googleLocationName">
): string {
  return resourceType === "lodging"
    ? `${linked.googleLocationName}/lodging`
    : `${linked.accountName}/${linked.googleLocationName}/serviceList`
}

export async function loadIndustryManagement(
  session: Session,
  locationId: string
): Promise<IndustryState> {
  const linked = await context(session, locationId)
  const token = await connectionAccessToken(
    getDatabase(),
    session.organisationId,
    linked.connectionId
  )
  const options = { connectionKey: linked.connectionId }
  // Only APIs Google still serves. Business Calls (retired 2023-05-30) and
  // healthProviderAttributes/insuranceNetworks (retired 2024-07-01) are no
  // longer asked; snapshots cached from them before then are never read and
  // age out with the retention purge.
  const [lodging, lodgingUpdated, healthcareServices] = await Promise.all([
    safe(() =>
      googleLodgingApi(
        token,
        { locationName: linked.googleLocationName, operation: "get" },
        options
      )
    ),
    safe(() =>
      googleLodgingApi(
        token,
        {
          locationName: linked.googleLocationName,
          operation: "getGoogleUpdated",
        },
        options
      )
    ),
    safe(() =>
      googleHealthcareApi(
        token,
        {
          accountName: linked.accountName,
          locationName: linked.googleLocationName,
          resource: "serviceList",
        },
        options
      )
    ),
  ])
  let lodgingHash: string | null = null
  for (const [resourceType, result] of [
    ["lodging", lodging],
    ["healthcare_services", healthcareServices],
  ] as const) {
    if (!result.data) continue
    const hash = await cacheGbpSnapshot({
      organisationId: session.organisationId,
      locationId,
      googleAccountId: linked.googleAccountId,
      resourceType,
      resourceName: industryResourceName(resourceType, linked),
      payload: result.data,
    })
    if (resourceType === "lodging") lodgingHash = hash
  }
  return {
    lodging,
    lodgingUpdated,
    healthcareServices,
    lodgingHash,
    canManage: linked.canPublish,
    writesEnabled: gbpWritesEnabled(getServerEnv(), "profileWrites"),
  }
}

export type { IndustryOperation }

/**
 * A lodging or healthcare serviceList PATCH through the shared pipeline
 * (runGbpWrite over gbp_management_mutation; see business-information.ts
 * runManagementWrite for the key and replay rules). The resource is read
 * again after the write and every updateMask path compared with the payload
 * (lib/domain/readback/industry.ts): a difference settles `failed`
 * (`industry_readback_mismatch`), an unreadable readback `ambiguous`, and a
 * confirmed write `succeeded` with the readback cached. A write that landed
 * is never settled `failed` by anything after it: the snapshot cache runs
 * once the row has settled and only logs its own failure.
 *
 * A lodging update is checked against the baseline the editor loaded over
 * the groups it writes (requireFreshMaskedBaseline). Healthcare serviceList
 * stays freeform and unpinned pending decision D-24.
 */
export async function mutateIndustryManagement(input: {
  session: Session
  locationId: string
  operation: IndustryOperation
  payload: Record<string, unknown>
  updateMask: string[]
  /** Required for update_lodging (the contract enforces it). */
  expectedGoogleHash?: string
  requestId: string
}): Promise<IndustryMutationResult> {
  const linked = await context(input.session, input.locationId)
  if (!linked.canPublish)
    throw new ApiError(
      403,
      "publish_not_allowed",
      "You cannot publish for this location."
    )
  if (!gbpWritesEnabled(getServerEnv(), "profileWrites"))
    throw new ApiError(503, "google_writes_paused", "Google writes are paused.")
  const organisationId = input.session.organisationId
  const token = await connectionAccessToken(
    getDatabase(),
    organisationId,
    linked.connectionId
  )
  const options = { connectionKey: linked.connectionId }
  const lodging = input.operation === "update_lodging"
  const resourceType: IndustryResourceType = lodging
    ? "lodging"
    : "healthcare_services"
  const resourceName = industryResourceName(resourceType, linked)
  const read = () =>
    lodging
      ? googleLodgingApi(
          token,
          { locationName: linked.googleLocationName, operation: "get" },
          options
        )
      : googleHealthcareApi(
          token,
          {
            accountName: linked.accountName,
            locationName: linked.googleLocationName,
            resource: "serviceList",
          },
          options
        )

  if (lodging) {
    if (!input.expectedGoogleHash)
      throw new ApiError(
        400,
        "lodging_baseline_required",
        "Refresh the lodging details before publishing."
      )
    await requireFreshMaskedBaseline({
      organisationId,
      resourceType,
      resourceName,
      expectedGoogleHash: input.expectedGoogleHash,
      current: await read(),
      scope: (resource) =>
        maskedFieldBaseline(
          input.updateMask,
          isRecord(resource) ? resource : {}
        ),
      stale: new ApiError(
        409,
        "lodging_stale",
        "Google changed these lodging details. Refresh before publishing."
      ),
    })
  }

  const result = await runGbpWrite<
    Record<string, unknown>,
    Record<string, unknown>
  >({
    organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: gbpManagementAttemptStore,
    key: gbpManagementIdempotencyKey({
      resourceType,
      operation: input.operation,
      targetResourceName: resourceName,
      requestId: requestScopedKeyPart(input.requestId),
    }),
    intent: {
      location_id: input.locationId,
      google_account_id: linked.googleAccountId,
      resource_type: resourceType,
      operation: input.operation,
      target_resource_name: resourceName,
      expected_google_hash: input.expectedGoogleHash ?? null,
      update_mask: input.updateMask,
      requested_payload: (sql: TransactionSql) =>
        jsonColumn(sql, input.payload),
    },
    onExisting: "replay",
    failureCode: `${input.operation}_failed`,
    operation: {
      surface: "industry",
      action: input.operation,
      locationId: input.locationId,
      targetType: resourceType,
      targetRef: resourceName,
      payloadHash: idempotencyKey([
        input.operation,
        [...input.updateMask].sort().join(","),
        stableGoogleHash(input.payload),
        input.expectedGoogleHash ?? null,
      ]),
      googleConnectionId: linked.connectionId,
    },
    mutate: async () => {
      const response = lodging
        ? await googleLodgingApi(
            token,
            {
              locationName: linked.googleLocationName,
              operation: "patch",
              updateMask: input.updateMask,
              payload: input.payload,
            },
            options
          )
        : await googleHealthcareApi(
            token,
            {
              accountName: linked.accountName,
              locationName: linked.googleLocationName,
              resource: "serviceList",
              method: "PATCH",
              updateMask: input.updateMask,
              payload: input.payload,
            },
            options
          )
      // A 2xx that is not the updated resource may still have written: settle
      // it uncertain instead of reading it back as though it had answered.
      if (!isRecord(response))
        throw new GoogleMutationAmbiguousError(
          "Google did not return the updated resource."
        )
      return response
    },
    // An ambiguous PATCH may still be applying, so it settles `ambiguous`
    // without a readback rather than `failed` on a read taken too early.
    onAmbiguous: "fail",
    readback: {
      read: async () => {
        const readback = await read()
        if (!isRecord(readback))
          throw new GoogleMutationAmbiguousError(
            "Google did not return the resource on readback."
          )
        return readback
      },
      verify: ({ readback }) =>
        industryMismatches(input.updateMask, input.payload, readback).length ===
        0,
      hash: (readback) => stableGoogleHash(readback),
      mismatch: {
        status: 502,
        code: "industry_readback_mismatch",
        message: "Google did not confirm the published industry details.",
      },
    },
    audit: {
      action: `google.${input.operation}`,
      subjectType: "location",
      subjectId: input.locationId,
      metadata: { updateMask: input.updateMask },
    },
  })
  if (result.idempotent)
    return { id: result.attemptId, status: result.rawStatus, idempotent: true }
  await cacheGbpSnapshotAfterWrite({
    organisationId,
    locationId: input.locationId,
    googleAccountId: linked.googleAccountId,
    resourceType,
    resourceName,
    payload: result.readback,
  })
  return {
    id: result.attemptId,
    status: "succeeded",
    response: result.readback,
    idempotent: false,
  }
}
