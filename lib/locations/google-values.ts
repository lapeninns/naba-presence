/**
 * Raw Google leaf -> typed value adapters (Sprint 4.2c).
 *
 * Google-direct resources (business information, industry, administration)
 * arrive as passthrough records — they vary by category and by what the
 * merchant has set — so every tab reads known leaves defensively and never
 * assumes a shape that isn't there. These readers used to be re-declared per
 * tab (business-information, industry, administration) with slightly
 * different miss semantics; this is the one copy. `asRecord` follows the
 * majority convention: a non-record reads as `{}` so callers can chain
 * `asRecord(x).leaf` without optional access.
 *
 * Pure, React-free, unit-tested in tests/components/google-values.test.ts.
 */
import type {
  AttributeMetadata,
  BusinessMask,
  GoogleAttribute,
} from "@/lib/contracts/location-business-information"
import { categoryLabel, openStatusLabel } from "@/lib/locations/console-labels"
import { openingDateLabel, type OpeningDateDraft } from "./forms/opening-date"
import type { GoogleServiceArea } from "@/lib/domain/google-service-area"
import { googleRelevantLocationSchema, type GoogleRelationship } from "@/lib/domain/google-relationships"

export type RawRecord = Record<string, unknown>

export function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** A plain object, or `{}` for anything else (null, arrays, scalars). */
export function asRecord(value: unknown): RawRecord {
  return isRecord(value) ? value : {}
}

/** Each entry coerced through `asRecord`; a non-array reads as `[]`. */
export function asArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Only the string entries of an array; a non-array reads as `[]`. */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

/** True when a Google leaf carries something worth showing (non-empty). */
export function isPresent(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === "object") return Object.keys(value as object).length > 0
  return true
}

// --- categories -------------------------------------------------------------

export type CategoryRef = { name: string; displayName?: string | null }

export function toCategoryRef(value: unknown): CategoryRef | null {
  const record = asRecord(value)
  const name = asString(record.name)
  if (!name) return null
  return {
    name,
    displayName:
      typeof record.displayName === "string" ? record.displayName : null,
  }
}

/** The `{ categories: [...] }` result of a Google category search. */
export function extractCategories(result: unknown): CategoryRef[] {
  const list = asRecord(result).categories
  return (Array.isArray(list) ? list : [])
    .map(toCategoryRef)
    .filter((entry): entry is CategoryRef => entry !== null)
}

// --- attributes -------------------------------------------------------------

export type EnumOption = { value: string; label: string }

/**
 * The enum choices Google publishes in an attribute's `valueMetadata`. Shared
 * by the typed control (to render the select) and the publish diff (to
 * humanise a raw enum value the same way) — never a raw enum string (§7).
 */
export function enumOptionsFor(metadata: AttributeMetadata): EnumOption[] {
  const meta = metadata as unknown as {
    valueMetadata?: Array<{ value?: string; displayName?: string }>
  }
  return (meta.valueMetadata ?? [])
    .filter(
      (entry): entry is { value: string; displayName?: string } =>
        typeof entry.value === "string"
    )
    .map((entry) => ({
      value: entry.value,
      label: entry.displayName ?? entry.value,
    }))
}

/** A human summary of an attribute value for the publish diff, or null when the type has no editor. */
export function describeAttributeValue(
  metadata: AttributeMetadata | undefined,
  attribute: GoogleAttribute | undefined
): string | null {
  if (!metadata) return null
  switch (metadata.valueType) {
    case "BOOL":
      return typeof attribute?.values?.[0] === "boolean" ? (attribute.values[0] ? "Yes" : "No") : "Not set"
    case "ENUM": {
      const value = attribute?.values?.[0]
      if (typeof value !== "string" || !value) return "Not set"
      return (
        enumOptionsFor(metadata).find((option) => option.value === value)
          ?.label ?? value
      )
    }
    case "URL":
      return attribute?.uriValues?.map((value) => value.uri).join(", ") || "Not set"
    case "REPEATED_ENUM": {
      const selected = attribute?.repeatedEnumValue?.setValues ?? []
      const unselected = attribute?.repeatedEnumValue?.unsetValues ?? []
      if (!selected.length && !unselected.length) return "Not set"
      const options = enumOptionsFor(metadata)
      return [...new Set([...options.map((option) => option.value), ...selected, ...unselected])].map((value) => {
        const label = options.find((option) => option.value === value)?.label ?? value
        return `${label}: ${selected.includes(value) ? "Yes" : unselected.includes(value) ? "No" : "Not set"}`
      }).join("; ")
    }
    default:
      return null
  }
}

/** Stable-order grouping (first-seen group first), as `[label, items]` pairs. */
export function groupByLabel<T>(
  items: readonly T[],
  keyFn: (item: T) => string
): Array<[string, T[]]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return Array.from(map.entries())
}

