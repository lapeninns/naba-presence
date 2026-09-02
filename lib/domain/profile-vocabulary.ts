// Client-safe profile vocabulary: field keys, policies, drift statuses, the
// Google location shape and the pure normaliser/drift classifier. No
// node:crypto — hashing and the Google patch builder live in
// lib/domain/profile.ts, which re-exports everything here. See
// lib/domain/README.md.

export const PROFILE_FIELD_KEYS = [
  "name",
  "description",
  "phone",
  "address",
  "mapsUrl",
  "reviewUrl",
  "website",
] as const

export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number]

export const PROFILE_FIELD_POLICY_KINDS = [
  "bidirectional",
  "import_only",
  "google_read_only",
] as const
export type ProfileFieldPolicy = (typeof PROFILE_FIELD_POLICY_KINDS)[number]

export const PROFILE_FIELD_POLICIES: Record<
  ProfileFieldKey,
  ProfileFieldPolicy
> = {
  name: "bidirectional",
  description: "bidirectional",
  phone: "bidirectional",
  address: "import_only",
  mapsUrl: "import_only",
  reviewUrl: "import_only",
  website: "bidirectional",
}

export const PROFILE_DRIFT_STATUSES = [
  "in_sync",
  "core_dirty",
  "google_dirty",
  "conflict",
] as const
export type ProfileDriftStatus = (typeof PROFILE_DRIFT_STATUSES)[number]

export type GoogleProfileUpdateMask =
  | "title"
  | "profile"
  | "phoneNumbers"
  | "websiteUri"

export type GoogleStorefrontAddress = {
  addressLines?: string[]
  locality?: string
  administrativeArea?: string
  postalCode?: string
  regionCode?: string
  languageCode?: string
}

export type GoogleLocationProfile = {
  name?: string
  title?: string
  profile?: { description?: string }
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] }
  storefrontAddress?: GoogleStorefrontAddress
  websiteUri?: string
  categories?: {
    primaryCategory?: { name?: string; displayName?: string }
    additionalCategories?: Array<{ name?: string; displayName?: string }>
  }
  metadata?: {
    mapsUri?: string
    newReviewUri?: string
    [key: string]: unknown
  }
}

export type NormalizedProfile = Record<ProfileFieldKey, string | null>

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized || null
}

export function formatGoogleStorefrontAddress(
  address: GoogleStorefrontAddress | undefined
): string | null {
  if (!address) return null
  const parts = [
    ...(address.addressLines ?? []),
    address.locality,
    address.administrativeArea,
    address.postalCode,
    address.regionCode,
  ]
    .map(clean)
    .filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(", ") : null
}

export function normalizeGoogleProfile(
  location: GoogleLocationProfile
): NormalizedProfile {
  return {
    name: clean(location.title),
    description: clean(location.profile?.description),
    phone: clean(location.phoneNumbers?.primaryPhone),
    address: formatGoogleStorefrontAddress(location.storefrontAddress),
    mapsUrl: clean(location.metadata?.mapsUri),
    reviewUrl: clean(location.metadata?.newReviewUri),
    website: clean(location.websiteUri),
  }
}

export function classifyProfileField(input: {
  canonicalHash: string
  googleHash: string
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
}): ProfileDriftStatus {
  if (input.canonicalHash === input.googleHash) return "in_sync"
  if (!input.baselineCanonicalHash || !input.baselineGoogleHash) {
    return "conflict"
  }
  const coreChanged = input.canonicalHash !== input.baselineCanonicalHash
  const googleChanged = input.googleHash !== input.baselineGoogleHash
  if (coreChanged && googleChanged) return "conflict"
  if (coreChanged) return "core_dirty"
  if (googleChanged) return "google_dirty"
  return "conflict"
}
