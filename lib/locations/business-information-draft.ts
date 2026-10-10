/**
 * Business-information draft model: seed a draft from the raw Google
 * location, and turn touched fields into the exact `updateMask` + strict
 * payload the PATCH route enforces. Users never see masks or JSON.
 *
 * Pure and React-free; the generic Google leaf readers live in
 * ./google-values.ts.
 */
import type {
  AttributeMetadata,
  BusinessMask,
  GoogleAttribute,
} from "@/lib/contracts/location-business-information"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import { openingDateDraft, openingDatePayload } from "./forms/opening-date"
import { googleServiceAreaSchema } from "@/lib/domain/google-service-area"
import { editableRelationships, RELATIONSHIP_FIELDS, relationshipFieldMatches } from "@/lib/domain/google-relationships"

import {
  asRecord,
  asString,
  asStringArray,
  isPresent,
  toCategoryRef,
  type BusinessInformationDraft,
  type CategoryRef,
} from "./google-values"

export const OPEN_STATUS_OPTIONS = [
  "OPEN",
  "CLOSED_TEMPORARILY",
  "CLOSED_PERMANENTLY",
] as const

// The complex/unsupported Google leaves this editor never grows a control
// for (spec §12) — shown read-only, never as raw JSON (spec §8).
export const UNSUPPORTED_LEAVES: ReadonlyArray<{ key: string; label: string }> =
  [
    { key: "serviceItems", label: "Service items" },
    { key: "moreHours", label: "Extra opening hours" },
  ]

/** The unsupported leaves Google actually holds for this location. */
export function presentUnsupportedLeaves(location: unknown) {
  const record = asRecord(location)
  return UNSUPPORTED_LEAVES.filter(({ key }) => isPresent(record[key]))
}

/** Project the raw Google location onto the editable draft (defaults: OPEN, GB). */
export function draftFromLocation(location: unknown): BusinessInformationDraft {
  const record = asRecord(location)
  const profile = asRecord(record.profile)
  const phoneNumbers = asRecord(record.phoneNumbers)
  const openInfo = asRecord(record.openInfo)
  const storefrontAddress = asRecord(record.storefrontAddress)
  const categories = asRecord(record.categories)
  const serviceArea = googleServiceAreaSchema.safeParse(record.serviceArea)
  const relationshipData = editableRelationships(record.relationshipData)
  const additionalCategoriesRaw = Array.isArray(categories.additionalCategories)
    ? categories.additionalCategories
    : []
  return {
    title: asString(record.title),
    ...(serviceArea.success ? { serviceArea: serviceArea.data } : {}),
    ...(relationshipData ? { relationshipData } : {}),
    description: asString(profile.description),
    primaryPhone: asString(phoneNumbers.primaryPhone),
    ...(typeof asRecord(record.adWordsLocationExtensions).adPhone === "string" ? { adPhone: asString(asRecord(record.adWordsLocationExtensions).adPhone) } : {}),
    ...(Array.isArray(phoneNumbers.additionalPhones) ? { additionalPhones: asStringArray(phoneNumbers.additionalPhones) } : {}),
    websiteUri: asString(record.websiteUri),
    openStatus: asString(openInfo.status) || "OPEN",
    ...(openInfo.openingDate ? { openingDate: openingDateDraft(openInfo.openingDate) } : {}),
    storeCode: asString(record.storeCode),
    labels: asStringArray(record.labels),
    primaryCategory: toCategoryRef(categories.primaryCategory),
    additionalCategories: additionalCategoriesRaw
      .map(toCategoryRef)
      .filter((c): c is CategoryRef => c !== null),
    addressLines: asStringArray(storefrontAddress.addressLines),
    locality: asString(storefrontAddress.locality),
    postalCode: asString(storefrontAddress.postalCode),
    regionCode: asString(storefrontAddress.regionCode) || "GB",
    ...(typeof storefrontAddress.administrativeArea === "string" ? { administrativeArea: storefrontAddress.administrativeArea } : {}),
    ...(typeof storefrontAddress.sublocality === "string" ? { sublocality: storefrontAddress.sublocality } : {}),
    ...(typeof storefrontAddress.languageCode === "string" ? { addressLanguageCode: storefrontAddress.languageCode } : {}),
    ...(typeof storefrontAddress.organization === "string" ? { addressOrganization: storefrontAddress.organization } : {}),
    ...(typeof storefrontAddress.sortingCode === "string" ? { addressSortingCode: storefrontAddress.sortingCode } : {}),
    ...(Array.isArray(storefrontAddress.recipients) ? { addressRecipients: asStringArray(storefrontAddress.recipients) } : {}),
  }
}