/**
 * The location's raw `attributes` resource narrowed to the typed
 * `GoogleAttribute` shape, keyed by attribute name, for every attribute that
 * has metadata (unknown attributes are preserved on Google, never edited).
 */
export function attributesFromState(
  attributes: unknown,
  metadata: readonly AttributeMetadata[]
): Record<string, GoogleAttribute> {
  const raw = asRecord(attributes).attributes
  const list = Array.isArray(raw) ? raw : []
  const map: Record<string, GoogleAttribute> = {}
  for (const meta of metadata) {
    const found = list.find((entry) => asRecord(entry).name === meta.parent)
    if (!isRecord(found)) continue
    const repeatedEnum = found.repeatedEnumValue
    map[meta.parent] = {
      name: meta.parent,
      values: Array.isArray(found.values) ? found.values : undefined,
      uriValues: Array.isArray(found.uriValues)
        ? found.uriValues
            .map(asRecord)
            .filter((v) => typeof v.uri === "string")
            .map((v) => ({
              uri: v.uri as string,
              uriType: typeof v.uriType === "string" ? v.uriType : undefined,
            }))
        : undefined,
      repeatedEnumValue: isRecord(repeatedEnum)
        ? {
            setValues: asStringArray(repeatedEnum.setValues),
            unsetValues: asStringArray(repeatedEnum.unsetValues),
          }
        : undefined,
    }
  }
  return map
}

// --- business information draft + diff -------------------------------------

/** The editable projection of a Google location (business-information tab). */
export type BusinessInformationDraft = {
  title: string
  description: string
  primaryPhone: string
  additionalPhones?: string[]
  adPhone?: string
  websiteUri: string
  openStatus: string
  openingDate?: OpeningDateDraft | null
  storeCode: string
  labels: string[]
  primaryCategory: CategoryRef | null
  additionalCategories: CategoryRef[]
  addressLines: string[]
  locality: string
  postalCode: string
  regionCode: string
  administrativeArea?: string
  sublocality?: string
  addressLanguageCode?: string
  addressOrganization?: string
  addressRecipients?: string[]
  addressSortingCode?: string
  serviceArea?: GoogleServiceArea
  relationshipData?: GoogleRelationship
  clearStorefrontAddress?: boolean
}

export const LOCATION_FIELD_LABELS: Record<BusinessMask, string> = {
  title: "Business name",
  profile: "Description",
  phoneNumbers: "Phone",
  "storefrontAddress.languageCode": "Address language",
  "storefrontAddress.organization": "Address organisation",
  "storefrontAddress.recipients": "Address recipients",
  "storefrontAddress.sortingCode": "Postal sorting code",
  adWordsLocationExtensions: "Google Ads phone",
  websiteUri: "Website",
  storefrontAddress: "Address",
  "storefrontAddress.addressLines": "Address lines",
  "storefrontAddress.locality": "Town or city",
  "storefrontAddress.postalCode": "Postcode",
  "storefrontAddress.regionCode": "Country code",
  "storefrontAddress.administrativeArea": "County or region",
  "storefrontAddress.sublocality": "District or neighbourhood",
  categories: "Categories",
  serviceArea: "Service area",
  serviceItems: "Service items",
  labels: "Labels",
  storeCode: "Store code",
  openInfo: "Open status",
  "openInfo.status": "Open status",
  "openInfo.openingDate": "Opening date",
  relationshipData: "Relationship data",
  "relationshipData.parentChain": "Chain affiliation",
  "relationshipData.parentLocation": "Parent business",
  "relationshipData.childrenLocations": "Child businesses",
}

export type GoogleDiffRow = {
  key: string
  label: string
  currentValue: string | null
  nextValue: string | null
}

export function formatAddress(
  draft: Pick<
    BusinessInformationDraft,
    "addressLines" | "locality" | "postalCode" | "administrativeArea" | "sublocality"
  >
): string | null {
  const parts = [...draft.addressLines, draft.sublocality ?? "", draft.locality, draft.administrativeArea ?? "", draft.postalCode]
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : null
}

export function categoriesSummary(
  draft: Pick<
    BusinessInformationDraft,
    "primaryCategory" | "additionalCategories"
  >
): string | null {
  const names = [draft.primaryCategory, ...draft.additionalCategories]
    .filter((c): c is CategoryRef => c !== null)
    .map(categoryLabel)
  return names.length > 0 ? names.join(", ") : null
}

