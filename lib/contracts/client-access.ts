/**
 * Wire contract for `/api/members/[userId]/client-access`: which clients a
 * member or viewer can see, edited a client at a time.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. There is no client
 * membership table behind this. Access is still location_member rows
 * (lib/server/permissions.ts); a client here is shorthand for "every listing
 * filed under it", expanded by the server when the change is saved.
 */
import { z } from "zod"

import { memberRoleSchema } from "./members"

/**
 * The pseudo-client for listings nobody has filed under a client yet. It is
 * offered alongside real clients so a scoped member can still be given them;
 * it is a snapshot (see lib/server/client-access.ts), never a real row.
 */
export const UNFILED_CLIENT_ID = "unfiled" as const
export const UNFILED_CLIENT_NAME = "Unfiled listings"

const clientRefSchema = z.union([z.uuid(), z.literal(UNFILED_CLIENT_ID)])

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const clientAccessParamsSchema = z.object({ userId: z.uuid() })

/**
 * One client in "Only these clients".
 *
 * `listings: "all"` grants every listing filed under the client now.
 * `listings: "unchanged"` keeps whichever of the client's listings the
 * member already holds, exactly as they are: the per-listing grants made
 * before access was managed by client, which Team shows as "some listings"
 * and must not quietly widen or drop. `canPublish` applies to every granted
 * row; left out it means "Drafts only" for `all` and "as they are" for
 * `unchanged`.
 */
export const clientAccessEntrySchema = z.strictObject({
  clientId: clientRefSchema,
  listings: z.enum(["all", "unchanged"]).default("all"),
  canPublish: z.boolean().optional(),
})
export type ClientAccessEntry = z.input<typeof clientAccessEntrySchema>

/**
 * PUT body. "All clients" is its own explicit shape, never an empty list:
 * a member with no listings sees every client, so an empty `clients` array
 * is refused rather than read as "everything" (see planClientAccess).
 */
export const clientAccessUpdateSchema = z.union([
  z.strictObject({ allClients: z.literal(true) }),
  z.strictObject({ clients: z.array(clientAccessEntrySchema).max(500) }),
])
export type ClientAccessUpdateInput = z.input<typeof clientAccessUpdateSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const clientPublishingSchema = z.enum(["all", "some", "none"])
export type ClientPublishing = z.infer<typeof clientPublishingSchema>

/** One client (or the unfiled group) and how much of it the member holds. */
export const clientAccessRowSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  archived: z.boolean(),
  /** Listings filed under the client now. */
  total: z.number().int().nonnegative(),
  /** How many of those the member holds a location_member row for. */
  granted: z.number().int().nonnegative(),
  /** Across the granted rows: all, some or none can publish. */
  publishing: clientPublishingSchema,
})
export type ClientAccessRow = z.infer<typeof clientAccessRowSchema>

/** GET and PUT response. */
export const clientAccessResponseSchema = z.object({
  userId: z.string(),
  role: memberRoleSchema,
  /** No location_member rows: every client, including ones added later. */
  allClients: z.boolean(),
  clients: z.array(clientAccessRowSchema),
})
export type ClientAccessResponse = z.infer<typeof clientAccessResponseSchema>
