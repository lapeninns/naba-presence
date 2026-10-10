import "server-only"

import type { TransactionSql } from "postgres"

import type {
  AttributeMetadata,
  BusinessInformationMetadataType,
  BusinessInformationMutationResult,
  BusinessInformationPayload,
  BusinessInformationState,
  GoogleAttribute,
} from "@/lib/contracts/location-business-information"
import { assertBusinessInformationMask } from "@/lib/domain/business-information"
import {
  attributeMismatches,
  maskedAttributeBaseline,
} from "@/lib/domain/readback/attributes"
import { businessInfoMismatches } from "@/lib/domain/readback/business-info"
import { getDatabase, jsonColumn, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  getGoogleLocation,
  getGoogleLocationAttributes,
  listGoogleAttributeMetadata,
  listGoogleCategories,
  patchGoogleLocation,
  patchGoogleLocationAttributes,
  searchGoogleChains,
} from "@/lib/server/google"
import {
  auditGbpMutation,
  cacheGbpSnapshot,
  cacheGbpSnapshotAfterWrite,
  gbpManagementAttemptStore,
  gbpManagementIdempotencyKey,
  loadManagementRecoveryAttempt,
  requireFreshMaskedBaseline,
  resolveGbpLocationContext,
  stableGoogleHash,
  type GbpLocationContext,
  type ManagementRecoveryAttempt,
} from "@/lib/server/gbp-management"
import {
  classifyFailure,
  hasGbpAttempt,
  idempotencyKey,
  providerErrorCode,
  runGbpWrite,
  type GbpWritePhase,
} from "@/lib/server/gbp-write"
import { ApiError } from "@/lib/server/http"
import {
  operationSummary,
  requestScopedKeyPart,
} from "@/lib/server/mutation-operations"
import {
  storeSettle,
  type RecoveryAdapter,
  type RecoveryAttempt,
} from "@/lib/server/mutation-recovery"
import type { Session } from "@/lib/server/session"

const READ_MASK = [
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
] as const

function writesEnabled() {
  return gbpWritesEnabled(getServerEnv(), "profileWrites")
}

const BUSINESS_INFORMATION_PAUSED = {
  status: 503,
  code: "business_information_paused",
  message: "Google Business Information writes are paused.",
}

async function loadedContext(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    resolveGbpLocationContext(sql, session, locationId)
  )
}

export async function loadBusinessInformation(
  session: Session,
  locationId: string
): Promise<BusinessInformationState> {
  const linked = await loadedContext(session, locationId)
  const token = await connectionAccessToken(
    getDatabase(),
    session.organisationId,
    linked.connectionId
  )
  const [location, attributes, metadata] = await Promise.all([
    getGoogleLocation(token, linked.googleLocationName, [...READ_MASK], {
      connectionKey: linked.connectionId,
    }),
    getGoogleLocationAttributes(token, linked.googleLocationName, {
      connectionKey: linked.connectionId,
    }),
    listGoogleAttributeMetadata(
      token,
      { locationName: linked.googleLocationName },
      { connectionKey: linked.connectionId }
    ),
  ])
  const [locationHash, attributesHash] = await Promise.all([
    cacheGbpSnapshot({
      organisationId: session.organisationId,
      locationId,
      googleAccountId: linked.googleAccountId,
      resourceType: "business_info",
      resourceName: linked.googleLocationName,
      payload: location,
    }),
    cacheGbpSnapshot({
      organisationId: session.organisationId,
      locationId,
      googleAccountId: linked.googleAccountId,
      resourceType: "attributes",
      resourceName: `${linked.googleLocationName}/attributes`,
      payload: attributes,
    }),
  ])
  return {
    location,
    attributes,
    // The Google client types metadata rows as passthrough records; the wire
    // contract pins the `parent` id every row carries (the client parses it).
    attributeMetadata: (metadata.attributeMetadata ??
      []) as AttributeMetadata[],
    locationHash,
    attributesHash,
    canPublish: linked.canPublish,
    writesEnabled: writesEnabled(),
  }
}

