import "server-only"
import { z } from "zod"
import { businessInformationPayloadSchema } from "@/lib/contracts/location-business-information"
import { executeAndConfirmGbpMutation, observeAndConfirmGbpMutation } from "./gbp-confirmation"
import { googleServiceItemsSchema, serviceItemsMatch, unsupportedServiceIndexes } from "@/lib/domain/google-services"
import { loadGoogleServiceMetadata } from "./service-metadata"
import { googleAttributesMatch, unsupportedAttributeNames } from "@/lib/domain/google-attributes"
import { loadGoogleAttributeMetadata } from "./attribute-metadata"
import { emptyStorefrontAddress, serviceAreasMatch, serviceAreaTransitionError } from "@/lib/domain/google-service-area"
import { relationshipsMatch, unsupportedRelationshipBaseline } from "@/lib/domain/google-relationships"
import { advertisingBaselineSupported, advertisingMatches } from "@/lib/domain/google-advertising"
import { unsupportedAddressDetails } from "@/lib/domain/business-information"

import type {
  BusinessInformationMetadataType,
  BusinessInformationMutationResult,
  BusinessInformationPayload,
  BusinessInformationState,
  GoogleAttribute,
} from "@/lib/contracts/location-business-information"
import { additionalPhonesMatch, addressFieldMatches, assertBusinessInformationMask, assertCompletePhoneNumbers, googleAttributeSchema, openingDatesMatch } from "@/lib/domain/business-information"
import { GOOGLE_LOCATION_FIELDS, locationFieldCapabilities, metadataEligibility } from "@/lib/domain/google-capabilities"
import { getDatabase, withSessionConnection, withTenant } from "@/lib/server/db"
import { approvedGbpChange, listGbpChangeSets, saveGbpChangeSet } from "./gbp-change-sets"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  getGoogleLocation,
  getGoogleLocationAttributes,
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
import { classifyFailure, type GbpWritePhase } from "@/lib/server/gbp-write"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const READ_MASK = [
  "name",
  "title",
  "phoneNumbers",
  "adWordsLocationExtensions",
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
    loadGoogleAttributeMetadata(token, linked.googleLocationName, linked.connectionId),
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
    attributeMetadata: metadata,
    locationHash,
    attributesHash,
    canPublish: linked.canPublish,
    writesEnabled: writesEnabled(),
    capabilityDetails: locationFieldCapabilities({
      location,
      canPublish: linked.canPublish,
      writesEnabled: writesEnabled(),
      observedAt: new Date().toISOString(),
    }),
  }
}

export async function loadLocationServiceMetadata(session: Session, locationId: string) {
  const linked = await loadedContext(session, locationId)
  const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
  const location = await getGoogleLocation(token, linked.googleLocationName, [...READ_MASK], { connectionKey: linked.connectionId })
  const eligibility = metadataEligibility(location, GOOGLE_LOCATION_FIELDS.serviceItems.metadataFlag)
  if (eligibility !== "eligible") {
    throw new ApiError(409, eligibility === "ineligible" ? "location_ineligible" : "eligibility_unknown",
      eligibility === "ineligible" ? "Google does not allow service editing for this listing." : "Google has not confirmed service editing for this listing.")
  }
  return { ...await loadGoogleServiceMetadata(token, location, linked.connectionId), locationHash: stableGoogleHash(location) }
}

export async function loadBusinessInformationReviews(session: Session, locationId: string) {
  const linked = await loadedContext(session, locationId)
  if (!linked.canPublish || (session.role !== "owner" && session.role !== "admin")) throw new ApiError(403, "publish_not_allowed", "You cannot review changes for this location.")
  return listGbpChangeSets(session, linked, "business_info")
}

type BusinessInformationWrite = {
  session: Session
  locationId: string
  payload: BusinessInformationPayload
  updateMask: string[]
  expectedGoogleHash: string
  requestId: string
  changeSetId?: string
}

