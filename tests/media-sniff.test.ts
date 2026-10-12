import { describe, expect, it } from "vitest"

import { checkPhotoBytes, sniffImage } from "@/lib/domain/media-sniff"
import { jpegBytes, pngBytes, sha256Hex } from "./helpers/photo-fixtures"

const declared = (bytes: Uint8Array, contentType: string) => ({
  contentType,
  byteLength: bytes.length,
  sha256: sha256Hex(bytes),
})

describe("media sniffing (P09-R7)", () => {
  it("reads PNG and JPEG types and dimensions from the bytes", () => {
    expect(sniffImage(pngBytes(800, 600))).toEqual({
      contentType: "image/png",
      width: 800,
      height: 600,
    })
    expect(sniffImage(jpegBytes(1200, 900))).toEqual({
      contentType: "image/jpeg",
      width: 1200,
      height: 900,
    })
    expect(sniffImage(new TextEncoder().encode("<svg></svg>"))).toBeNull()
    // A JPEG that reaches start-of-scan without a frame header is unreadable.
    const noFrame = new Uint8Array(20)
    noFrame.set([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04])
    expect(sniffImage(noFrame)).toBeNull()
  })

  it("accepts bytes that match what was declared", () => {
    const bytes = pngBytes(800, 600)
    expect(
      checkPhotoBytes(bytes, sha256Hex(bytes), declared(bytes, "image/png"))
    ).toEqual({
      ok: true,
      image: { contentType: "image/png", width: 800, height: 600 },
    })
  })

  it("refuses a spoofed type: the bytes decide, not the declared MIME", () => {
    const bytes = pngBytes(800, 600)
    expect(
      checkPhotoBytes(bytes, sha256Hex(bytes), declared(bytes, "image/jpeg"))
    ).toEqual({ ok: false, code: "asset_type_mismatch" })
    const text = new Uint8Array(12_000).fill(0x41)
    expect(
      checkPhotoBytes(text, sha256Hex(text), declared(text, "image/png"))
    ).toEqual({ ok: false, code: "asset_type_unsupported" })
  })

  it("refuses sizes, dimensions and digests outside the limits", () => {
    const small = pngBytes(800, 600, 4_000)
    expect(
      checkPhotoBytes(small, sha256Hex(small), declared(small, "image/png"))
    ).toEqual({ ok: false, code: "asset_too_small" })
    const large = pngBytes(800, 600, 5 * 1024 * 1024 + 1)
    expect(
      checkPhotoBytes(large, sha256Hex(large), declared(large, "image/png"))
    ).toEqual({ ok: false, code: "asset_too_large" })
    const tiny = jpegBytes(200, 900)
    expect(
      checkPhotoBytes(tiny, sha256Hex(tiny), declared(tiny, "image/jpeg"))
    ).toEqual({ ok: false, code: "asset_dimensions_too_small" })
    const zero = pngBytes(0, 600)
    expect(
      checkPhotoBytes(zero, sha256Hex(zero), declared(zero, "image/png"))
    ).toEqual({ ok: false, code: "asset_dimensions_invalid" })
    const bytes = pngBytes(800, 600)
    expect(
      checkPhotoBytes(bytes, sha256Hex(bytes), {
        ...declared(bytes, "image/png"),
        byteLength: bytes.length + 1,
      })
    ).toEqual({ ok: false, code: "asset_size_mismatch" })
    expect(
      checkPhotoBytes(bytes, sha256Hex(bytes), {
        ...declared(bytes, "image/png"),
        sha256: "0".repeat(64),
      })
    ).toEqual({ ok: false, code: "asset_sha256_mismatch" })
  })
})