type ManagementWrite<TResponse> = {
  session: Session
  linked: GbpLocationContext
  locationId: string
  requestId: string
  resourceType: "business_info" | "attributes"
  action: string
  targetResourceName: string
  expectedGoogleHash: string
  updateMask: string[]
  payload: unknown
  failureCode: string
  /**
   * The staleness check against the editor's baseline. Skipped when the key
   * already has a row, so a retry of the same intent replays it.
   */
  requireFresh: () => Promise<void>
  validate?: () => Promise<unknown>
  mutate: () => Promise<TResponse>
  read: () => Promise<Record<string, unknown>>
  /** The masked fields the readback does not confirm (empty: confirmed). */
  mismatches: (readback: Record<string, unknown>) => string[]
  mismatch: { code: string; message: string }
  audit: {
    action: string
    unconfirmedAction: string
    metadata: Record<string, unknown>
  }
}

/**
 * One Business Information or attributes PATCH through the shared pipeline
 * (runGbpWrite over gbp_management_mutation). The key carries the client's
 * intent (the Idempotency-Key header) or, without one, the request id, so a
 * retry of the same intent replays its row instead of patching again; any
 * existing row for the key is answered as idempotent ("replay"). The
 * staleness check runs only when the key has no row yet: after a write that
 * landed, the live resource is the write's own change and no longer matches
 * the baseline the retry carries.
 *
 * The readback is the live resource read again after the write and compared
 * over the mask only (lib/domain/readback/*): a confirmed difference settles
 * `failed`, a readback that cannot be read settles `ambiguous` (classifyFailure
 * `readback_read`), and a confirmed write settles `succeeded` with the
 * readback stored on the row and cached as the snapshot. An ambiguous
 * provider call settles `ambiguous` without a readback ("fail"): a PATCH that
 * timed out may still be applying, so a readback taken now cannot prove it
 * did not land.
 */
async function runManagementWrite<TResponse>(
  input: ManagementWrite<TResponse>
): Promise<BusinessInformationMutationResult> {
  const organisationId = input.session.organisationId
  let phase: GbpWritePhase | null = null
  let attemptId: string | null = null
  const key = gbpManagementIdempotencyKey({
    resourceType: input.resourceType,
    operation: "patch",
    targetResourceName: input.targetResourceName,
    requestId: requestScopedKeyPart(input.requestId),
  })
  if (
    !(await hasGbpAttempt(gbpManagementAttemptStore, { organisationId, key }))
  ) {
    await input.requireFresh()
  }
  try {
    const result = await runGbpWrite<TResponse, Record<string, unknown>>({
      surface: "profileWrites",
      paused: BUSINESS_INFORMATION_PAUSED,
      organisationId,
      actorUserId: input.session.userId,
      requestId: input.requestId,
      store: gbpManagementAttemptStore,
      key,
      intent: {
        location_id: input.locationId,
        google_account_id: input.linked.googleAccountId,
        resource_type: input.resourceType,
        operation: "patch",
        target_resource_name: input.targetResourceName,
        expected_google_hash: input.expectedGoogleHash,
        update_mask: input.updateMask,
        requested_payload: (sql: TransactionSql) =>
          jsonColumn(sql, input.payload),
      },
      onExisting: "replay",
      failureCode: input.failureCode,
      operation: {
        surface: "business_information",
        action: input.action,
        locationId: input.locationId,
        targetType: input.resourceType,
        targetRef: input.targetResourceName,
        payloadHash: idempotencyKey([
          input.action,
          [...input.updateMask].sort().join(","),
          stableGoogleHash(input.payload),
          input.expectedGoogleHash,
        ]),
        googleConnectionId: input.linked.connectionId,
      },
      validate: input.validate
        ? async (ctx) => {
            phase = "validate"
            attemptId = ctx.attemptId
            return input.validate?.()
          }
        : undefined,
      mutate: async (ctx) => {
        phase = "mutate"
        attemptId = ctx.attemptId
        return input.mutate()
      },
      onAmbiguous: "fail",
      readback: {
        read: async () => {
          phase = "readback_read"
          const readback = await input.read()
          // The read completed, so the provider state is known again: from
          // here a disagreement is a definite failure, not an ambiguity.
          phase = "readback_verify"
          return readback
        },
        verify: ({ readback }) => input.mismatches(readback).length === 0,
        hash: (readback) => stableGoogleHash(readback),
        mismatch: { status: 502, ...input.mismatch },
      },
      audit: {
        action: input.audit.action,
        subjectType: "location",
        subjectId: input.locationId,
        metadata: input.audit.metadata,
      },
    })
    if (result.idempotent) {
      return {
        id: result.attemptId,
        status: result.rawStatus,
        idempotent: true,
        operation: operationSummary(result),
      }
    }
    await cacheGbpSnapshotAfterWrite({
      organisationId,
      locationId: input.locationId,
      googleAccountId: input.linked.googleAccountId,
      resourceType: input.resourceType,
      resourceName: input.targetResourceName,
      payload: result.readback,
    })
    return {
      id: result.attemptId,
      status: "succeeded",
      idempotent: false,
      operation: operationSummary(result),
    }
  } catch (error) {
    // An ambiguous outcome otherwise leaves no audit evidence at all: the
    // success audit never runs, so an operator reconciling the mutation table
    // against Google cannot tell a write that may have landed from one that
    // never left. runGbpWrite settled the row with this same classification.
    if (phase && attemptId && classifyFailure(phase, error) === "ambiguous") {
      await auditGbpMutation({
        organisationId,
        session: input.session,
        action: input.audit.unconfirmedAction,
        subjectType: "location",
        subjectId: input.locationId,
        requestId: input.requestId,
        metadata: {
          ...input.audit.metadata,
          mutationId: attemptId,
          phase,
          errorCode: providerErrorCode(error, input.failureCode),
        },
      })
    }
    throw error
  }
}