export type LocationUpdate = {
  updateMask: BusinessMask[]
  payload: Record<string, unknown>
}

// Build the update_location payload from ONLY the fields the user changed. Each
// entry maps a form leaf to its Google shape; the mask is exactly the keys present.
export function buildLocationUpdate(
  initial: BusinessInformationDraft,
  draft: BusinessInformationDraft
): LocationUpdate {
  const payload: Record<string, unknown> = {}
  const mask: BusinessMask[] = []
  if (draft.title !== initial.title) {
    payload.title = draft.title
    mask.push("title")
  }
  if (draft.description !== initial.description) {
    payload.profile = { description: draft.description }
    mask.push("profile")
  }
  if (draft.primaryPhone !== initial.primaryPhone || JSON.stringify(draft.additionalPhones ?? []) !== JSON.stringify(initial.additionalPhones ?? [])) {
    payload.phoneNumbers = { primaryPhone: draft.primaryPhone, additionalPhones: draft.additionalPhones ?? [] }
    mask.push("phoneNumbers")
  }
  if (draft.websiteUri !== initial.websiteUri) {
    payload.websiteUri = draft.websiteUri
    mask.push("websiteUri")
  }
  if (draft.adPhone !== undefined && draft.adPhone.trim() !== (initial.adPhone ?? "").trim()) {
    payload.adWordsLocationExtensions = draft.adPhone.trim() ? { adPhone: draft.adPhone.trim() } : {}
    mask.push("adWordsLocationExtensions")
  }
  if (draft.openStatus !== initial.openStatus) {
    payload.openInfo = { status: draft.openStatus }
    mask.push("openInfo.status")
  }
  if (JSON.stringify(draft.openingDate ?? null) !== JSON.stringify(initial.openingDate ?? null)) {
    payload.openInfo = { status: draft.openStatus, ...(draft.openingDate ? { openingDate: openingDatePayload(draft.openingDate) } : {}) }
    mask.push("openInfo.openingDate")
  }
  if (draft.storeCode !== initial.storeCode) {
    payload.storeCode = draft.storeCode
    mask.push("storeCode")
  }
  if (JSON.stringify(draft.labels) !== JSON.stringify(initial.labels)) {
    payload.labels = draft.labels
    mask.push("labels")
  }
  if (
    draft.primaryCategory?.name !== initial.primaryCategory?.name ||
    JSON.stringify(draft.additionalCategories) !==
      JSON.stringify(initial.additionalCategories)
  ) {
    // Google (and businessInformationPayloadSchema) require a primaryCategory
    // whenever `categories` is sent at all — a location can read back with
    // additionalCategories but no primaryCategory (neither is required on
    // GET), so only emit the categories mask once a primary category is set;
    // otherwise there is nothing valid to publish yet.
    if (draft.primaryCategory) {
      payload.categories = {
        primaryCategory: { name: draft.primaryCategory.name },
        additionalCategories: draft.additionalCategories.map((c) => ({
          name: c.name,
        })),
      }
      mask.push("categories")
    }
  }
  if (
    draft.addressLines.join("\n") !== initial.addressLines.join("\n") ||
    draft.locality !== initial.locality ||
    draft.postalCode !== initial.postalCode || draft.regionCode !== initial.regionCode ||
    (draft.administrativeArea ?? "") !== (initial.administrativeArea ?? "") ||
    (draft.sublocality ?? "") !== (initial.sublocality ?? "")
  ) {
    payload.storefrontAddress = {
      regionCode: draft.regionCode,
      addressLines: draft.addressLines,
      locality: draft.locality,
      postalCode: draft.postalCode,
      ...(draft.administrativeArea !== undefined ? { administrativeArea: draft.administrativeArea } : {}),
      ...(draft.sublocality !== undefined ? { sublocality: draft.sublocality } : {}),
    }
    if (draft.addressLines.join("\n") !== initial.addressLines.join("\n")) mask.push("storefrontAddress.addressLines")
    if (draft.locality !== initial.locality) mask.push("storefrontAddress.locality")
    if (draft.postalCode !== initial.postalCode) mask.push("storefrontAddress.postalCode")
    if (draft.regionCode !== initial.regionCode) mask.push("storefrontAddress.regionCode")
    if ((draft.administrativeArea ?? "") !== (initial.administrativeArea ?? "")) {
      payload.storefrontAddress = { ...asRecord(payload.storefrontAddress), administrativeArea: draft.administrativeArea ?? "" }
      mask.push("storefrontAddress.administrativeArea")
    }
    if ((draft.sublocality ?? "") !== (initial.sublocality ?? "")) {
      payload.storefrontAddress = { ...asRecord(payload.storefrontAddress), sublocality: draft.sublocality ?? "" }
      mask.push("storefrontAddress.sublocality")
    }
  }
  if (draft.serviceArea && JSON.stringify(draft.serviceArea) !== JSON.stringify(initial.serviceArea)) {
    payload.serviceArea = draft.serviceArea
    mask.push("serviceArea")
  }
  for (const [key, field] of [["addressLanguageCode", "languageCode"], ["addressOrganization", "organization"], ["addressSortingCode", "sortingCode"]] as const) {
    if ((draft[key] ?? "") !== (initial[key] ?? "")) {
      payload.storefrontAddress = { regionCode: draft.regionCode, addressLines: draft.addressLines, ...asRecord(payload.storefrontAddress), [field]: draft[key] ?? "" }
      mask.push(`storefrontAddress.${field}`)
    }
  }
  if (JSON.stringify(draft.addressRecipients ?? []) !== JSON.stringify(initial.addressRecipients ?? [])) {
    payload.storefrontAddress = { regionCode: draft.regionCode, addressLines: draft.addressLines, ...asRecord(payload.storefrontAddress), recipients: draft.addressRecipients ?? [] }
    mask.push("storefrontAddress.recipients")
  }
  const relationshipUpdates: Record<string, unknown> = {}
  for (const field of RELATIONSHIP_FIELDS) {
    const next = draft.relationshipData?.[field]
    if (next !== undefined && !relationshipFieldMatches(initial.relationshipData, draft.relationshipData ?? {}, field)) {
      relationshipUpdates[field] = next
      mask.push(`relationshipData.${field}`)
    }
  }
  if (Object.keys(relationshipUpdates).length) payload.relationshipData = relationshipUpdates
  if (draft.clearStorefrontAddress) {
    payload.storefrontAddress = {}
    return { updateMask: [...mask.filter((field) => !field.startsWith("storefrontAddress.")), "storefrontAddress"], payload }
  }
  return { updateMask: mask, payload }
}