export async function previewBusinessInformation(input: Omit<BusinessInformationWrite, "changeSetId">) {
  const linked = await loadedContext(input.session, input.locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot review changes for this location.")
  assertBusinessInformationMask(input.payload, input.updateMask)
  assertCompletePhoneNumbers(input.payload, input.updateMask)
  const token = await linked.accessToken()
  const current = await getGoogleLocation(token, linked.googleLocationName, [...READ_MASK], { connectionKey: linked.connectionId })
  if (stableGoogleHash(current) !== input.expectedGoogleHash) throw new ApiError(409, "business_information_stale", "Google changed this location. Refresh before reviewing.")
  await validateServiceChange(input, current, token, linked.connectionId)
  return saveGbpChangeSet({ session: input.session, linked, resourceType: "business_info", baseline: current, payload: input.payload, updateMask: [...new Set(input.updateMask)].sort(), requestId: input.requestId })
}

export async function updateBusinessInformation(input: BusinessInformationWrite): Promise<BusinessInformationMutationResult> {
  if (input.updateMask.includes("serviceItems") && !input.changeSetId) throw new ApiError(409, "service_review_required", "Review and approve these exact service changes before sending them to Google.")
  if (!input.changeSetId) return executeBusinessInformation(input)
  const changeSetId = input.changeSetId
  return withSessionConnection((connection) => connection.begin(async (lock) => {
    await lock`select pg_advisory_xact_lock(hashtextextended(${`${input.session.organisationId}:${input.locationId}:business_info`}, 0))`
    const linked = await loadedContext(input.session, input.locationId)
    if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
    const reviewed = await approvedGbpChange({ session: input.session, linked, changeSetId, payload: input.payload, updateMask: input.updateMask, resourceType: "business_info" })
    if (reviewed.baseline_hash !== input.expectedGoogleHash) throw new ApiError(409, "approval_stale", "The baseline changed after review.")
    const [existing] = await withTenant(input.session.organisationId, (sql) => sql<BusinessInformationMutationResult[]>`select id, status, execution_state as "executionState", confirmation_state as "confirmationState" from gbp_management_mutation where change_set_id = ${changeSetId}`)
    if (existing) return { ...existing, idempotent: true }
    return executeBusinessInformation(input)
  }))
}

export async function confirmBusinessInformation(session: Session, locationId: string, mutationId: string, requestId: string): Promise<BusinessInformationMutationResult> {
  return withSessionConnection((connection) => connection.begin(async (sql) => {
    await sql`select set_config('app.organisation_id', ${session.organisationId}, true)`
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${locationId}:business_info`}, 0))`
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${locationId}:attributes`}, 0))`
    const linked = await loadedContext(session, locationId)
    if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot manage this location.")
    const [attempt] = await sql<{ resource_type: "business_info" | "attributes"; status: string; execution_state: string; confirmation_state: string; requested_payload: unknown; google_response: unknown; update_mask: string[]; target_resource_name: string | null; google_account_id: string | null; recovery_ready: boolean }[]>`
      select resource_type, status, execution_state, confirmation_state, requested_payload, google_response, update_mask, target_resource_name, google_account_id,
        (status = 'ambiguous' or (status in ('started', 'validated') and created_at < now() - interval '5 minutes')) as recovery_ready
      from gbp_management_mutation where id = ${mutationId} and location_id = ${locationId} and ((resource_type = 'business_info' and change_set_id is not null) or resource_type = 'attributes')
    `
    if (!attempt) throw new ApiError(404, "mutation_not_found", "The profile change was not found.")
    const attributes = attempt.resource_type === "attributes" ? z.array(googleAttributeSchema).parse(attempt.requested_payload) : null
    const resourceName = attributes !== null ? `${linked.googleLocationName}/attributes` : linked.googleLocationName
    if (attempt.target_resource_name !== resourceName || attempt.google_account_id !== linked.googleAccountId) throw new ApiError(409, "google_target_changed", "This location is linked to a different Google target. The earlier change cannot be confirmed here.")
    if (attempt.status === "succeeded" && attempt.confirmation_state === "confirmed") return { id: mutationId, status: "succeeded", idempotent: true, confirmationState: "confirmed" }
    if (!attempt.recovery_ready) throw new ApiError(409, "mutation_not_ready", "This change cannot be checked yet. An interrupted request can be checked after five minutes.")
    const payload = attributes !== null ? {} : businessInformationPayloadSchema.parse(attempt.requested_payload)
    if (attributes === null) assertBusinessInformationMask(payload, attempt.update_mask)
    const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
    const result = await observeAndConfirmGbpMutation({
      organisationId: session.organisationId, mutationId, payload: attributes !== null ? { attributes } : payload, updateMask: attempt.update_mask,
      executionState: attempt.execution_state === "accepted" ? "accepted" : "unknown",
      response: attempt.google_response == null ? undefined : z.record(z.string(), z.unknown()).parse(attempt.google_response),
      matches: (observed) => attributes !== null ? googleAttributesMatch(observed, attributes, attempt.update_mask) : businessInformationMatches(payload, observed, attempt.update_mask),
      observe: () => attributes !== null ? getGoogleLocationAttributes(token, linked.googleLocationName, { connectionKey: linked.connectionId }) : getGoogleLocation(token, linked.googleLocationName, [...READ_MASK], { connectionKey: linked.connectionId }),
      onObserved: (response) => cacheGbpSnapshot({ organisationId: session.organisationId, locationId, googleAccountId: linked.googleAccountId, resourceType: attempt.resource_type, resourceName, payload: response }),
    })
    await auditGbpMutation({ organisationId: session.organisationId, session, action: attributes !== null ? "business_attributes.confirmed_check" : "business_information.confirmed_check", subjectType: "location", subjectId: locationId, requestId, metadata: { mutationId, executionState: result.executionState, confirmationState: result.confirmationState } })
    return result
  }))
}

function businessInformationMatches(payload: BusinessInformationPayload, observed: Record<string, unknown>, updateMask: readonly string[]) {
  return updateMask.length > 0 && updateMask.every((field) => field === "serviceItems"
    ? serviceItemsMatch(observed.serviceItems, payload.serviceItems ?? [])
    : field === "adWordsLocationExtensions"
      ? advertisingMatches(observed.adWordsLocationExtensions, payload.adWordsLocationExtensions)
    : field === "relationshipData" || field.startsWith("relationshipData.")
      ? payload.relationshipData !== undefined && relationshipsMatch(observed.relationshipData, payload.relationshipData, field)
    : field === "serviceArea"
      ? payload.serviceArea !== undefined && serviceAreasMatch(observed.serviceArea, payload.serviceArea)
    : field === "storefrontAddress" && payload.storefrontAddress !== undefined && emptyStorefrontAddress(payload.storefrontAddress)
      ? emptyStorefrontAddress(observed.storefrontAddress)
    : field.startsWith("storefrontAddress.")
      ? addressFieldMatches(observed.storefrontAddress, payload.storefrontAddress, field.slice("storefrontAddress.".length))
    : field === "phoneNumbers"
      ? containsExpected(observed.phoneNumbers, { primaryPhone: payload.phoneNumbers?.primaryPhone }) && additionalPhonesMatch(observed.phoneNumbers && typeof observed.phoneNumbers === "object" && "additionalPhones" in observed.phoneNumbers ? observed.phoneNumbers.additionalPhones : undefined, payload.phoneNumbers?.additionalPhones ?? [])
    : field === "openInfo.status"
      ? containsExpected(observed.openInfo, { status: payload.openInfo?.status })
    : field === "openInfo.openingDate"
      ? openingDatesMatch(observed.openInfo && typeof observed.openInfo === "object" && "openingDate" in observed.openInfo ? observed.openInfo.openingDate : undefined, payload.openInfo?.openingDate)
    : containsExpected(observed[field], payload[field as keyof typeof payload]))
}

async function executeBusinessInformation(input: BusinessInformationWrite): Promise<BusinessInformationMutationResult> {
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
      503,
      "business_information_paused",
      "Google Business Information writes are paused."
    )
  }
  assertBusinessInformationMask(input.payload, input.updateMask)
  assertCompletePhoneNumbers(input.payload, input.updateMask)
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
    throw new ApiError(
      409,
      "business_information_stale",
      "Google changed this location. Refresh before publishing."
    )
  }
  await validateServiceChange(input, current, token, linked.connectionId)
  if (!input.changeSetId) throw new ApiError(409, "approval_required", "Review and approve the exact profile change before publishing.")
  if (input.changeSetId) await approvedGbpChange({ session: input.session, linked: await loadedContext(input.session, input.locationId), changeSetId: input.changeSetId, payload: input.payload, updateMask: input.updateMask, resourceType: "business_info" })
  const attempt = await startGbpMutation({
    organisationId: input.session.organisationId,
    session: input.session,
    locationId: input.locationId,
    googleAccountId: linked.googleAccountId,
    resourceType: "business_info",
    operation: "patch",
    targetResourceName: linked.googleLocationName,
    requestId: input.changeSetId ?? input.requestId,
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.updateMask,
    payload: input.payload,
    changeSetId: input.changeSetId,
    blockUnresolved: Boolean(input.changeSetId),
    lockHeld: Boolean(input.changeSetId),
  })
  if (attempt.idempotent) return attempt
  return publishBusinessInformationAttempt(input, linked, token, attempt.id)
}