export async function updateBusinessInformation(input: {
  session: Session
  locationId: string
  payload: BusinessInformationPayload
  updateMask: string[]
  expectedGoogleHash: string
  requestId: string
}): Promise<BusinessInformationMutationResult> {
  const linked = await loadedContext(input.session, input.locationId)
  if (!linked.canPublish) {
    throw new ApiError(
      403,
      "publish_not_allowed",
      "You cannot publish for this location."
    )
  }
  if (!writesEnabled()) {
    throw new ApiError(
      BUSINESS_INFORMATION_PAUSED.status,
      BUSINESS_INFORMATION_PAUSED.code,
      BUSINESS_INFORMATION_PAUSED.message
    )
  }
  assertBusinessInformationMask(input.payload, input.updateMask)
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
  const options = { connectionKey: linked.connectionId }
  const read = () =>
    getGoogleLocation(token, linked.googleLocationName, [...READ_MASK], options)
  const patch = (validateOnly: boolean) =>
    patchGoogleLocation(
      token,
      {
        locationName: linked.googleLocationName,
        updateMask: input.updateMask,
        validateOnly,
        payload: input.payload,
      },
      options
    )
  return runManagementWrite({
    session: input.session,
    linked,
    locationId: input.locationId,
    requestId: input.requestId,
    resourceType: "business_info",
    action: "update_location",
    targetResourceName: linked.googleLocationName,
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.updateMask,
    payload: input.payload,
    failureCode: "business_information_update_failed",
    requireFresh: async () => {
      if (stableGoogleHash(await read()) !== input.expectedGoogleHash) {
        throw new ApiError(
          409,
          "business_information_stale",
          "Google changed this location. Refresh before publishing."
        )
      }
    },
    validate: () => patch(true),
    mutate: () => patch(false),
    read,
    mismatches: (readback) =>
      businessInfoMismatches(input.updateMask, readback, input.payload),
    mismatch: {
      code: "business_information_readback_mismatch",
      message: "Google did not confirm the approved values.",
    },
    audit: {
      action: "business_information.updated",
      unconfirmedAction: "business_information.update.unconfirmed",
      metadata: { updateMask: input.updateMask },
    },
  })
}

/**
 * The masked attributes of an Attributes resource, normalised, hashed: the
 * field-scoped baseline an attribute write is checked against, so a Google
 * change to an attribute the write does not touch does not make it stale.
 */
export function attributeBaselineHash(
  attributeMask: readonly string[],
  current: unknown
): string {
  return stableGoogleHash(maskedAttributeBaseline(attributeMask, current))
}

