// Wire contract for /api/locations/[id]/profile. Client-safe: no "server-only",
// nothing from lib/server, and only type imports from lib/domain (lib/domain/
// profile.ts hashes with node:crypto, which the client bundle cannot resolve).
import { z } from "zod"

import type {
  ProfileDriftStatus,
  ProfileFieldKey,
  ProfileFieldPolicy,
} from "@/lib/domain/profile"

export type { ProfileDriftStatus, ProfileFieldKey, ProfileFieldPolicy } from "@/lib/domain/profile"

// Vocabularies. The domain's PROFILE_FIELD_KEYS value lives in the node:crypto
// module, so the tuple is restated here and pinned to the domain type both
// ways: `satisfies` rejects members the domain union does not know, and an
// omitted member fails where lib/server/profile.ts assigns its domain-typed
// fields to `ProfileState`.
export const PROFILE_FIELD_KEYS = [
  "name",
  "description",
  "phone",
  "address",
  "mapsUrl",
  "reviewUrl",
  "website",
] as const satisfies readonly ProfileFieldKey[]
export const profileFieldKeySchema = z.enum(PROFILE_FIELD_KEYS)

export const profileFieldPolicySchema = z.enum(
  ["bidirectional", "import_only", "google_read_only"] as const satisfies readonly ProfileFieldPolicy[]
)

export const profileDriftStatusSchema = z.enum(
  ["in_sync", "core_dirty", "google_dirty", "conflict"] as const satisfies readonly ProfileDriftStatus[]
)

const revisionSchema = z.string().regex(/^\d+$/)
const hashSchema = z.string().length(64)

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const saveProfileBodySchema = z.object({
  expectedCanonicalRevision: revisionSchema,
  values: z.object({
    name: z.string().max(255).nullable().optional(),
    description: z.string().max(750).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    website: z.url().max(2048).nullable().optional(),
  }),
})
export type SaveProfileInput = z.input<typeof saveProfileBodySchema>

export const profileOperationDirectionSchema = z.enum(["to_google", "from_google"])
export type ProfileOperationDirection = z.infer<typeof profileOperationDirectionSchema>

/** The confirmation phrase each direction requires. */
export const PROFILE_OPERATION_CONFIRMATIONS = {
  to_google: "publish_nabapresence_profile_to_google",
  from_google: "import_google_profile_to_nabapresence",
} as const satisfies Record<ProfileOperationDirection, string>

export const profileOperationBodySchema = z.object({
  direction: profileOperationDirectionSchema,
  confirmation: z.enum([
    PROFILE_OPERATION_CONFIRMATIONS.to_google,
    PROFILE_OPERATION_CONFIRMATIONS.from_google,
  ]),
  selectedFields: z.array(profileFieldKeySchema).min(1),
  expectedCanonicalRevision: revisionSchema,
  expectedCanonicalHash: hashSchema,
  expectedGoogleHash: hashSchema,
  confirmOverwriteGoogleChanges: z.boolean().default(false),
  confirmOverwriteCanonicalChanges: z.boolean().default(false),
})
export type ProfileOperationInput = z.input<typeof profileOperationBodySchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const profileFieldSchema = z.object({
  key: profileFieldKeySchema,
  policy: profileFieldPolicySchema,
  status: profileDriftStatusSchema,
  canonicalValue: z.string().nullable(),
  googleValue: z.string().nullable(),
  canonicalHash: z.string(),
  googleHash: z.string(),
  lastReconciledAt: z.string().nullable(),
})
export type ProfileField = z.infer<typeof profileFieldSchema>

export const profileStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  canonicalHash: z.string(),
  googleHash: z.string(),
  canPublish: z.boolean(),
  googleWritesEnabled: z.boolean(),
  fields: z.array(profileFieldSchema),
  googleDetails: z.object({ primaryCategory: z.string().nullable(), additionalCategories: z.array(z.string()) }),
  latestAttempt: z.object({
    id: z.string(),
    direction: z.string(),
    status: z.string(),
    selectedFields: z.array(z.string()),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
  }).nullable(),
})
export type ProfileState = z.infer<typeof profileStateSchema>

export const profileResponseSchema = z.object({ profile: profileStateSchema })
export type ProfileResponse = z.infer<typeof profileResponseSchema>

export const saveProfileResponseSchema = z.object({ saved: z.literal(true), revision: z.string() })
export type SaveProfileResponse = z.infer<typeof saveProfileResponseSchema>

export const profileOperationResponseSchema = z.object({
  status: z.enum(["imported", "published"]),
  revision: z.string().optional(),
  attemptId: z.string().optional(),
  idempotent: z.boolean().optional(),
})
export type ProfileOperationResponse = z.infer<typeof profileOperationResponseSchema>
