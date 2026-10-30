import { z } from "zod"

/**
 * The review link API's wire shapes, shared by the route handlers and the
 * area page (`/api/locations/[id]/review-link`, `.../review-link/stats`).
 */

export const reviewLinkParamsSchema = z.object({ id: z.uuid() })

export const reviewLinkSchema = z.object({
  id: z.string(),
  code: z.string(),
  /** The link to share: `/r/<code>` on the app's origin. */
  url: z.string(),
  /** What the QR code encodes: the same link, marked as a scan. */
  qrUrl: z.string(),
  /** The operator's caption, or null for the default. */
  caption: z.string().nullable(),
  /** Google's review form the link redirects to. */
  targetUri: z.string(),
  status: z.enum(["live", "off"]),
  createdAt: z.string(),
  rotatedAt: z.string().nullable(),
  disabledAt: z.string().nullable(),
})
export type ReviewLink = z.infer<typeof reviewLinkSchema>

export const reviewLinkStateSchema = z.object({
  link: reviewLinkSchema.nullable(),
  /**
   * Google's review form from the last stored read of the listing, or null
   * when Google hasn't given one (or nothing has been read yet).
   */
  googleTarget: z.string().nullable(),
  /** The link points somewhere other than Google's current review form. */
  targetChanged: z.boolean(),
  /** Whether this person may create, rotate, switch off or caption it. */
  canManage: z.boolean(),
})
export type ReviewLinkState = z.infer<typeof reviewLinkStateSchema>

export const reviewLinkResponseSchema = z.object({
  reviewLink: reviewLinkStateSchema,
})
export type ReviewLinkResponse = z.infer<typeof reviewLinkResponseSchema>

/** Generous on the wire; the caption rule enforces the real limit. */
const captionInput = z.string().max(500).nullable()

export const reviewLinkCreateSchema = z.object({
  caption: captionInput.optional(),
})
export type ReviewLinkCreate = z.infer<typeof reviewLinkCreateSchema>

export const reviewLinkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rotate") }),
  z.object({ action: z.literal("disable") }),
  z.object({ action: z.literal("enable") }),
  z.object({ action: z.literal("sync_target") }),
  z.object({ action: z.literal("caption"), caption: captionInput }),
])
export type ReviewLinkAction = z.infer<typeof reviewLinkActionSchema>

export const reviewLinkStatsQuerySchema = z.object({
  days: z.enum(["30", "90"]).optional(),
})

const reviewLinkDaySchema = z.object({
  date: z.string(),
  clicks: z.number().int(),
  qrClicks: z.number().int(),
  newReviews: z.number().int(),
})

export const reviewLinkStatsSchema = z.object({
  days: z.union([z.literal(30), z.literal(90)]),
  /** The venue's time zone: the days are its calendar days. */
  timeZone: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  series: z.array(reviewLinkDaySchema),
  totals: z.object({
    clicks: z.number().int(),
    qrClicks: z.number().int(),
    newReviews: z.number().int(),
  }),
})
export type ReviewLinkStats = z.infer<typeof reviewLinkStatsSchema>

export const reviewLinkStatsResponseSchema = z.object({
  stats: reviewLinkStatsSchema,
})
export type ReviewLinkStatsResponse = z.infer<
  typeof reviewLinkStatsResponseSchema
>
