import { z } from "zod"

import { apiFetch } from "./client"

export const PROFILE_FIELD_KEYS = ["name", "description", "phone", "address", "mapsUrl", "reviewUrl", "website"] as const
export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number]

const profileFieldSchema = z.object({
  key: z.enum(PROFILE_FIELD_KEYS),
  policy: z.enum(["bidirectional", "import_only", "google_read_only"]),
  status: z.enum(["in_sync", "core_dirty", "google_dirty", "conflict"]),
  canonicalValue: z.string().nullable(),
  googleValue: z.string().nullable(),
  canonicalHash: z.string(),
  googleHash: z.string(),
  lastReconciledAt: z.string().nullable(),
})

const profileStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  canonicalHash: z.string(),
  googleHash: z.string(),
  canPublish: z.boolean(),
  googleWritesEnabled: z.boolean(),
  fields: z.array(profileFieldSchema),
  googleDetails: z.object({ primaryCategory: z.string().nullable(), additionalCategories: z.array(z.string()) }),
  latestAttempt: z
    .object({
      id: z.string(),
      direction: z.string(),
      status: z.string(),
      selectedFields: z.array(z.string()),
      createdAt: z.string(),
      finishedAt: z.string().nullable(),
    })
    .nullable(),
})
export type ProfileState = z.infer<typeof profileStateSchema>
export type ProfileField = z.infer<typeof profileFieldSchema>

export function fetchProfile(id: string): Promise<ProfileState> {
  return apiFetch(`/api/locations/${id}/profile`, { schema: z.object({ profile: profileStateSchema }) }).then((r) => r.profile)
}

export function saveProfile(
  id: string,
  input: { expectedCanonicalRevision: string; values: { name: string | null; description: string | null; phone: string | null; website: string | null } }
) {
  return apiFetch(`/api/locations/${id}/profile`, {
    method: "PUT",
    body: input,
    schema: z.object({ saved: z.literal(true), revision: z.string() }),
  })
}

export type ProfileOperationInput = {
  direction: "to_google" | "from_google"
  confirmation: "publish_nabapresence_profile_to_google" | "import_google_profile_to_nabapresence"
  selectedFields: ProfileFieldKey[]
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmOverwriteGoogleChanges?: boolean
  confirmOverwriteCanonicalChanges?: boolean
}
export type ProfileOperationResult = { status: string; revision?: string; attemptId?: string; idempotent?: boolean }

export function runProfileOperation(id: string, input: ProfileOperationInput): Promise<ProfileOperationResult> {
  return apiFetch(`/api/locations/${id}/profile`, {
    method: "POST",
    body: input,
    schema: z.object({ status: z.string(), revision: z.string().optional(), attemptId: z.string().optional(), idempotent: z.boolean().optional() }),
  })
}
