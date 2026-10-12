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
import { googleResourceActionsSchema } from "./google-resource-actions"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const RESOURCE_CAPABILITY_STATES = [
  "available",
  "readOnly",
  "blocked",
  "unavailable",
] as const
export type ResourceCapabilityState =
  (typeof RESOURCE_CAPABILITY_STATES)[number]

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
 *   canEdit           === actionAllowed(role, grant, "edit")
 *   canRequestApproval === actionAllowed(role, grant, "request_approval") && !canPublish
 *   canDecideApproval === actionAllowed(role, grant, "decide_approval")
 * The three action flags project lib/server/permissions.ts actionAllowed, the
 * same rule requireLocationAction enforces on the post draft, approval-request
 * and approve/reject routes, so a viewer is never offered a control the
 * server refuses. The server always emits them; they are optional on the wire
 * only so older fixtures parse, and a client reads an absent flag as "not
 * known" (the server stays the authority), never as a grant it can rely on.
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
  canEdit: z.boolean().optional(),
  canRequestApproval: z.boolean().optional(),
  canDecideApproval: z.boolean().optional(),
  resources: z.record(z.string(), resourceCapabilitySchema).optional(),
  /**
   * Two-person approval of listing writes applies here (the organisation's
   * policy and its `listing_change_approvals` feature are on): a publisher's
   * Google write parks as a change request (lib/server/listing-changes.ts).
   * Also true while requests parked before the policy or feature went off
   * are still pending here, so they stay visible and decidable. Only the
   * single-location capabilities answer carries it.
   */
  listingChangeApprovals: z.boolean().optional(),
  resourceActions: googleResourceActionsSchema.optional(),
  /**
   * False while central billing enforcement holds the organisation
   * read-only (lib/server/entitlement-policy.ts); canPublish and the action
   * flags are then false too, and `resources` say `billing_read_only`.
   * canEditCanonical keeps its role meaning (it also decides whether the
   * owner/admin sections load), so editors check this first. Optional on the
   * wire so older fixtures parse; absent reads as "not known".
   */
  canWrite: z.boolean().optional(),
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
 *   canManageTeam/canManageConnections/canEditSettings === role in {owner, admin}
 *   canWrite === billing allows changes (lib/server/entitlement-policy.ts)
 *
 * The two compliance capabilities are gone with the console they gated. The
 * privacy and legal-hold routes never read them — they assert `roles:
 * ["owner"]` / `["owner", "admin"]` themselves — so nothing server-side
 * loosened when they went.
 */
export const settingsCapabilitiesSchema = z.object({
  canManageTeam: z.boolean(),
  canManageConnections: z.boolean(),
  canEditSettings: z.boolean(),
  /**
   * False while central billing enforcement holds the organisation
   * read-only; canEditSettings is then false too. Team removal and
   * disconnecting stay allowed, so the other two flags keep their role
   * meaning and the routes refuse what read-only does not allow.
   */
  canWrite: z.boolean().optional(),
})
export type SettingsCapabilities = z.infer<typeof settingsCapabilitiesSchema>

export const settingsCapabilitiesResponseSchema = z.object({
  capabilities: settingsCapabilitiesSchema,
})
export type SettingsCapabilitiesResponse = z.infer<
  typeof settingsCapabilitiesResponseSchema
>
