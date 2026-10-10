/**
 * Wire contract for `/api/locations/[id]/media/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the
 * routes (request/query schemas), `lib/api/location-media.ts` (response
 * schemas) and `lib/server/media.ts` (row types).
 */
import { z } from "zod"

import { httpUrl } from "@/lib/contracts/http-url"
import { GOOGLE_MEDIA_CATEGORIES } from "@/lib/domain/google-contract"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const MEDIA_FORMATS = ["PHOTO", "VIDEO"] as const
export type MediaFormat = (typeof MEDIA_FORMATS)[number]

export const MEDIA_OWNERSHIPS = ["merchant", "customer"] as const
export type MediaOwnership = (typeof MEDIA_OWNERSHIPS)[number]

export const MAX_MEDIA_UPLOAD_BYTES = 75 * 1024 * 1024
/** Google refuses photos under 10 KB; the upload route checks the same. */
export const MIN_PHOTO_UPLOAD_BYTES = 10 * 1024

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** GET `/media` query (`page`/`pageSize` arrive as strings). */
export const mediaListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
  refresh: z.literal("1").optional(),
  category: z.enum(GOOGLE_MEDIA_CATEGORIES).optional(),
  ownership: z.enum(MEDIA_OWNERSHIPS).optional(),
})
export type MediaListQuery = z.infer<typeof mediaListQuerySchema>

/** Create-from-URL fields (the JSON branch of POST `/media`). */
export const mediaCreateSchema = z.object({
  mediaFormat: z.enum(MEDIA_FORMATS),
  category: z.enum(GOOGLE_MEDIA_CATEGORIES),
  sourceUrl: httpUrl(),
  description: z.string().trim().max(1500).optional(),
})
export type MediaCreateInput = z.infer<typeof mediaCreateSchema>

/** POST `/media` JSON body. */
export const mediaCreateRequestSchema = mediaCreateSchema.extend({
  confirmation: z.literal("create_google_media"),
})
export type MediaCreateRequest = z.infer<typeof mediaCreateRequestSchema>

/** The non-file fields of the multipart branch of POST `/media`. */
export const mediaUploadFieldsSchema = z.object({
  mediaFormat: z.enum(MEDIA_FORMATS),
  category: z.enum(GOOGLE_MEDIA_CATEGORIES),
  description: z.string().trim().max(1500).optional(),
  confirmation: z.literal("create_google_media"),
})
export type MediaUploadFields = z.infer<typeof mediaUploadFieldsSchema>

const expectedGoogleHash = z.string().length(64)

/** PATCH `/media/[mediaId]` body. */
export const mediaUpdateRequestSchema = z.object({
  category: z.enum(GOOGLE_MEDIA_CATEGORIES),
  expectedGoogleHash,
  confirmation: z.literal("update_google_media"),
})
export type MediaUpdateRequest = z.infer<typeof mediaUpdateRequestSchema>

/** DELETE `/media/[mediaId]` body. */
export const mediaDeleteRequestSchema = z.object({
  expectedGoogleHash,
  confirmation: z.literal("delete_google_media"),
})
export type MediaDeleteRequest = z.infer<typeof mediaDeleteRequestSchema>

/**
 * A person's verdict on a create Google never confirmed: `adopted` -- it is
 * on Google; `abandoned` -- it is not, so it may be added again.
 */
export const MEDIA_RESOLUTIONS = ["adopted", "abandoned"] as const
export type MediaResolution = (typeof MEDIA_RESOLUTIONS)[number]

/** POST `/media/resolutions/[attemptId]` body. */
export const mediaResolveRequestSchema = z.object({
  resolution: z.enum(MEDIA_RESOLUTIONS),
  confirmation: z.literal("resolve_google_media"),
})
export type MediaResolveRequest = z.infer<typeof mediaResolveRequestSchema>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/**
 * A create whose outcome is unknown and that no single live media item
 * accounts for (`needs_resolution`, or sent and not yet reconciled). Another
 * create of the same content is refused (409 `media_needs_resolution`) until
 * a person resolves it.
 */
export const mediaUnresolvedCreateSchema = z.object({
  attemptId: z.string(),
  mediaFormat: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  /** Set for an upload. */
  fileName: z.string().nullable(),
  /** Set for a create from a URL. */
  sourceUrl: z.string().nullable(),
  startedAt: z.string(),
})
export type MediaUnresolvedCreateWire = z.input<
  typeof mediaUnresolvedCreateSchema
>
export type MediaUnresolvedCreate = z.output<
  typeof mediaUnresolvedCreateSchema
>

/**
 * One `gbp_media_item` row. Google leaves customer photos uncategorised; the
 * server sends `category: null` and the client reads it as `ADDITIONAL`, so
 * `MediaItemWire` (what the route emits) and `MediaItem` (what the client
 * holds) differ only there.
 */
export const mediaItemSchema = z.object({
  id: z.string(),
  googleMediaName: z.string(),
  ownership: z.enum(MEDIA_OWNERSHIPS),
  mediaFormat: z.string(),
  category: z
    .string()
    .nullable()
    .transform((category) => category ?? "ADDITIONAL"),
  sourceUrl: z.string().nullable(),
  googleUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  description: z.string().nullable(),
  attribution: z.unknown(),
  dimensions: z.unknown(),
  insights: z.unknown(),
  googleHash: z.string(),
  createTime: z.string().nullable(),
})
export type MediaItemWire = z.input<typeof mediaItemSchema>
export type MediaItem = z.output<typeof mediaItemSchema>

/** One page of the location's media plus the write gates. */
export const mediaStateSchema = z.object({
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  categories: z.array(z.enum(GOOGLE_MEDIA_CATEGORIES)).readonly(),
  items: z.array(mediaItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  category: z.string().nullable().optional(),
  ownership: z.enum(MEDIA_OWNERSHIPS).nullable().optional(),
  unresolvedCreates: z.array(mediaUnresolvedCreateSchema).default([]),
})
export type MediaStateWire = z.input<typeof mediaStateSchema>
export type MediaState = z.output<typeof mediaStateSchema>

/** GET `/media`. */
export const mediaListResponseSchema = z.object({ media: mediaStateSchema })
export type MediaListResponseWire = z.input<typeof mediaListResponseSchema>
export type MediaListResponse = z.output<typeof mediaListResponseSchema>

/** POST (201) / PATCH / DELETE outcome: the attempt row. */
export const mediaMutationOutcomeSchema = z.object({
  id: z.string(),
  status: z.string(),
  idempotent: z.boolean(),
})
export type MediaMutationOutcome = z.infer<typeof mediaMutationOutcomeSchema>
