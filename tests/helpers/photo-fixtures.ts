import { createHash } from "node:crypto"

/** A PNG header (signature + IHDR) padded to `size` bytes; only the header is read. */
export function pngBytes(width: number, height: number, size = 12_000) {
  const bytes = new Uint8Array(size)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 2, 0, 0, 0], 24)
  return bytes
}

/** SOI, an APP0 segment, then a baseline start-of-frame, padded to `size`. */
export function jpegBytes(width: number, height: number, size = 12_000) {
  const bytes = new Uint8Array(size)
  const app0 = [
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1,
    0, 0,
  ]
  const sof = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    3,
  ]
  bytes.set([0xff, 0xd8], 0)
  bytes.set(app0, 2)
  bytes.set(sof, 2 + app0.length)
  return bytes
}

export const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex")