/** One diff row per masked field, humanised (never a raw enum or gcid). */
export function locationDiffRows(
  mask: readonly BusinessMask[],
  initial: BusinessInformationDraft,
  draft: BusinessInformationDraft
): GoogleDiffRow[] {
  return mask.map((key) => {
    const label = LOCATION_FIELD_LABELS[key]
    switch (key) {
      case "title":
        return {
          key,
          label,
          currentValue: initial.title || null,
          nextValue: draft.title || null,
        }
      case "profile":
        return {
          key,
          label,
          currentValue: initial.description || null,
          nextValue: draft.description || null,
        }
      case "phoneNumbers":
        return {
          key,
          label,
          currentValue: [initial.primaryPhone, ...(initial.additionalPhones ?? [])].filter(Boolean).join(", ") || null,
          nextValue: [draft.primaryPhone, ...(draft.additionalPhones ?? [])].filter(Boolean).join(", ") || null,
        }
      case "adWordsLocationExtensions":
        return { key, label, currentValue: initial.adPhone || null, nextValue: draft.adPhone || null }
      case "websiteUri":
        return {
          key,
          label,
          currentValue: initial.websiteUri || null,
          nextValue: draft.websiteUri || null,
        }
      case "openInfo":
      case "openInfo.status":
        return {
          key,
          label,
          currentValue: openStatusLabel(initial.openStatus),
          nextValue: openStatusLabel(draft.openStatus),
        }
      case "openInfo.openingDate":
        return { key, label, currentValue: openingDateLabel(initial.openingDate), nextValue: openingDateLabel(draft.openingDate) }
      case "storeCode":
        return {
          key,
          label,
          currentValue: initial.storeCode || null,
          nextValue: draft.storeCode || null,
        }
      case "labels":
        return {
          key,
          label,
          currentValue: initial.labels.join(", ") || null,
          nextValue: draft.labels.join(", ") || null,
        }
      case "categories":
        return {
          key,
          label,
          currentValue: categoriesSummary(initial),
          nextValue: categoriesSummary(draft),
        }
      case "storefrontAddress":
        return {
          key,
          label,
          currentValue: formatAddress(initial),
          nextValue: draft.clearStorefrontAddress ? null : formatAddress(draft),
        }
      case "serviceArea":
        return { key, label, currentValue: serviceAreaSummary(initial.serviceArea), nextValue: serviceAreaSummary(draft.serviceArea) }
      case "relationshipData.parentChain":
        return { key, label, currentValue: initial.relationshipData?.parentChain || null, nextValue: draft.relationshipData?.parentChain || null }
      case "relationshipData.parentLocation":
        return { key, label, currentValue: relatedLocationSummary(initial.relationshipData?.parentLocation), nextValue: relatedLocationSummary(draft.relationshipData?.parentLocation) }
      case "relationshipData.childrenLocations":
        return { key, label, currentValue: initial.relationshipData?.childrenLocations?.map(relatedLocationSummary).join("; ") || null, nextValue: draft.relationshipData?.childrenLocations?.map(relatedLocationSummary).join("; ") || null }
      case "storefrontAddress.addressLines":
        return { key, label, currentValue: initial.addressLines.join(", ") || null, nextValue: draft.addressLines.join(", ") || null }
      case "storefrontAddress.locality":
        return { key, label, currentValue: initial.locality || null, nextValue: draft.locality || null }
      case "storefrontAddress.postalCode":
        return { key, label, currentValue: initial.postalCode || null, nextValue: draft.postalCode || null }
      case "storefrontAddress.regionCode":
        return { key, label, currentValue: initial.regionCode || null, nextValue: draft.regionCode || null }
      case "storefrontAddress.administrativeArea":
        return { key, label, currentValue: initial.administrativeArea || null, nextValue: draft.administrativeArea || null }
      case "storefrontAddress.sublocality":
        return { key, label, currentValue: initial.sublocality || null, nextValue: draft.sublocality || null }
      case "storefrontAddress.languageCode":
        return { key, label, currentValue: initial.addressLanguageCode || null, nextValue: draft.addressLanguageCode || null }
      case "storefrontAddress.organization":
        return { key, label, currentValue: initial.addressOrganization || null, nextValue: draft.addressOrganization || null }
      case "storefrontAddress.recipients":
        return { key, label, currentValue: initial.addressRecipients?.join("; ") || null, nextValue: draft.addressRecipients?.join("; ") || null }
      case "storefrontAddress.sortingCode":
        return { key, label, currentValue: initial.addressSortingCode || null, nextValue: draft.addressSortingCode || null }
      default:
        return { key, label, currentValue: null, nextValue: null }
    }
  })
}

function serviceAreaSummary(area: GoogleServiceArea | undefined): string | null {
  if (!area) return null
  const type = area.businessType === "CUSTOMER_LOCATION_ONLY" ? "Customer locations only" : "Business and customer locations"
  const places = area.places?.placeInfos.map((place) => `${place.placeName} (${place.placeId})`) ?? []
  return [type, area.regionCode, ...places].filter(Boolean).join("; ")
}

function relatedLocationSummary(value: GoogleRelationship["parentLocation"]): string | null {
  const parsed = googleRelevantLocationSchema.safeParse(value)
  if (!parsed.success) return null
  return `${parsed.data.placeId} (${parsed.data.relationType === "DEPARTMENT_OF" ? "Department" : "Independent business at the same address"})`
}
