import { describe, expect, it } from "vitest"

import { encodeCursor } from "@/lib/contracts/cursor"
import {
  decodeLocationActivityCursor,
  encodeLocationActivityCursor,
} from "@/lib/contracts/location-activity"
import {
  decodeMediaCursor,
  encodeMediaCursor,
} from "@/lib/contracts/location-media"
import {
  decodePostsCursor,
  encodePostsCursor,
  postsListQuerySchema,
} from "@/lib/contracts/location-posts"

const locationId = "4b3f0f5e-2c1a-4d6e-9f7a-1b2c3d4e5f60"
const id = "0d9c7a3e-5b1f-4c2d-8e6f-7a8b9c0d1e2f"

describe("per-location list cursors", () => {
  it("round-trips a posts cursor, including the undated tail", () => {
    for (const at of ["2026-09-01T12:00:00.123456Z", null]) {
      const cursor = { version: 1 as const, locationId, filter: "draft" as const, at, id }
      expect(decodePostsCursor(encodePostsCursor(cursor))).toEqual(cursor)
    }
  })

  it("round-trips a media cursor bound to its filters", () => {
    const cursor = {
      version: 1 as const,
      locationId,
      category: "INTERIOR" as const,
      ownershipFilter: null,
      ownership: "customer" as const,
      at: null,
      id,
    }
    expect(decodeMediaCursor(encodeMediaCursor(cursor))).toEqual(cursor)
  })

  it("decodes activity cursors written before the shared codec", () => {
    const cursor = { version: 1 as const, locationId, at: "2026-09-29T10:00:00.123456Z", id: `media:${id}` }
    const legacy = Buffer.from(JSON.stringify(cursor)).toString("base64url")
    expect(decodeLocationActivityCursor(legacy)).toEqual(cursor)
    expect(encodeLocationActivityCursor(cursor)).toBe(legacy)
  })

  it("refuses another list's cursor, extra fields and non-uuid ids", () => {
    const posts = { version: 1, locationId, filter: "all", at: null, id }
    // A posts cursor is not a media cursor, and the reverse.
    expect(decodeMediaCursor(encodeCursor(posts))).toBeNull()
    expect(decodePostsCursor(encodeCursor({ ...posts, extra: 1 }))).toBeNull()
    expect(decodePostsCursor(encodeCursor({ ...posts, id: "1 or 1=1" }))).toBeNull()
    expect(decodePostsCursor(encodeCursor({ ...posts, filter: "deleted" }))).toBeNull()
    expect(decodePostsCursor("garbage!")).toBeNull()
  })

  it("accepts only the known post views and a uuid single-post read", () => {
    expect(postsListQuerySchema.parse({ filter: "attention", pageSize: "5" })).toEqual({ filter: "attention", pageSize: 5 })
    expect(postsListQuerySchema.safeParse({ filter: "deleted" }).success).toBe(false)
    expect(postsListQuerySchema.safeParse({ pageSize: "51" }).success).toBe(false)
    expect(postsListQuerySchema.safeParse({ post: "p1" }).success).toBe(false)
  })
})
