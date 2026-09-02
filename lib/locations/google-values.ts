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
      return attribute?.values?.[0] === true ? "Yes" : "No"
    case "ENUM": {
      const value = attribute?.repeatedEnumValue?.setValues?.[0]
      if (!value) return "Not set"
      return (
        enumOptionsFor(metadata).find((option) => option.value === value)
          ?.label ?? value
      )
    }
    case "URL":
      return attribute?.uriValues?.[0]?.uri || "Not set"
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
  websiteUri: string
  openStatus: string
  storeCode: string
  labels: string[]
  primaryCategory: CategoryRef | null
  additionalCategories: CategoryRef[]
  addressLines: string[]
  locality: string
  postalCode: string
  regionCode: string
}

export const LOCATION_FIELD_LABELS: Record<BusinessMask, string> = {
  title: "Business name",
  profile: "Description",
  phoneNumbers: "Phone",
  websiteUri: "Website",
  storefrontAddress: "Address",
  categories: "Categories",
  serviceArea: "Service area",
  serviceItems: "Service items",
  labels: "Labels",
  storeCode: "Store code",
  openInfo: "Open status",
  relationshipData: "Relationship data",
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
    "addressLines" | "locality" | "postalCode"
  >
): string | null {
  const parts = [...draft.addressLines, draft.locality, draft.postalCode]
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
          currentValue: initial.primaryPhone || null,
          nextValue: draft.primaryPhone || null,
        }
      case "websiteUri":
        return {
          key,
          label,
          currentValue: initial.websiteUri || null,
          nextValue: draft.websiteUri || null,
        }
      case "openInfo":
        return {
          key,
          label,
          currentValue: openStatusLabel(initial.openStatus),
          nextValue: openStatusLabel(draft.openStatus),
        }
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
          nextValue: formatAddress(draft),
        }
      default:
        return { key, label, currentValue: null, nextValue: null }
    }
  })
}
