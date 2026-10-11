import { describe, expect, it } from "vitest"

import {
  decodeCursor,
  encodeCursor,
  fromBase64Url,
  toBase64Url,
} from "@/lib/contracts/cursor"
import {
  privacyExportBodySchema,
  privacyExportCursorSchema,
} from "@/lib/contracts/privacy"
import { decodeReviewsCursor, encodeReviewsCursor } from "@/lib/contracts/reviews"

const position = {
  v: 1 as const,
  subject: "0123456789abcdef",
  page: 2,
  updateTime: "2026-09-01T12:00:00.123456Z",
  id: "4b3f0f5e-2c1a-4d6e-9f7a-1b2c3d4e5f60",
}

describe("cursor codec", () => {
  it("matches Node's base64url byte for byte, including non-ASCII text", () => {
    for (const text of ["", "a", "ab", "abc", '{"x":"é✓?>"}']) {
      expect(toBase64Url(text)).toBe(Buffer.from(text).toString("base64url"))
      expect(fromBase64Url(toBase64Url(text))).toBe(text)
    }
  })

  it("round-trips a validated cursor at microsecond precision", () => {
    const encoded = encodeCursor(position)
    expect(decodeCursor(encoded, privacyExportCursorSchema)).toEqual(position)
  })

  it("returns null for absent, undecodable or wrongly shaped cursors", () => {
    expect(decodeCursor(undefined, privacyExportCursorSchema)).toBeNull()
    expect(decodeCursor("", privacyExportCursorSchema)).toBeNull()
    expect(decodeCursor("not a cursor!", privacyExportCursorSchema)).toBeNull()
    expect(
      decodeCursor(toBase64Url("{not json"), privacyExportCursorSchema)
    ).toBeNull()
    expect(
      decodeCursor(
        encodeCursor({ ...position, page: 1 }),
        privacyExportCursorSchema
      )
    ).toBeNull()
    expect(
      decodeCursor(
        encodeCursor({ ...position, id: "x" }),
        privacyExportCursorSchema
      )
    ).toBeNull()
  })

  it("keeps the reviews cursor wire format unchanged", () => {
    const cursor = {
      updateTime: "2026-09-01T12:00:00.000Z",
      id: position.id,
      rating: 4,
    }
    const encoded = encodeReviewsCursor(cursor)
    expect(encoded).toBe(
      Buffer.from(JSON.stringify(cursor)).toString("base64url")
    )
    expect(decodeReviewsCursor(encoded)).toEqual(cursor)
  })
})

describe("privacy export body", () => {
  it("defaults the page size and bounds it", () => {
    expect(privacyExportBodySchema.parse({ subject: "Jane Doe" })).toEqual({
      subject: "Jane Doe",
      pageSize: 500,
    })
    expect(
      privacyExportBodySchema.safeParse({ subject: "Jane Doe", pageSize: 1001 })
        .success
    ).toBe(false)
    expect(
      privacyExportBodySchema.safeParse({ subject: "Jane Doe", pageSize: 0 })
        .success
    ).toBe(false)
  })
})
