import { createHash } from "node:crypto"

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

export type ProfileFieldPolicy =
  | "bidirectional"
  | "import_only"
  | "google_read_only"

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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function hashProfileValue(value: string | null): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export function hashProfile(profile: NormalizedProfile): string {
  return createHash("sha256").update(canonicalJson(profile)).digest("hex")
}

export type ProfileDriftStatus =
  | "in_sync"
  | "core_dirty"
  | "google_dirty"
  | "conflict"

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

export type GoogleProfileUpdateMask =
  | "title"
  | "profile"
  | "phoneNumbers"
  | "websiteUri"

export function buildGoogleProfilePatch(input: {
  canonical: NormalizedProfile
  selectedFields: ProfileFieldKey[]
}): {
  payload: Record<string, unknown>
  updateMask: GoogleProfileUpdateMask[]
} {
  const payload: Record<string, unknown> = {}
  const updateMask: GoogleProfileUpdateMask[] = []
  for (const field of [...new Set(input.selectedFields)]) {
    if (PROFILE_FIELD_POLICIES[field] !== "bidirectional") continue
    if (field === "name") {
      if (!input.canonical.name) continue
      payload.title = input.canonical.name
      updateMask.push("title")
    } else if (field === "description") {
      payload.profile = input.canonical.description
        ? { description: input.canonical.description }
        : {}
      updateMask.push("profile")
    } else if (field === "phone") {
      payload.phoneNumbers = input.canonical.phone
        ? { primaryPhone: input.canonical.phone }
        : {}
      updateMask.push("phoneNumbers")
    } else if (field === "website") {
      payload.websiteUri = input.canonical.website ?? ""
      updateMask.push("websiteUri")
    }
  }
  return { payload, updateMask }
}
