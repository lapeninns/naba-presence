/**
 * Wire contract for GET `/api/locations/[id]/summary` and
 * GET `/api/listings/summary`.
 *
 * The listing's state without opening any editor. DB-only on the server:
 * local edits versus the last published baseline are exact, Google-side
 * drift is as of the last observation (`observedAt`), and nothing here ever
 * calls Google. Client-safe: no `server-only`, no `lib/server` imports.
 */
import { z } from "zod"

export const SYNC_STATUSES = [
  "in_sync",
  "core_dirty",
  "google_dirty",
  "conflict",
  "unknown",
] as const
export type SyncStatus = (typeof SYNC_STATUSES)[number]

/** A canonical-copy area: profile, hours, menu. */
export const syncedAreaSchema = z.object({
  status: z.enum(SYNC_STATUSES),
  /** Fields (profile) or 1/0 (hours, menu) with local edits not on Google. */
  dirtyCount: z.number().int().nonnegative(),
  /** When Google's side was last read, ISO 8601, or null if never. */
  observedAt: z.string().nullable(),
})
export type SyncedArea = z.infer<typeof syncedAreaSchema>

/** A Google-direct area: its cached snapshot count. */
export const directAreaSchema = z.object({
  count: z.number().int().nonnegative(),
  observedAt: z.string().nullable(),
})
export type DirectArea = z.infer<typeof directAreaSchema>

export const lastPublishSchema = z.object({
  at: z.string(),
  status: z.enum(["succeeded", "failed", "ambiguous", "in_progress"]),
  /** In the summary's own words: profile, hours, menu, photos, booking, posts, listing. */
  area: z.string(),
})
export type LastPublish = z.infer<typeof lastPublishSchema>

export const listingSummarySchema = z.object({
  locationId: z.string(),
  linked: z.boolean(),
  verified: z.boolean(),
  connection: z
    .object({
      status: z.enum(["active", "expired", "revoked", "error", "disconnected"]),
      reconnectRequired: z.boolean(),
      googleEmail: z.string().nullable(),
    })
    .nullable(),
  profile: syncedAreaSchema,
  hours: syncedAreaSchema,
  menu: syncedAreaSchema.extend({ eligible: z.boolean().nullable() }),
  booking: directAreaSchema,
  photos: directAreaSchema,
  posts: z.object({
    drafts: z.number().int().nonnegative(),
    awaitingApproval: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
  }),
  suggestions: z.object({
    profile: z.number().int().nonnegative(),
    foodMenus: z.number().int().nonnegative(),
  }),
  lastPublish: lastPublishSchema.nullable(),
})
export type ListingSummary = z.infer<typeof listingSummarySchema>

export const listingSummaryResponseSchema = z.object({
  summary: listingSummarySchema,
})
export type ListingSummaryResponse = z.infer<
  typeof listingSummaryResponseSchema
>

export const listingSummariesResponseSchema = z.object({
  summaries: z.array(listingSummarySchema),
})
export type ListingSummariesResponse = z.infer<
  typeof listingSummariesResponseSchema
>

/** A summary for a listing nothing has been observed for yet. */
export function emptyListingSummary(input: {
  locationId: string
  linked: boolean
  verified: boolean
}): ListingSummary {
  const unknown: SyncedArea = {
    status: "unknown",
    dirtyCount: 0,
    observedAt: null,
  }
  return {
    locationId: input.locationId,
    linked: input.linked,
    verified: input.verified,
    connection: null,
    profile: unknown,
    hours: unknown,
    menu: { ...unknown, eligible: null },
    booking: { count: 0, observedAt: null },
    photos: { count: 0, observedAt: null },
    posts: { drafts: 0, awaitingApproval: 0, failed: 0, published: 0 },
    suggestions: { profile: 0, foodMenus: 0 },
    lastPublish: null,
  }
}
