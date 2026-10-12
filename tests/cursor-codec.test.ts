import { describe, expect, it, vi } from "vitest"

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

const env = { NEXTAUTH_SECRET: "nextauth-secret-with-at-least-32-characters" }
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))
const { openCursor, sealCursor } = await import("@/lib/server/crypto")

const position = {
  v: 2 as const,
  page: 2,
  startedAt: "2026-09-02T08:00:00.000001Z",
  createTime: "2026-09-01T12:00:00.123456Z",
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

describe("sealed cursors", () => {
  const binding = "privacy-export:org-1:subject-hash"

  it("opens only for the binding it was sealed with", () => {
    const payload = encodeCursor(position)
    const sealed = sealCursor(payload, binding)
    expect(openCursor(sealed, binding)).toBe(payload)
    expect(openCursor(sealed, "privacy-export:org-1:other-subject")).toBeNull()
    expect(openCursor(sealed, "privacy-export:org-2:subject-hash")).toBeNull()
  })

  it("carries nothing about the binding", () => {
    const sealed = sealCursor(encodeCursor(position), binding)
    const [payload] = sealed.split(".")
    expect(JSON.parse(fromBase64Url(payload))).toEqual(position)
    expect(sealed).not.toContain("subject-hash")
  })

  it("rejects an edited payload, a missing MAC and another key", () => {
    const sealed = sealCursor(encodeCursor(position), binding)
    const mac = sealed.slice(sealed.lastIndexOf(".") + 1)
    const forged = `${encodeCursor({ ...position, page: 7 })}.${mac}`
    expect(openCursor(forged, binding)).toBeNull()
    expect(openCursor(encodeCursor(position), binding)).toBeNull()
    expect(openCursor(undefined, binding)).toBeNull()
    const previous = env.NEXTAUTH_SECRET
    env.NEXTAUTH_SECRET = "rotated-nextauth-secret-with-32-characters"
    try {
      expect(openCursor(sealed, binding)).toBeNull()
    } finally {
      env.NEXTAUTH_SECRET = previous
    }
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
