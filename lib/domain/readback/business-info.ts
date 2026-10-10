// Client-safe readback adapter for Business Information location PATCHes
// (lib/server/business-information.ts updateBusinessInformation). Compares
// only the masked fields, after the normalisation Google applies to phone
// numbers, links, categories, addresses, service areas and text.
import {
  containsExpected,
  isEmptyValue,
  isRecord,
  normalizeText,
  normalizeUri,
  sameSet,
} from "./compare"

/**
 * A phone number reduced to its digits, keeping a leading "+" marker. Google
 * reformats spacing and punctuation, and may add the country code to a
 * national number.
 */
export function normalizePhone(value: unknown): string {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/gu, "")
  return trimmed.startsWith("+") ? `+${digits}` : digits
}

/**
 * The same number, allowing Google's national-to-international rewrite:
 * "01223 000000" and "+44 1223 000000" match when the international form is
 * the national significant number behind a one-to-three digit country code.
 */
export function phonesMatch(actual: unknown, expected: unknown): boolean {
  const a = normalizePhone(actual)
  const e = normalizePhone(expected)
  if (a === e) return true
  if (!a || !e) return false
  const international = a.startsWith("+") ? a : e.startsWith("+") ? e : null
  const national = international === a ? e : a
  if (!international || national.startsWith("+")) return false
  const significant = national.replace(/^0+/u, "")
  const digits = international.slice(1)
  const prefix = digits.length - significant.length
  return (
    significant.length > 0 &&
    prefix >= 1 &&
    prefix <= 3 &&
    digits.endsWith(significant)
  )
}

function phoneNumbersMatch(actual: unknown, expected: unknown): boolean {
  const live = isRecord(actual) ? actual : {}
  const want = isRecord(expected) ? expected : {}
  if ("primaryPhone" in want) {
    if (isEmptyValue(want.primaryPhone)) {
      if (!isEmptyValue(live.primaryPhone)) return false
    } else if (!phonesMatch(live.primaryPhone, want.primaryPhone)) {
      return false
    }
  }
  if ("additionalPhones" in want) {
    const wanted = Array.isArray(want.additionalPhones)
      ? want.additionalPhones
      : []
    const got = Array.isArray(live.additionalPhones)
      ? live.additionalPhones
      : []
    if (wanted.length !== got.length) return false
    if (!wanted.every((phone, index) => phonesMatch(got[index], phone))) {
      return false
    }
  }
  return true
}

function categoryName(value: unknown): string {
  return isRecord(value) && typeof value.name === "string"
    ? value.name.trim()
    : ""
}

/**
 * Categories by their stable `categories/gcid:*` name only: Google adds
 * displayName, serviceTypes and moreHoursTypes, and does not promise the
 * order of the additional categories.
 */
function categoriesMatch(actual: unknown, expected: unknown): boolean {
  const live = isRecord(actual) ? actual : {}
  const want = isRecord(expected) ? expected : {}
  if (categoryName(live.primaryCategory) !== categoryName(want.primaryCategory))
    return false
  const names = (list: unknown) =>
    (Array.isArray(list) ? list : []).map(categoryName).filter(Boolean)
  return sameSet(
    names(live.additionalCategories),
    names(want.additionalCategories)
  )
}

/** A postcode as Google stores it: upper case, internal spacing ignored. */
function normalizePostalCode(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/gu, "").toUpperCase()
    : ""
}

function regionCodeOf(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : ""
}

/**
 * A PostalAddress after Google's normalisation: region and postcode compare
 * case-insensitively (postcode spacing ignored); every other part the
 * payload names compares as text.
 */
function addressMatches(actual: unknown, expected: unknown): boolean {
  if (!isRecord(expected)) return containsExpected(actual, expected)
  const live = isRecord(actual) ? actual : {}
  const { regionCode, postalCode, ...rest } = expected
  return (
    (regionCode === undefined ||
      regionCodeOf(live.regionCode) === regionCodeOf(regionCode)) &&
    (postalCode === undefined ||
      normalizePostalCode(live.postalCode) ===
        normalizePostalCode(postalCode)) &&
    containsExpected(live, rest)
  )
}

/** A served place by its place id, or its name when it has none. */
function placeKey(value: unknown): string {
  if (!isRecord(value)) return ""
  if (typeof value.placeId === "string" && value.placeId.trim())
    return `id:${value.placeId.trim()}`
  return `name:${normalizeText(value.placeName).toLowerCase()}`
}

/**
 * A ServiceArea: the business type and region code as set, and the served
 * places as a set (Google does not promise their order).
 */
function serviceAreaMatches(actual: unknown, expected: unknown): boolean {
  if (!isRecord(expected)) return containsExpected(actual, expected)
  const live = isRecord(actual) ? actual : {}
  const { regionCode, places, ...rest } = expected
  const placeKeys = (value: unknown) => {
    const infos = isRecord(value) ? value.placeInfos : undefined
    return (Array.isArray(infos) ? infos : []).map(placeKey)
  }
  return (
    (regionCode === undefined ||
      regionCodeOf(live.regionCode) === regionCodeOf(regionCode)) &&
    (places === undefined ||
      sameSet(placeKeys(live.places), placeKeys(places))) &&
    containsExpected(live, rest)
  )
}

/** One masked Business Information field, compared after normalisation. */
export function businessInfoFieldMatches(
  field: string,
  actual: unknown,
  expected: unknown
): boolean {
  switch (field) {
    case "phoneNumbers":
      return phoneNumbersMatch(actual, expected)
    case "websiteUri":
      return normalizeUri(actual) === normalizeUri(expected)
    case "categories":
      return categoriesMatch(actual, expected)
    case "storefrontAddress":
      return addressMatches(actual, expected)
    case "serviceArea":
      return serviceAreaMatches(actual, expected)
    case "title":
    case "storeCode":
      return normalizeText(actual) === normalizeText(expected)
    case "labels": {
      const list = (value: unknown) =>
        (Array.isArray(value) ? value : []).map(normalizeText)
      const a = list(actual)
      const e = list(expected)
      return a.length === e.length && e.every((label, i) => label === a[i])
    }
    default:
      return containsExpected(actual, expected)
  }
}

/**
 * The masked fields the readback does not confirm. Fields outside the mask
 * are never compared, so an unrelated change on Google (or a field Google
 * adds) cannot fail a write that applied.
 */
export function businessInfoMismatches(
  updateMask: readonly string[],
  readback: Record<string, unknown>,
  payload: Record<string, unknown>
): string[] {
  return updateMask.filter(
    (field) => !businessInfoFieldMatches(field, readback[field], payload[field])
  )
}
