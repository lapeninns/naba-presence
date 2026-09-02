import { describe, expect, it } from "vitest"

import {
  DEFAULT_REVIEW_SORT,
  InvalidReviewsCursorError,
  REVIEW_SORT_LABELS,
  REVIEW_SORTS,
  decodeReviewsCursor,
  decodeReviewsQuery,
  encodeReviewsCursor,
  encodeReviewsQuery,
  reviewSortSchema,
} from "@/lib/contracts/reviews"
import { SORT_LABELS, formatSortChip } from "@/lib/inbox/filter-labels"

const CURSOR = {
  updateTime: "2026-07-30T10:00:00.000Z",
  id: "8f7e6d5c-4b3a-4c2d-9e1f-0a1b2c3d4e5f",
  rating: 4,
}

describe("reviews contract: sort vocabulary", () => {
  it("derives the enum, the labels and the chip text from one record", () => {
    expect(REVIEW_SORTS).toEqual(Object.keys(REVIEW_SORT_LABELS))
    expect(reviewSortSchema.options).toEqual(REVIEW_SORTS)
    expect(SORT_LABELS).toBe(REVIEW_SORT_LABELS)
    for (const sort of REVIEW_SORTS) {
      expect(formatSortChip(sort)).toBe(`Sort: ${REVIEW_SORT_LABELS[sort]}`)
    }
    expect(REVIEW_SORTS).toContain(DEFAULT_REVIEW_SORT)
  })
})

describe("reviews contract: cursor codec", () => {
  it("is byte-identical to Buffer's base64url encoding", () => {
    const encoded = encodeReviewsCursor(CURSOR)
    expect(encoded).toBe(
      Buffer.from(JSON.stringify(CURSOR)).toString("base64url")
    )
    expect(decodeReviewsCursor(encoded)).toEqual(CURSOR)
  })

  it("accepts a cursor produced with Buffer (padding tolerant)", () => {
    const nullRating = { ...CURSOR, rating: null }
    const fromBuffer = Buffer.from(JSON.stringify(nullRating)).toString(
      "base64url"
    )
    expect(decodeReviewsCursor(fromBuffer)).toEqual(nullRating)
  })

  it("returns undefined for absent or undecodable cursors", () => {
    expect(decodeReviewsCursor(null)).toBeUndefined()
    expect(decodeReviewsCursor("")).toBeUndefined()
    expect(decodeReviewsCursor("not*base64")).toBeUndefined()
    expect(decodeReviewsCursor(Buffer.from("{oops").toString("base64url"))).toBeUndefined()
  })
})

describe("reviews contract: wire codec", () => {
  it("round-trips every filter through the snake_case wire vocabulary", () => {
    const cursor = encodeReviewsCursor(CURSOR)
    const params = encodeReviewsQuery({
      locationId: "0c9d8e7f-6a5b-4c3d-8e2f-1a2b3c4d5e6f",
      ratings: [4, 5],
      statuses: ["new", "drafted"],
      replyState: "unreplied",
      verification: ["pass", "warn"],
      publishStatus: ["published"],
      syncStatus: ["succeeded"],
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-31T00:00:00.000Z",
      search: "lovely",
      sort: "rating_desc",
      pageSize: 20,
      cursor,
    })
    expect(Object.fromEntries(params)).toEqual({
      location_id: "0c9d8e7f-6a5b-4c3d-8e2f-1a2b3c4d5e6f",
      rating: "4,5",
      status: "new,drafted",
      reply_state: "unreplied",
      verification: "pass,warn",
      publish_status: "published",
      sync_status: "succeeded",
      date_from: "2026-07-01T00:00:00.000Z",
      date_to: "2026-07-31T00:00:00.000Z",
      search: "lovely",
      sort: "rating_desc",
      page_size: "20",
      cursor,
    })
    expect(decodeReviewsQuery(params)).toEqual({
      locationId: "0c9d8e7f-6a5b-4c3d-8e2f-1a2b3c4d5e6f",
      ratings: [4, 5],
      statuses: ["new", "drafted"],
      replyState: "unreplied",
      verification: ["pass", "warn"],
      publishStatus: ["published"],
      syncStatus: ["succeeded"],
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-31T00:00:00.000Z",
      search: "lovely",
      sort: "rating_desc",
      pageSize: 20,
      cursor: CURSOR,
    })
  })

  it("omits empty filters and applies the server defaults on decode", () => {
    expect(encodeReviewsQuery({}).toString()).toBe("")
    expect(encodeReviewsQuery({ ratings: [], search: "" }).toString()).toBe("")
    const decoded = decodeReviewsQuery(new URLSearchParams())
    expect(decoded.sort).toBe(DEFAULT_REVIEW_SORT)
    expect(decoded.pageSize).toBe(50)
    expect(decoded.cursor).toBeUndefined()
    expect(decoded.replyState).toBeUndefined()
  })

  it("collapses reply_state to a single value, else no reply filter", () => {
    expect(
      decodeReviewsQuery(new URLSearchParams("reply_state=replied")).replyState
    ).toBe("replied")
    expect(
      decodeReviewsQuery(new URLSearchParams("reply_state=replied,unreplied"))
        .replyState
    ).toBeUndefined()
    expect(() =>
      decodeReviewsQuery(new URLSearchParams("reply_state=bogus"))
    ).toThrow()
  })

  it("rejects unknown vocabulary values", () => {
    expect(() =>
      decodeReviewsQuery(new URLSearchParams("sort=newest"))
    ).toThrow()
    expect(() =>
      decodeReviewsQuery(new URLSearchParams("status=archived"))
    ).toThrow()
    expect(() =>
      decodeReviewsQuery(new URLSearchParams("publish_status=maybe"))
    ).toThrow()
  })

  it("requires a rating on rating-sort cursors", () => {
    const { rating: _rating, ...noRating } = CURSOR
    void _rating
    const cursor = encodeReviewsCursor(noRating)
    for (const sort of ["rating_desc", "rating_asc"]) {
      expect(() =>
        decodeReviewsQuery(new URLSearchParams({ sort, cursor }))
      ).toThrow(InvalidReviewsCursorError)
    }
    // Updated sorts do not need a rating.
    expect(
      decodeReviewsQuery(new URLSearchParams({ sort: "updated_desc", cursor }))
        .cursor
    ).toEqual(noRating)
    // A null rating is a valid boundary (nulls sort last).
    const nullCursor = encodeReviewsCursor({ ...CURSOR, rating: null })
    expect(
      decodeReviewsQuery(
        new URLSearchParams({ sort: "rating_desc", cursor: nullCursor })
      ).cursor
    ).toEqual({ ...CURSOR, rating: null })
  })
})