async function validateServiceChange(input: Pick<BusinessInformationWrite, "payload" | "updateMask">, current: Record<string, unknown>, token: string, connectionKey: string) {
  if (unsupportedAddressDetails(current.storefrontAddress, input.updateMask)) throw new ApiError(409, "address_baseline_unsupported", "The selected address details cannot be replaced safely. Manage them in Google, then refresh.")
  if (input.updateMask.includes("adWordsLocationExtensions") && !advertisingBaselineSupported(current.adWordsLocationExtensions)) throw new ApiError(409, "advertising_baseline_unsupported", "Existing advertising data cannot be replaced safely. Manage it in Google, then refresh.")
  if (unsupportedRelationshipBaseline(current.relationshipData, input.updateMask)) throw new ApiError(409, "relationship_baseline_unsupported", "Existing relationship data cannot be replaced safely. Change individual supported relationships or manage them in Google.")
  const transitionError = serviceAreaTransitionError(current, input.payload, input.updateMask)
  if (transitionError) throw new ApiError(400, "service_area_invalid", transitionError)
  if (input.updateMask.includes("serviceItems")) {
    const eligibility = metadataEligibility(current, GOOGLE_LOCATION_FIELDS.serviceItems.metadataFlag)
    if (eligibility !== "eligible") {
      throw new ApiError(409,
        eligibility === "ineligible" ? "location_ineligible" : "eligibility_unknown",
        eligibility === "ineligible"
          ? "Google does not allow service editing for this location."
          : "Google has not confirmed service-editing eligibility. Refresh the profile before publishing services."
      )
    }
    const items = googleServiceItemsSchema.parse(input.payload.serviceItems)
    if (items.length > 0) {
      const existing = googleServiceItemsSchema.safeParse(current.serviceItems ?? [])
      if (!existing.success) throw new ApiError(409, "service_baseline_unsupported", "Existing services contain fields this editor cannot preserve. Refresh or manage them in Google.")
      const categoriesChanged = input.updateMask.includes("categories")
      const metadata = await loadGoogleServiceMetadata(token, categoriesChanged ? { ...current, categories: input.payload.categories } : current, connectionKey)
      const invalid = unsupportedServiceIndexes(items, categoriesChanged ? [] : existing.data, metadata.categories)
      if (invalid.length) throw new ApiError(409, "service_not_supported", "One or more changed services are not supported by the selected categories.")
    }
  }
}

