/**
 * Wire contract for `/api/clients`: the agency's client list, one client's
 * detail, assignment of locations, and the derived setup state that drives
 * the onboarding wizard.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the
 * routes, `lib/api/clients.ts`, `lib/server/clients.ts` and the hooks.
 */
import { z } from "zod"

import { CLIENT_HEALTH } from "@/lib/clients/health"
import { directoryRowSchema } from "@/lib/contracts/location-links"

export const clientHealthSchema = z.enum(CLIENT_HEALTH)

/** Hex only; the value is rendered into an avatar chip. */
const colourSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, for example #1F6F78")

export const clientSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  colour: z.string().nullable(),
  logoUrl: z.string().nullable(),
  notes: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Client = z.infer<typeof clientSchema>

/** One Google login behind a client, with enough state to offer a reconnect. */
export const clientConnectionSchema = z.object({
  id: z.string(),
  googleEmail: z.string().nullable(),
  status: z.enum(["active", "expired", "revoked", "error", "disconnected"]),
  reconnectRequired: z.boolean(),
  lastRefreshAt: z.string().nullable(),
})
export type ClientConnection = z.infer<typeof clientConnectionSchema>

export const clientSummarySchema = clientSchema.extend({
  locationCount: z.number().int().nonnegative(),
  linkedCount: z.number().int().nonnegative(),
  verifiedCount: z.number().int().nonnegative(),
  health: clientHealthSchema,
  connections: z.array(clientConnectionSchema),
  openWork: z.object({
    needsReply: z.number().int().nonnegative(),
    awaitingApproval: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  backfill: z.object({
    running: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    notStarted: z.number().int().nonnegative(),
  }),
  lastSyncAt: z.string().nullable(),
})
export type ClientSummary = z.infer<typeof clientSummarySchema>

export const clientsResponseSchema = z.object({
  items: z.array(clientSummarySchema),
  /**
   * Locations imported from Google that no one has filed under a client yet.
   * Shown as their own group rather than as a placeholder client, because a
   * fake client row would end up in filters and reports.
   */
  unassignedLocationCount: z.number().int().nonnegative(),
})
export type ClientsResponse = z.infer<typeof clientsResponseSchema>

export const clientResponseSchema = z.object({
  client: clientSummarySchema,
  locations: z.array(directoryRowSchema),
})
export type ClientResponse = z.infer<typeof clientResponseSchema>

export const clientCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the client a name").max(120),
  colour: colourSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
})
export type ClientCreateInput = z.infer<typeof clientCreateSchema>

export const clientUpdateSchema = z
  .object({
    name: z.string().trim().min(1, "Give the client a name").max(120).optional(),
    colour: colourSchema.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
    /**
     * Archiving a client that still holds locations detaches them rather than
     * failing, but only when the caller says so — otherwise a stray archive
     * would silently orphan a listing.
     */
    detachLocations: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to change",
  })
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>

export const clientAssignLocationsSchema = z.object({
  locationIds: z.array(z.uuid()).min(1).max(200),
  /**
   * Also grant the client's existing members access to the newly assigned
   * locations. Defaults on: an operator who assigns a location to a client
   * means "this belongs to that client", and a teammate who can see every
   * other location of the client but not this one is a support ticket.
   */
  grantToClientMembers: z.boolean().default(true),
})
export type ClientAssignLocationsInput = z.infer<typeof clientAssignLocationsSchema>

export const clientIdParamsSchema = z.object({ clientId: z.uuid() })

// ---------------------------------------------------------------------------
// Setup state
// ---------------------------------------------------------------------------

export const SETUP_STEPS = [
  "agency",
  "client",
  "connect",
  "account",
  "locations",
  "backfill",
  "notifications",
  "team",
  "done",
] as const
export const setupStepSchema = z.enum(SETUP_STEPS)
export type SetupStep = (typeof SETUP_STEPS)[number]

/**
 * Everything the wizard needs, DERIVED from what exists. Nothing about the
 * user's progress is stored, so refresh, back, and picking the flow up
 * tomorrow all land on the same step.
 */
export const clientSetupSchema = z.object({
  clientId: z.string(),
  hasClient: z.literal(true),
  connection: z
    .object({ id: z.string(), status: clientConnectionSchema.shape.status })
    .nullable(),
  accountsActive: z.number().int().nonnegative(),
  locationsLinked: z.number().int().nonnegative(),
  backfill: z.enum(["not_started", "running", "done", "failed"]),
  notificationsEnabled: z.boolean(),
  teamInvited: z.boolean(),
  nextStep: setupStepSchema,
})
export type ClientSetup = z.infer<typeof clientSetupSchema>
export const clientSetupResponseSchema = z.object({ setup: clientSetupSchema })
export type ClientSetupResponse = z.infer<typeof clientSetupResponseSchema>

/**
 * The one place the step order lives. Both the wizard's stepper and the
 * server's `nextStep` read it, so they cannot disagree about what "next" is.
 */
export function nextIncompleteStep(
  setup: Omit<ClientSetup, "nextStep" | "clientId" | "hasClient">
): SetupStep {
  if (!setup.connection || setup.connection.status !== "active") return "connect"
  if (setup.accountsActive === 0) return "account"
  if (setup.locationsLinked === 0) return "locations"
  if (setup.backfill === "not_started" || setup.backfill === "failed") return "backfill"
  if (!setup.notificationsEnabled) return "notifications"
  if (!setup.teamInvited) return "team"
  return "done"
}
