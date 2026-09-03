/**
 * Wire contract for `/api/location-links`: the role-scoped location
 * directory (GET, default and `?view=management`), linking a Google location
 * (POST) and unlinking one (DELETE).
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the route
 * (body/query schemas, response types), `lib/api/locations.ts` /
 * `lib/api/location-links.ts` (response schemas),
 * `lib/server/location-directory.ts` (the row type its query selects) and the
 * pure projections in `lib/locations/directory.ts`.
 */
import { z } from "zod"

// ---------------------------------------------------------------------------
// Directory (GET)
// ---------------------------------------------------------------------------

/**
 * The directory row exactly as `lib/server/location-directory.ts` selects it.
 * `?view=management` (owner/admin only) returns these rows verbatim, so the
 * management-view entry IS the row.
 */
export const directoryRowSchema = z.object({
  locationId: z.string(),
  name: z.string(),
  /** `location.address_json` — arbitrary JSON, or null. */
  address: z.unknown(),
  timezone: z.string(),
  linkId: z.string().nullable(),
  externalLocationId: z.string().nullable(),
  googleLocationName: z.string().nullable(),
  googleTitle: z.string().nullable(),
  verified: z.boolean().nullable(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
})
export type DirectoryRow = z.infer<typeof directoryRowSchema>

export const managementLocationSchema = directoryRowSchema
export type ManagementLocation = DirectoryRow

export const managementLocationsResponseSchema = z.object({
  locations: z.array(managementLocationSchema),
})
export type ManagementLocationsResponse = z.infer<
  typeof managementLocationsResponseSchema
>

/**
 * The default-view entry every role receives. The schema strips
 * `googleLocationName` even when present (owner/admin only) — nothing on this
 * path needs it.
 *
 * `linked` is REQUIRED, not optional, and that is load-bearing: primary
 * location resolution ranks linked locations first, and if this payload could
 * silently omit the field, a member/viewer would resolve a different primary
 * than an owner on the same org with no type error to catch it.
 */
export const locationEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  linked: z.boolean(),
  // Which client a location belongs to is not privileged information: a
  // member who can see the location can see whose it is, and the inbox rail
  // groups by it for every role.
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
})
export type LocationEntry = z.infer<typeof locationEntrySchema>

export const locationsResponseSchema = z.object({
  locations: z.array(locationEntrySchema),
})
export type LocationsResponse = z.infer<typeof locationsResponseSchema>

// ---------------------------------------------------------------------------
// Link (POST) / unlink (DELETE)
// ---------------------------------------------------------------------------

/** POST `/api/location-links` body. */
export const linkLocationRequestSchema = z.object({
  externalLocationId: z.uuid(),
  locationId: z.uuid().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  timezone: z.string().trim().min(1).max(80).default("Europe/London"),
  confirmRelink: z.boolean().default(false),
})
export type LinkLocationRequest = z.infer<typeof linkLocationRequestSchema>
/** What the client sends (defaults still unapplied). */
export type LinkLocationInput = z.input<typeof linkLocationRequestSchema>

/**
 * DELETE `/api/location-links?externalLocationId=` — parsed as a bare uuid
 * (not an object schema) so a missing/invalid value keeps producing the
 * `_root` field error the old handler emitted.
 */
export const unlinkLocationQuerySchema = z.uuid()

export const locationLinkSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  externalLocationId: z.string(),
  isActive: z.boolean(),
})
export type LocationLink = z.infer<typeof locationLinkSchema>

export const linkLocationResponseSchema = z.object({ link: locationLinkSchema })
export type LinkLocationResponse = z.infer<typeof linkLocationResponseSchema>

export const unlinkLocationResponseSchema = z.object({
  unlinked: z.literal(true),
})
export type UnlinkLocationResponse = z.infer<typeof unlinkLocationResponseSchema>