export async function updateBusinessAttributes(input: {
  session: Session
  locationId: string
  attributes: GoogleAttribute[]
  attributeMask: string[]
  expectedGoogleHash: string
  requestId: string
}): Promise<BusinessInformationMutationResult> {
  const linked = await loadedContext(input.session, input.locationId)
  if (!linked.canPublish)
    throw new ApiError(
      403,
      "publish_not_allowed",
      "You cannot publish for this location."
    )
  if (!writesEnabled())
    throw new ApiError(
      BUSINESS_INFORMATION_PAUSED.status,
      BUSINESS_INFORMATION_PAUSED.code,
      BUSINESS_INFORMATION_PAUSED.message
    )
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
  const options = { connectionKey: linked.connectionId }
  const resourceName = `${linked.googleLocationName}/attributes`
  const read = () =>
    getGoogleLocationAttributes(token, linked.googleLocationName, options)
  return runManagementWrite({
    session: input.session,
    linked,
    locationId: input.locationId,
    requestId: input.requestId,
    resourceType: "attributes",
    action: "update_attributes",
    targetResourceName: resourceName,
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.attributeMask,
    payload: input.attributes,
    failureCode: "attributes_update_failed",
    requireFresh: async () =>
      requireFreshMaskedBaseline({
        organisationId: input.session.organisationId,
        resourceType: "attributes",
        resourceName,
        expectedGoogleHash: input.expectedGoogleHash,
        current: await read(),
        scope: (resource) =>
          maskedAttributeBaseline(input.attributeMask, resource),
        stale: new ApiError(
          409,
          "attributes_stale",
          "Google attributes changed. Refresh before publishing."
        ),
      }),
    // Attributes have no validateOnly call, so the write is the first phase.
    mutate: () =>
      patchGoogleLocationAttributes(
        token,
        {
          locationName: linked.googleLocationName,
          attributeMask: input.attributeMask,
          attributes: input.attributes,
        },
        options
      ),
    read,
    mismatches: (readback) =>
      attributeMismatches(input.attributeMask, input.attributes, readback),
    mismatch: {
      code: "business_attributes_readback_mismatch",
      message: "Google did not confirm the approved attribute values.",
    },
    audit: {
      action: "business_attributes.updated",
      unconfirmedAction: "business_attributes.update.unconfirmed",
      metadata: { attributeMask: input.attributeMask },
    },
  })
}

export async function searchBusinessInformationMetadata(input: {
  session: Session
  locationId: string
  type: BusinessInformationMetadataType
  query: string
  regionCode: string
  languageCode: string
}) {
  const linked = await loadedContext(input.session, input.locationId)
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
  return input.type === "categories"
    ? listGoogleCategories(
        token,
        {
          regionCode: input.regionCode,
          languageCode: input.languageCode,
          query: input.query,
        },
        { connectionKey: linked.connectionId }
      )
    : searchGoogleChains(token, input.query, {
        connectionKey: linked.connectionId,
      })
}

// ---------------------------------------------------------------------------
// Recovery (lib/server/mutation-recovery.ts)
// ---------------------------------------------------------------------------

/**
 * Reads an uncertain Business Information or attributes PATCH back with the
 * same masked comparison its own readback uses (lib/domain/readback/*),
 * against the payload the row recorded before dispatch. Read only once the
 * first recovery delay has passed, by which time a PATCH that timed out has
 * had time to apply.
 */
export const businessInformationRecoveryAdapter: RecoveryAdapter<
  ManagementRecoveryAttempt & RecoveryAttempt
> = {
  surface: "business_information",
  attemptTable: "gbp_management_mutation",
  load: loadManagementRecoveryAttempt,
  async readback({ attempt, link }) {
    const options = { connectionKey: link.googleConnectionId }
    const token = await link.accessToken()
    if (attempt.resourceType === "business_info") {
      if (attempt.targetResourceName !== link.googleLocationName) {
        return { kind: "unverifiable", errorCode: "target_changed" }
      }
      const readback = await getGoogleLocation(
        token,
        link.googleLocationName,
        [...READ_MASK],
        options
      )
      return businessInfoMismatches(
        attempt.updateMask,
        readback,
        attempt.requestedPayload as BusinessInformationPayload
      ).length === 0
        ? {
            kind: "landed",
            confirmed: true,
            response: readback,
            responseHash: stableGoogleHash(readback),
          }
        : {
            kind: "not_landed",
            errorCode: "business_information_readback_mismatch",
          }
    }
    if (attempt.resourceType === "attributes") {
      if (
        attempt.targetResourceName !== `${link.googleLocationName}/attributes`
      ) {
        return { kind: "unverifiable", errorCode: "target_changed" }
      }
      const readback = await getGoogleLocationAttributes(
        token,
        link.googleLocationName,
        options
      )
      return attributeMismatches(
        attempt.updateMask,
        attempt.requestedPayload as GoogleAttribute[],
        readback
      ).length === 0
        ? {
            kind: "landed",
            confirmed: true,
            response: readback,
            responseHash: stableGoogleHash(readback),
          }
        : {
            kind: "not_landed",
            errorCode: "business_attributes_readback_mismatch",
          }
    }
    return { kind: "unverifiable", errorCode: "recovery_unsupported" }
  },
  settle: storeSettle(gbpManagementAttemptStore),
}