export type AttributesUpdate = {
  attributeMask: string[]
  attributes: GoogleAttribute[]
}

export function buildAttributesUpdate(
  metadata: readonly AttributeMetadata[],
  initial: Record<string, GoogleAttribute>,
  draft: Record<string, GoogleAttribute>
): AttributesUpdate {
  const attributeMask: string[] = []
  const attributes: GoogleAttribute[] = []
  for (const meta of metadata) {
    const name = meta.parent
    if (JSON.stringify(draft[name]) === JSON.stringify(initial[name])) continue
    attributeMask.push(name)
    const current = draft[name]
    if (current) attributes.push(current)
  }
  return { attributeMask, attributes }
}

export type PayloadFieldKey =
  "title" | "description" | "primaryPhone" | "additionalPhones" | "adPhone" | "websiteUri" | "addressLines" | "administrativeArea" | "sublocality" | "addressDetails" | "openingDate" | "serviceArea" | "relationshipData"

const PAYLOAD_KEY_TO_FIELD: Record<string, PayloadFieldKey> = {
  title: "title",
  profile: "description",
  phoneNumbers: "primaryPhone",
  adWordsLocationExtensions: "adPhone",
  websiteUri: "websiteUri",
  storefrontAddress: "addressLines",
  openInfo: "openingDate",
  serviceArea: "serviceArea",
  relationshipData: "relationshipData",
}

export type PayloadFieldErrors = Partial<Record<PayloadFieldKey, string>>

// Optional strict validation before send (spec §6): re-uses the same
// businessInformationPayloadSchema the PATCH route enforces, so a bad value
// (e.g. an empty title) surfaces as a field error here rather than only as a
// generic toast after the request round-trips. Never shown as raw zod/JSON —
// only the schema's own plain-English `message` reaches the field.
export function fieldErrorsFromPayload(
  payload: Record<string, unknown>
): PayloadFieldErrors {
  const parsed = businessInformationPayloadSchema.safeParse(payload)
  if (parsed.success) return {}
  const errors: PayloadFieldErrors = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] === "phoneNumbers" && issue.path[1] === "additionalPhones" ? "additionalPhones"
      : issue.path[0] === "storefrontAddress" && ["languageCode", "organization", "recipients", "sortingCode"].includes(String(issue.path[1])) ? "addressDetails"
      : issue.path[0] === "storefrontAddress" && (issue.path[1] === "administrativeArea" || issue.path[1] === "sublocality") ? issue.path[1]
      : PAYLOAD_KEY_TO_FIELD[String(issue.path[0] ?? "")]
    if (field && !(field in errors)) errors[field] = issue.message
  }
  return errors
}
