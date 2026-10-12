/**
 * What a photo's bytes are, read from the bytes themselves (plan P09,
 * private asset storage). A client declares a file's type and size, but only
 * the bytes decide: an asset is finalised only when its magic bytes, size,
 * pixel dimensions and SHA-256 all check out (lib/server/assets.ts). Pure
 * and client-safe, so the uploader can run the same checks before sending.
 */

export const ASSET_PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png"] as const
export type AssetPhotoContentType = (typeof ASSET_PHOTO_CONTENT_TYPES)[number]

/** Google's photo limits for a listing: 10 KB to 5 MB, at least 250 x 250 pixels. */
export const ASSET_PHOTO_MIN_BYTES = 10 * 1024
export const ASSET_PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const ASSET_PHOTO_MIN_DIMENSION = 250
/** Far past any camera; refuses headers that claim absurd sizes. */
export const ASSET_PHOTO_MAX_DIMENSION = 20_000

export type SniffedImage = {
  contentType: AssetPhotoContentType
  width: number
  height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, prefix: readonly number[]) {
  return (
    bytes.length >= prefix.length &&
    prefix.every((value, index) => bytes[index] === value)
  )
}

const u16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1]
const u32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] << 24) >>> 0) +
  (bytes[at + 1] << 16) +
  (bytes[at + 2] << 8) +
  bytes[at + 3]

/** PNG: the signature, then IHDR first, which carries width and height. */
function sniffPng(bytes: Uint8Array): SniffedImage | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < 24) return null
  const ihdr = String.fromCharCode(...bytes.subarray(12, 16))
  if (ihdr !== "IHDR") return null
  return {
    contentType: "image/png",
    width: u32(bytes, 16),
    height: u32(bytes, 20),
  }
}

/** Start-of-frame markers that carry the frame's dimensions. */
const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

/**
 * JPEG: SOI, then segments until the first start-of-frame, which carries
 * height then width. Markers without a length (RSTn, TEM) are skipped; the
 * scan stops at start-of-scan, since a frame header always comes before it.
 */
function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = u16(bytes, at + 2)
    if (length < 2) return null
    if (JPEG_SOF.has(marker)) {
      if (at + 9 > bytes.length) return null
      return {
        contentType: "image/jpeg",
        height: u16(bytes, at + 5),
        width: u16(bytes, at + 7),
      }
    }
    at += 2 + length
  }
  return null
}

/** The image the bytes hold, or null when they are not a JPEG or PNG we can read. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes)
}

export type PhotoCheck =
  | { ok: true; image: SniffedImage }
  | {
      ok: false
      code:
        | "asset_type_unsupported"
        | "asset_type_mismatch"
        | "asset_size_mismatch"
        | "asset_too_small"
        | "asset_too_large"
        | "asset_dimensions_too_small"
        | "asset_dimensions_invalid"
        | "asset_sha256_mismatch"
    }

/**
 * Checks a staged photo against what its uploader declared and Google's
 * limits. `sha256` is the digest of exactly these bytes, computed by the
 * caller (the server hashes what it read, never what it was told).
 */
export function checkPhotoBytes(
  bytes: Uint8Array,
  sha256: string,
  declared: { contentType: string; byteLength: number; sha256: string }
): PhotoCheck {
  if (bytes.length !== declared.byteLength)
    return { ok: false, code: "asset_size_mismatch" }
  if (bytes.length < ASSET_PHOTO_MIN_BYTES)
    return { ok: false, code: "asset_too_small" }
  if (bytes.length > ASSET_PHOTO_MAX_BYTES)
    return { ok: false, code: "asset_too_large" }
  const image = sniffImage(bytes)
  if (!image) return { ok: false, code: "asset_type_unsupported" }
  if (image.contentType !== declared.contentType)
    return { ok: false, code: "asset_type_mismatch" }
  if (
    image.width > ASSET_PHOTO_MAX_DIMENSION ||
    image.height > ASSET_PHOTO_MAX_DIMENSION ||
    image.width < 1 ||
    image.height < 1
  )
    return { ok: false, code: "asset_dimensions_invalid" }
  if (
    image.width < ASSET_PHOTO_MIN_DIMENSION ||
    image.height < ASSET_PHOTO_MIN_DIMENSION
  )
    return { ok: false, code: "asset_dimensions_too_small" }
  if (sha256 !== declared.sha256.toLowerCase())
    return { ok: false, code: "asset_sha256_mismatch" }
  return { ok: true, image }
}
