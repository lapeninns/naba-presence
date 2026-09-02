import "server-only"

import { z } from "zod"

import {
  assertBusinessInformationMask,
  businessInformationPayloadSchema,
  googleAttributeSchema,
} from "@/lib/domain/business-information"
import { getDatabase, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  getGoogleLocation,
  getGoogleLocationAttributes,
  GoogleMutationAmbiguousError,
  listGoogleAttributeMetadata,
  listGoogleCategories,
  patchGoogleLocation,
  patchGoogleLocationAttributes,
  searchGoogleChains,
} from "@/lib/server/google"
import {
  auditGbpMutation,
  cacheGbpSnapshot,
  resolveGbpLocationContext,
  settleGbpMutation,
  stableGoogleHash,
  startGbpMutation,
} from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
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

function errorCode(error: unknown, fallback: string) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : fallback
}

function containsExpected(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => containsExpected(actual[index], item))
    )
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      return false
    }
    return Object.entries(expected as Record<string, unknown>).every(
      ([key, value]) =>
        containsExpected((actual as Record<string, unknown>)[key], value)
    )
  }
  return actual === expected
}

async function loadedContext(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    resolveGbpLocationContext(sql, session, locationId)
  )
}

export async function loadBusinessInformation(
  session: Session,
  locationId: string
) {
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
    attributeMetadata: metadata.attributeMetadata ?? [],
    locationHash,
    attributesHash,
    canPublish: linked.canPublish,
    writesEnabled: writesEnabled(),
  }
}

export async function updateBusinessInformation(input: {
  session: Session
  locationId: string
  payload: z.infer<typeof businessInformationPayloadSchema>
  updateMask: string[]
  expectedGoogleHash: string
  requestId: string
}) {
  const linked = await loadedContext(input.session, input.locationId)
  if (!linked.canPublish) {
    throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
  }
  if (!writesEnabled()) {
    throw new ApiError(503, "business_information_paused", "Google Business Information writes are paused.")
  }
  assertBusinessInformationMask(input.payload, input.updateMask)
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
  const current = await getGoogleLocation(
    token,
    linked.googleLocationName,
    [...READ_MASK],
    { connectionKey: linked.connectionId }
  )
  if (stableGoogleHash(current) !== input.expectedGoogleHash) {
    throw new ApiError(409, "business_information_stale", "Google changed this location. Refresh before publishing.")
  }
  const attempt = await startGbpMutation({
    organisationId: input.session.organisationId,
    session: input.session,
    locationId: input.locationId,
    googleAccountId: linked.googleAccountId,
    resourceType: "business_info",
    operation: "patch",
    targetResourceName: linked.googleLocationName,
    requestId: input.requestId,
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.updateMask,
    payload: input.payload,
  })
  if (attempt.idempotent) return attempt
  try {
    await patchGoogleLocation(
      token,
      {
        locationName: linked.googleLocationName,
        updateMask: input.updateMask,
        validateOnly: true,
        payload: input.payload,
      },
      { connectionKey: linked.connectionId }
    )
    await settleGbpMutation({
      organisationId: input.session.organisationId,
      mutationId: attempt.id,
      status: "validated",
    })
    await patchGoogleLocation(
      token,
      {
        locationName: linked.googleLocationName,
        updateMask: input.updateMask,
        validateOnly: false,
        payload: input.payload,
      },
      { connectionKey: linked.connectionId }
    )
    const readback = await getGoogleLocation(
      token,
      linked.googleLocationName,
      [...READ_MASK],
      { connectionKey: linked.connectionId }
    )
    for (const field of input.updateMask) {
      if (!containsExpected(readback[field], input.payload[field as keyof typeof input.payload])) {
        throw new ApiError(502, "business_information_readback_mismatch", `Google did not confirm the approved ${field} value.`)
      }
    }
    await cacheGbpSnapshot({
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      googleAccountId: linked.googleAccountId,
      resourceType: "business_info",
      resourceName: linked.googleLocationName,
      payload: readback,
    })
    await settleGbpMutation({
      organisationId: input.session.organisationId,
      mutationId: attempt.id,
      status: "succeeded",
      response: readback,
    })
    await auditGbpMutation({
      organisationId: input.session.organisationId,
      session: input.session,
      action: "business_information.updated",
      subjectType: "location",
      subjectId: input.locationId,
      requestId: input.requestId,
      metadata: { updateMask: input.updateMask },
    })
    return { id: attempt.id, status: "succeeded", idempotent: false }
  } catch (error) {
    await settleGbpMutation({
      organisationId: input.session.organisationId,
      mutationId: attempt.id,
      status: error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed",
      errorCode: errorCode(error, "business_information_update_failed"),
    })
    throw error
  }
}

export async function updateBusinessAttributes(input: {
  session: Session
  locationId: string
  attributes: Array<z.infer<typeof googleAttributeSchema>>
  attributeMask: string[]
  expectedGoogleHash: string
  requestId: string
}) {
  const linked = await loadedContext(input.session, input.locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
  if (!writesEnabled()) throw new ApiError(503, "business_information_paused", "Google Business Information writes are paused.")
  const token = await connectionAccessToken(getDatabase(), input.session.organisationId, linked.connectionId)
  const current = await getGoogleLocationAttributes(token, linked.googleLocationName, { connectionKey: linked.connectionId })
  if (stableGoogleHash(current) !== input.expectedGoogleHash) throw new ApiError(409, "attributes_stale", "Google attributes changed. Refresh before publishing.")
  const attempt = await startGbpMutation({
    organisationId: input.session.organisationId,
    session: input.session,
    locationId: input.locationId,
    googleAccountId: linked.googleAccountId,
    resourceType: "attributes",
    operation: "patch",
    targetResourceName: `${linked.googleLocationName}/attributes`,
    requestId: input.requestId,
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.attributeMask,
    payload: input.attributes,
  })
  if (attempt.idempotent) return attempt
  try {
    await patchGoogleLocationAttributes(token, { locationName: linked.googleLocationName, attributeMask: input.attributeMask, attributes: input.attributes }, { connectionKey: linked.connectionId })
    const readback = await getGoogleLocationAttributes(token, linked.googleLocationName, { connectionKey: linked.connectionId })
    await cacheGbpSnapshot({ organisationId: input.session.organisationId, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType: "attributes", resourceName: `${linked.googleLocationName}/attributes`, payload: readback })
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: "succeeded", response: readback })
    await auditGbpMutation({ organisationId: input.session.organisationId, session: input.session, action: "business_attributes.updated", subjectType: "location", subjectId: input.locationId, requestId: input.requestId, metadata: { attributeMask: input.attributeMask } })
    return { id: attempt.id, status: "succeeded", idempotent: false }
  } catch (error) {
    await settleGbpMutation({ organisationId: input.session.organisationId, mutationId: attempt.id, status: error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed", errorCode: errorCode(error, "attributes_update_failed") })
    throw error
  }
}

export async function searchBusinessInformationMetadata(input: {
  session: Session
  locationId: string
  type: "categories" | "chains"
  query: string
  regionCode: string
  languageCode: string
}) {
  const linked = await loadedContext(input.session, input.locationId)
  const token = await connectionAccessToken(getDatabase(), input.session.organisationId, linked.connectionId)
  return input.type === "categories"
    ? listGoogleCategories(token, { regionCode: input.regionCode, languageCode: input.languageCode, query: input.query }, { connectionKey: linked.connectionId })
    : searchGoogleChains(token, input.query, { connectionKey: linked.connectionId })
}
