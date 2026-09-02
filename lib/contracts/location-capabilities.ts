/**
 * Wire contract for GET `/api/locations/[id]/capabilities` and
 * GET `/api/settings/capabilities`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the
 * routes (response types), `lib/api/locations.ts` /
 * `lib/api/settings-capabilities.ts` (response schemas),
 * `lib/server/capabilities.ts` (the projection types) and the pure gating
 * evaluators in `lib/locations/gating.ts`.
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const RESOURCE_CAPABILITY_STATES = [
  "available",
  "readOnly",
  "blocked",
  "unavailable",
] as const
export type ResourceCapabilityState = (typeof RESOURCE_CAPABILITY_STATES)[number]

/** The per-surface keys the server always emits under `resources`. */
export const LOCATION_RESOURCE_KEYS = [
  "profile",
  "hours",
  "businessInformation",
  "photos",
  "posts",
  "menu",
  "booking",
  "performance",
  "industry",
  "administration",
] as const
export type LocationResourceKey = (typeof LOCATION_RESOURCE_KEYS)[number]

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const resourceCapabilitySchema = z.object({
  state: z.enum(RESOURCE_CAPABILITY_STATES),
  reasonCode: z.string().optional(),
})
export type ResourceCapability = z.infer<typeof resourceCapabilitySchema>

/**
 * Per-location capabilities for the Locations workspace (spec §3):
 *   canEditCanonical === role in {owner, admin}  (the canonical-PUT route gate)
 *   canPublish        === canPublishLocation(sql, session, locationId)
 *   resources         === per-surface availability for UI gating
 *
 * `resources` is always emitted by the server, keyed by `LocationResourceKey`.
 * It is typed with string keys and optional deliberately: the gating
 * evaluators (lib/locations/gating.ts) look up arbitrary `resourceKey`
 * strings, and several tabs feed them a `{ canEditCanonical, canPublish }`
 * pair derived from their own resource payload — an absent map reads as "no
 * per-resource state", so the plain publish gates apply.
 */
export const locationCapabilitiesSchema = z.object({
  canEditCanonical: z.boolean(),
  canPublish: z.boolean(),
  resources: z.record(z.string(), resourceCapabilitySchema).optional(),
})
export type LocationCapabilities = z.infer<typeof locationCapabilitiesSchema>

export const locationCapabilitiesResponseSchema = z.object({
  capabilities: locationCapabilitiesSchema,
})
export type LocationCapabilitiesResponse = z.infer<
  typeof locationCapabilitiesResponseSchema
>

/**
 * Org/settings capabilities for the Settings workspace (spec §3):
 *   canManageTeam/canManageConnections/canEditSettings/canViewCompliance
 *     === role in {owner, admin}
 *   canManageCompliance === role === "owner"
 */
export const settingsCapabilitiesSchema = z.object({
  canManageTeam: z.boolean(),
  canManageConnections: z.boolean(),
  canEditSettings: z.boolean(),
  canViewCompliance: z.boolean(),
  canManageCompliance: z.boolean(),
})
export type SettingsCapabilities = z.infer<typeof settingsCapabilitiesSchema>

export const settingsCapabilitiesResponseSchema = z.object({
  capabilities: settingsCapabilitiesSchema,
})
export type SettingsCapabilitiesResponse = z.infer<
  typeof settingsCapabilitiesResponseSchema
>
