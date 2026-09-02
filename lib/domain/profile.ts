// Server-only (imports node:crypto). The client-safe vocabulary, normaliser
// and drift classifier live in lib/domain/profile-vocabulary.ts and are
// re-exported here so existing imports keep working.
import { createHash } from "node:crypto"

import {
  PROFILE_FIELD_POLICIES,
  type GoogleProfileUpdateMask,
  type NormalizedProfile,
  type ProfileFieldKey,
} from "@/lib/domain/profile-vocabulary"

export * from "@/lib/domain/profile-vocabulary"

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
