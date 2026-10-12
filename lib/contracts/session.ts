/**
 * Wire contract for `/api/session/**` and `/api/organisations`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. The switch route
 * parses its body with `sessionSwitchSchema`; `lib/api/session.ts` and the
 * dashboard layout parse the session projection with `sessionSchema`.
 */
import { z } from "zod"

import { memberRoleSchema } from "./members"

export const workspaceModeSchema = z.enum(["business", "agency"])
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST `/api/session/switch` body. */
export const sessionSwitchSchema = z.object({ organisationId: z.uuid() })
export type SessionSwitchInput = z.infer<typeof sessionSwitchSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** The session projection the client sees (no session id or secrets). */
export const sessionSchema = z.object({
  userId: z.string(),
  organisationId: z.string(),
  organisationName: z.string(),
  displayName: z.string(),
  email: z.string(),
  role: memberRoleSchema,
  canPublish: z.boolean(),
  /** `business` hides the client layer; `agency` shows it. */
  workspaceMode: workspaceModeSchema,
  /**
   * Set only inside a support impersonation session (POST
   * /api/support/impersonation). Every other field describes the customer
   * whose identity the session carries, so without these the client cannot
   * tell an impersonated session from the customer's own and cannot render a
   * banner saying so. Optional because only that one route ever sets them.
   */
  supportActor: z.string().nullable().optional(),
  impersonationReason: z.string().nullable().optional(),
  /**
   * Opaque; changes whenever the person's security version or the
   * membership's role, publish right, location scope or grants change
   * (lib/server/session.ts `scopeFingerprintColumn`).
   * The client resets its query cache when it moves
   * (lib/queries/scope-reset.ts). Optional so a session cached before it
   * existed still parses.
   */
  scopeFingerprint: z.string().optional(),
})
export type SessionUser = z.infer<typeof sessionSchema>

/** GET `/api/session` and POST `/api/session/switch` response. */
export const sessionResponseSchema = z.object({
  session: sessionSchema.nullable(),
})
export type SessionResponse = z.infer<typeof sessionResponseSchema>

export const organisationSummarySchema = z.object({
  organisationId: z.string(),
  name: z.string(),
  role: memberRoleSchema,
})
export type OrganisationSummary = z.infer<typeof organisationSummarySchema>

/** GET `/api/organisations` response. */
export const organisationsResponseSchema = z.object({
  items: z.array(organisationSummarySchema),
})
export type OrganisationsResponse = z.infer<typeof organisationsResponseSchema>

/** The longest agency name the rename form and route accept. */
export const ORGANISATION_NAME_MAX = 120

/** PATCH `/api/organisations` body: rename the session's organisation. */
export const organisationRenameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your agency’s name.")
    .max(
      ORGANISATION_NAME_MAX,
      `Keep the name to ${ORGANISATION_NAME_MAX} characters or fewer.`
    ),
})
export type OrganisationRenameInput = z.input<typeof organisationRenameSchema>

/**
 * PATCH `/api/organisations` body: switch the session's organisation between
 * business and agency mode (owner only). Agency to business is refused while
 * more than one client is active.
 */
export const organisationModeSchema = z.object({
  workspaceMode: workspaceModeSchema,
  /**
   * Agency to business: go ahead although refiling puts locations under a
   * client with live report share links (otherwise a 409
   * `workspace_mode_report_shares` with the counts).
   */
  confirmReportShares: z.boolean().optional(),
})
export type OrganisationModeInput = z.input<typeof organisationModeSchema>

/**
 * Everything PATCH `/api/organisations` accepts: a rename or a mode change,
 * one per request. Strict, so a body carrying both is refused rather than
 * half applied.
 */
export const organisationUpdateSchema = z.union([
  organisationRenameSchema.strict(),
  organisationModeSchema.strict(),
])
export type OrganisationUpdateInput = z.input<typeof organisationUpdateSchema>

/** PATCH `/api/organisations` response to a mode change. */
export const organisationModeChangedResponseSchema = z.object({
  organisation: z.object({
    organisationId: z.string(),
    workspaceMode: workspaceModeSchema,
  }),
  /** False when the organisation was already in the requested mode. */
  changed: z.boolean(),
  /**
   * Locations filed under the home client by an agency-to-business change
   * (unassigned ones and any left under an archived client).
   */
  refiledLocations: z.number().int().nonnegative(),
})
export type OrganisationModeChangedResponse = z.infer<
  typeof organisationModeChangedResponseSchema
>

/** PATCH `/api/organisations` response to a rename. */
export const organisationRenamedResponseSchema = z.object({
  organisation: z.object({ organisationId: z.string(), name: z.string() }),
})
export type OrganisationRenamedResponse = z.infer<
  typeof organisationRenamedResponseSchema
>
