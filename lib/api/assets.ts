import {
  assetCreateResponseSchema,
  assetListResponseSchema,
  assetResponseSchema,
  type AssetView,
} from "@/lib/contracts/assets"
import {
  ASSET_PHOTO_CONTENT_TYPES,
  ASSET_PHOTO_MAX_BYTES,
  ASSET_PHOTO_MIN_BYTES,
} from "@/lib/domain/media-sniff"

import { ApiClientError, apiFetch, type RequestOptions } from "./client"

export type { AssetView }

/** The organisation's finished photo uploads, newest first (`/api/assets?status=ready`). */
export const fetchReadyAssets = (options?: RequestOptions) =>
  apiFetch("/api/assets?status=ready", {
    schema: assetListResponseSchema,
    ...options,
  }).then((result) => result.assets)

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

/**
 * What the browser can say about a file before any upload: refused here
 * when it cannot be a photo the server would accept. The server checks the
 * bytes again on finalise (lib/domain/media-sniff.ts), so this is only
 * early feedback.
 */
export function photoFileProblem(file: {
  type: string
  size: number
}): string | null {
  if (!(ASSET_PHOTO_CONTENT_TYPES as readonly string[]).includes(file.type))
    return "Choose a JPEG or PNG photo."
  if (file.size < ASSET_PHOTO_MIN_BYTES)
    return "Google requires photos to be at least 10 KB."
  if (file.size > ASSET_PHOTO_MAX_BYTES) return "Photos can be at most 5 MB."
  return null
}

/**
 * Uploads one photo as an owned asset (plan P09-R7), in the three steps of
 * lib/contracts/assets.ts: declare it (name, type, size and the SHA-256 of
 * its bytes) for a signed URL, PUT the bytes straight to private storage,
 * then finalise, where the server checks them. Resolves with the `ready`
 * asset; a refused file rejects with the server's reason.
 */
export async function uploadPhotoAsset(
  file: File,
  options: { signal?: AbortSignal } = {}
): Promise<AssetView> {
  const bytes = await file.arrayBuffer()
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes))
  const started = await apiFetch("/api/assets", {
    method: "POST",
    body: {
      fileName: file.name || "photo",
      contentType: file.type,
      byteLength: file.size,
      sha256,
    },
    schema: assetCreateResponseSchema,
    signal: options.signal,
  })
  let sent: Response
  try {
    sent = await fetch(started.upload.url, {
      method: started.upload.method,
      headers: started.upload.headers,
      body: bytes,
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof TypeError)
      throw new ApiClientError(
        0,
        "asset_upload_failed",
        "The photo couldn’t be sent to storage. Check your connection and try again."
      )
    throw error
  }
  if (!sent.ok)
    throw new ApiClientError(
      sent.status,
      "asset_upload_failed",
      "Storage didn’t accept the photo. Try again."
    )
  return apiFetch(`/api/assets/${started.asset.id}/finalise`, {
    method: "POST",
    schema: assetResponseSchema,
    signal: options.signal,
  }).then((result) => result.asset)
}
