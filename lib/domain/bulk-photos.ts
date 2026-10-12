/**
 * Bulk photos (plan P09-R7): one owned, immutable photo asset added to each
 * selected listing as a new photo. Client-safe and pure.
 *
 * One change carries one asset, so each listing's child sends exactly one
 * create. A batch holds at most 10 photo changes, which is the plan's limit
 * of 10 new photos per listing per batch, and names each asset once.
 */
import { z } from "zod"

/** Plan P09: at most 10 new photos per listing in one batch. */
export const BULK_MAX_NEW_PHOTOS_PER_LOCATION = 10

/**
 * The categories a new bulk photo may take. Cover and profile are left
 * out: each is one slot per listing, so adding to it replaces that
 * listing's own cover or profile photo rather than adding a photo, which is
 * a per-listing decision.
 */
export const BULK_PHOTO_CATEGORIES = [
  "LOGO",
  "EXTERIOR",
  "INTERIOR",
  "PRODUCT",
  "AT_WORK",
  "FOOD_AND_DRINK",
  "MENU",
  "COMMON_AREA",
  "ROOMS",
  "TEAMS",
  "ADDITIONAL",
] as const
export type BulkPhotoCategory = (typeof BULK_PHOTO_CATEGORIES)[number]

export const bulkPhotoInputSchema = z.strictObject({
  operation: z.literal("photos"),
  /** A `ready` asset of the organisation (`/api/assets`). */
  assetId: z.uuid(),
  category: z.enum(BULK_PHOTO_CATEGORIES),
  description: z.string().trim().max(1500).optional(),
})
export type BulkPhotoInput = z.infer<typeof bulkPhotoInputSchema>

/** What a photo child freezes as the value it sends (its `proposedValue`). */
export type BulkPhotoProposed = {
  assetId: string
  sha256: string
  contentType: string
  byteLength: number
  width: number
  height: number
  fileName: string
  category: BulkPhotoCategory
  description: string | null
}

/** What a photo child freezes as the listing's current state. */
export type BulkPhotoCurrent = {
  /** This asset's earlier publication here, when Google no longer shows it. */
  previousMediaName: string | null
}