async function publishBusinessInformationAttempt(input: BusinessInformationWrite, linked: Awaited<ReturnType<typeof loadedContext>>, token: string, mutationId: string): Promise<BusinessInformationMutationResult> {
  const attempt = { id: mutationId }
  // These two functions still run their own phase machine rather than
  // runGbpWrite, so they track the phase themselves and hand it to the
  // pipeline's classifier: a post-write read that fails leaves the state
  // unknown (`ambiguous`), never a definite `failed` on a write Google
  // actually applied.
  let phase: GbpWritePhase = "validate"
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
    phase = "mutate"
    if (input.changeSetId) {
      const result = await executeAndConfirmGbpMutation({
        organisationId: input.session.organisationId, mutationId, payload: input.payload, updateMask: input.updateMask,
        execute: () => patchGoogleLocation(token, { locationName: linked.googleLocationName, updateMask: input.updateMask, validateOnly: false, payload: input.payload }, { connectionKey: linked.connectionId }),
        observe: () => getGoogleLocation(token, linked.googleLocationName, [...READ_MASK], { connectionKey: linked.connectionId }),
        matches: (observed) => businessInformationMatches(input.payload, observed, input.updateMask),
        onObserved: (response) => cacheGbpSnapshot({ organisationId: input.session.organisationId, locationId: input.locationId, googleAccountId: linked.googleAccountId, resourceType: "business_info", resourceName: linked.googleLocationName, payload: response }),
      })
      await auditGbpMutation({ organisationId: input.session.organisationId, session: input.session, action: result.confirmationState === "confirmed" ? "business_information.updated" : "business_information.update.unconfirmed", subjectType: "location", subjectId: input.locationId, requestId: input.requestId, metadata: { mutationId, updateMask: input.updateMask, executionState: result.executionState, confirmationState: result.confirmationState } })
      return result
    }
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
    phase = "readback_read"
    const readback = await getGoogleLocation(
      token,
      linked.googleLocationName,
      [...READ_MASK],
      { connectionKey: linked.connectionId }
    )
    // The read completed, so the provider state is known again: from here a
    // disagreement is a definite failure, not an ambiguity.
    phase = "readback_verify"
    for (const field of input.updateMask) {
      const matches = businessInformationMatches(input.payload, readback, [field])
      if (!matches) {
        throw new ApiError(
          502,
          "business_information_readback_mismatch",
          `Google did not confirm the approved ${field} value.`
        )
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
    const status = classifyFailure(phase, error)
    const code = errorCode(error, "business_information_update_failed")
    await settleGbpMutation({
      organisationId: input.session.organisationId,
      mutationId: attempt.id,
      status,
      errorCode: code,
    })
    // An ambiguous outcome otherwise leaves no audit evidence at all: the
    // success audit never runs, so an operator reconciling the mutation table
    // against Google cannot tell a write that may have landed from one that
    // never left.
    if (status === "ambiguous") {
      await auditGbpMutation({
        organisationId: input.session.organisationId,
        session: input.session,
        action: "business_information.update.unconfirmed",
        subjectType: "location",
        subjectId: input.locationId,
        requestId: input.requestId,
        metadata: {
          updateMask: input.updateMask,
          mutationId: attempt.id,
          phase,
          errorCode: code,
        },
      })
    }
    throw error
  }
}

export async function previewBusinessAttributes(input: {
  session: Session; locationId: string; attributes: GoogleAttribute[]; attributeMask: string[]; expectedGoogleHash: string; requestId: string
}) {
  const linked = await loadedContext(input.session, input.locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot review changes for this location.")
  const token = await linked.accessToken()
  const baseline = await getGoogleLocationAttributes(token, linked.googleLocationName, { connectionKey: linked.connectionId })
  if (stableGoogleHash(baseline) !== input.expectedGoogleHash) throw new ApiError(409, "attributes_stale", "Google attributes changed. Refresh before reviewing.")
  const metadata = await loadGoogleAttributeMetadata(token, linked.googleLocationName, linked.connectionId)
  if (unsupportedAttributeNames(metadata, input.attributes, input.attributeMask).length) throw new ApiError(409, "attribute_not_supported", "One or more attribute changes are not supported by Google's current location metadata.")
  return saveGbpChangeSet({ session: input.session, linked, resourceType: "attributes", baseline, payload: { attributes: input.attributes }, updateMask: input.attributeMask, requestId: input.requestId })
}

export async function loadBusinessAttributeReviews(session: Session, locationId: string) {
  const linked = await loadedContext(session, locationId)
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot review changes for this location.")
  return listGbpChangeSets(session, linked, "attributes")
}

export async function updateBusinessAttributes(input: {
  session: Session
  locationId: string
  attributes: GoogleAttribute[]
  attributeMask: string[]
  expectedGoogleHash: string
  requestId: string
  changeSetId?: string
}): Promise<BusinessInformationMutationResult> {
  if (!input.changeSetId) throw new ApiError(409, "approval_required", "Review and approve the exact attribute change before publishing.")
  return withSessionConnection((connection) => connection.begin(async (lock) => {
    await lock`select pg_advisory_xact_lock(hashtextextended(${`${input.session.organisationId}:${input.locationId}:attributes`}, 0))`
    if (input.changeSetId) {
      const linked = await loadedContext(input.session, input.locationId)
      if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
      const reviewed = await approvedGbpChange({ session: input.session, linked, changeSetId: input.changeSetId, payload: { attributes: input.attributes }, updateMask: input.attributeMask, resourceType: "attributes" })
      if (reviewed.baseline_hash !== input.expectedGoogleHash) throw new ApiError(409, "approval_stale", "The baseline changed after review.")
      const [existing] = await withTenant(input.session.organisationId, (sql) => sql<BusinessInformationMutationResult[]>`select id, status, execution_state as "executionState", confirmation_state as "confirmationState" from gbp_management_mutation where change_set_id = ${input.changeSetId ?? null}`)
      if (existing) return { ...existing, idempotent: true }
    }
    return executeBusinessAttributes(input)
  }))
}

async function executeBusinessAttributes(input: Parameters<typeof updateBusinessAttributes>[0]): Promise<BusinessInformationMutationResult> {
  const linked = await loadedContext(input.session, input.locationId)
  if (!linked.canPublish)
    throw new ApiError(
      403,
      "publish_not_allowed",
      "You cannot publish for this location."
    )
  if (!writesEnabled())
    throw new ApiError(
      503,
      "business_information_paused",
      "Google Business Information writes are paused."
    )
  const token = await connectionAccessToken(
    getDatabase(),
    input.session.organisationId,
    linked.connectionId
  )
  const current = await getGoogleLocationAttributes(
    token,
    linked.googleLocationName,
    { connectionKey: linked.connectionId }
  )
  if (stableGoogleHash(current) !== input.expectedGoogleHash)
    throw new ApiError(
      409,
      "attributes_stale",
      "Google attributes changed. Refresh before publishing."
    )
  const metadata = await loadGoogleAttributeMetadata(token, linked.googleLocationName, linked.connectionId)
  if (unsupportedAttributeNames(metadata, input.attributes, input.attributeMask).length > 0) {
    throw new ApiError(409, "attribute_not_supported", "One or more attribute changes are not supported by Google's current location metadata. Refresh before publishing.")
  }
  const attempt = await startGbpMutation({
    organisationId: input.session.organisationId,
    session: input.session,
    locationId: input.locationId,
    googleAccountId: linked.googleAccountId,
    resourceType: "attributes",
    operation: "patch",
    targetResourceName: `${linked.googleLocationName}/attributes`,
    requestId: input.changeSetId ?? input.requestId,
    changeSetId: input.changeSetId,
    expectedGoogleHash: input.expectedGoogleHash,
    updateMask: input.attributeMask,
    payload: input.attributes,
    blockUnresolved: true,
    lockHeld: true,
  })
  if (attempt.idempotent) return attempt
  const result = await executeAndConfirmGbpMutation({
    organisationId: input.session.organisationId,
    mutationId: attempt.id,
    payload: { attributes: input.attributes },
    updateMask: input.attributeMask,
    matches: (observed) => googleAttributesMatch(observed, input.attributes, input.attributeMask),
    execute: () => patchGoogleLocationAttributes(
      token,
      {
        locationName: linked.googleLocationName,
        attributeMask: input.attributeMask,
        attributes: input.attributes,
      },
      { connectionKey: linked.connectionId }
    ),
    observe: () => getGoogleLocationAttributes(
      token,
      linked.googleLocationName,
      { connectionKey: linked.connectionId }
    ),
    onObserved: (readback) => cacheGbpSnapshot({
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      googleAccountId: linked.googleAccountId,
      resourceType: "attributes",
      resourceName: `${linked.googleLocationName}/attributes`,
      payload: readback,
    }),
  })
  await auditGbpMutation({
      organisationId: input.session.organisationId,
      session: input.session,
      action: result.confirmationState === "confirmed" ? "business_attributes.updated" : "business_attributes.update.unconfirmed",
      subjectType: "location",
      subjectId: input.locationId,
      requestId: input.requestId,
      metadata: { attributeMask: input.attributeMask, mutationId: attempt.id, executionState: result.executionState, confirmationState: result.confirmationState },
    })
  return result
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
