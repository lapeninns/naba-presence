/**
 * Wire contract for owned photo assets (`/api/assets/**`, plan P09-R7).
 * Client-safe.
 *
 * Upload is three steps, so no photo ever passes through a route's body:
 *   1. POST /api/assets with what the file is (name, type, size, SHA-256):
 *      a staging asset and a signed URL for exactly one staging object.
 *   2. The browser PUTs the bytes to that URL.
 *   3. POST /api/assets/{id}/finalise: the server reads the staged bytes,
 *      checks them (lib/domain/media-sniff.ts) and writes them once to the
 *      asset's immutable key. Only a `ready` asset can be used.
 */
import { z } from "zod"

import {
  ASSET_PHOTO_CONTENT_TYPES,
  ASSET_PHOTO_MAX_BYTES,
  ASSET_PHOTO_MIN_BYTES,
} from "@/lib/domain/media-sniff"

export const ASSET_STATUSES = [
  "staging",
  "ready",
  "rejected",
  "purged",
] as const

export const assetCreateRequestSchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(ASSET_PHOTO_CONTENT_TYPES),
  byteLength: z
    .number()
    .int()
    .min(ASSET_PHOTO_MIN_BYTES, "Google requires photos to be at least 10 KB.")
    .max(ASSET_PHOTO_MAX_BYTES, "Photos can be at most 5 MB."),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .transform((value) => value.toLowerCase()),
})
export type AssetCreateRequest = z.infer<typeof assetCreateRequestSchema>

export const assetSchema = z.object({
  id: z.uuid(),
  status: z.enum(ASSET_STATUSES),
  mediaFormat: z.literal("PHOTO"),
  fileName: z.string(),
  contentType: z.string(),
  byteLength: z.number().int(),
  sha256: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  rejectionCode: z.string().nullable(),
  stagingExpiresAt: z.iso.datetime(),
  finalisedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type AssetView = z.infer<typeof assetSchema>

export const assetCreateResponseSchema = z.object({
  asset: assetSchema,
  /** Send the file's bytes here, once, with these headers. */
  upload: z.object({
    url: z.string(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
  }),
})
export const assetResponseSchema = z.object({ asset: assetSchema })
export const assetListResponseSchema = z.object({
  assets: z.array(assetSchema),
})
export const assetListQuerySchema = z.object({
  status: z.enum(ASSET_STATUSES).optional(),
})
