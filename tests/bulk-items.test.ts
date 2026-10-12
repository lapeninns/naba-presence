import { describe, expect, it } from "vitest"

import {
  bulkPreviewRequestSchema,
  bulkRequestItems,
} from "@/lib/contracts/bulk-listings"
import {
  BULK_MAX_CHANGES,
  BULK_MAX_ITEMS,
  bulkBatchOperation,
  bulkChangeListSchema,
  bulkItemKey,
  bulkListingOrder,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"

const ids = (count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
  )
const special = (date: string): BulkOperationInput => ({
  operation: "special_hours",
  dates: [{ action: "closed", date }],
})
const wifi: BulkOperationInput = {
  operation: "attributes",
  changes: [{ name: "attributes/has_wifi", values: [true] }],
}

describe("bulk batches: ordered change lists (P09-R4)", () => {
  it("takes an ordered list, or one change as the legacy `input`", () => {
    const listed = bulkPreviewRequestSchema.parse({
      locationIds: ids(2),
      items: [special("2026-12-25"), wifi],
    })
    expect(bulkRequestItems(listed).map((item) => item.operation)).toEqual([
      "special_hours",
      "attributes",
    ])
    const single = bulkPreviewRequestSchema.parse({
      locationIds: ids(1),
      input: wifi,
    })
    expect(bulkRequestItems(single)).toEqual([wifi])
    expect(
      bulkPreviewRequestSchema.safeParse({
        locationIds: ids(1),
        items: [wifi],
        input: wifi,
      }).success
    ).toBe(false)
    expect(
      bulkPreviewRequestSchema.safeParse({ locationIds: ids(1) }).success
    ).toBe(false)
  })

  it("caps a batch at 500 listing changes in total", () => {
    expect(BULK_MAX_ITEMS).toBe(500)
    const ten = Array.from({ length: 10 }, (_, index) =>
      special(`2026-12-${String(index + 10).padStart(2, "0")}`)
    )
    expect(
      bulkPreviewRequestSchema.safeParse({ locationIds: ids(50), items: ten })
        .success
    ).toBe(true)
    const result = bulkPreviewRequestSchema.safeParse({
      locationIds: ids(50),
      items: [...ten, special("2026-12-31")],
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/at most 500/)
    expect(
      bulkChangeListSchema.safeParse(
        Array.from({ length: BULK_MAX_CHANGES + 1 }, (_, index) => ({
          operation: "attributes",
          changes: [{ name: `attributes/a${index}`, values: [true] }],
        }))
      ).success
    ).toBe(false)
    expect(
      bulkChangeListSchema.safeParse(
        Array.from({ length: BULK_MAX_CHANGES }, (_, index) => ({
          operation: "attributes",
          changes: [{ name: `attributes/a${index}`, values: [true] }],
        }))
      ).success
    ).toBe(true)
  })

  it("refuses two changes that touch the same part of a listing", () => {
    const overlap = bulkChangeListSchema.safeParse([
      special("2026-12-25"),
      wifi,
      special("2026-12-25"),
    ])
    expect(overlap.success).toBe(false)
    expect(overlap.error?.issues[0]?.path).toEqual([2])
    expect(overlap.error?.issues[0]?.message).toMatch(/overlaps change 1/)
    expect(
      bulkChangeListSchema.safeParse([
        {
          operation: "regular_hours",
          days: [{ dayOfWeek: 1, isClosed: true, periods: [] }],
        },
        {
          operation: "regular_hours",
          days: [{ dayOfWeek: 1, isClosed: true, periods: [] }],
        },
      ]).success
    ).toBe(false)
    // Different days, dates, attributes and link types are independent.
    expect(
      bulkChangeListSchema.safeParse([
        {
          operation: "regular_hours",
          days: [{ dayOfWeek: 1, isClosed: true, periods: [] }],
        },
        {
          operation: "regular_hours",
          days: [{ dayOfWeek: 2, isClosed: true, periods: [] }],
        },
        special("2026-12-25"),
        special("2026-12-26"),
        wifi,
        {
          operation: "attributes",
          changes: [{ name: "attributes/has_dine_in", values: [false] }],
        },
        {
          operation: "place_action",
          action: "delete",
          placeActionType: "DINING_RESERVATION",
        },
      ]).success
    ).toBe(true)
    expect(
      bulkChangeListSchema.safeParse([
        {
          operation: "place_action",
          action: "delete",
          placeActionType: "DINING_RESERVATION",
        },
        {
          operation: "place_action",
          action: "upsert",
          placeActionType: "DINING_RESERVATION",
          uri: "https://book.example.test",
        },
      ]).success
    ).toBe(false)
  })

  it("keys each child by position and family, and names a mixed batch", () => {
    expect(bulkItemKey(wifi, 3)).toBe("3:attributes")
    expect(bulkBatchOperation([special("2026-12-25")])).toBe("special_hours")
    expect(
      bulkBatchOperation([special("2026-12-25"), special("2026-12-26")])
    ).toBe("special_hours")
    expect(bulkBatchOperation([special("2026-12-25"), wifi])).toBe("mixed")
  })

  it("runs a listing's changes in list order, waiting only for eligible ones", () => {
    const order = bulkListingOrder([
      { operation: "special_hours", eligible: true },
      {
        operation: "attributes",
        eligible: false,
        skipReason: "already_applied",
      },
      { operation: "more_hours", eligible: true },
      { operation: "attributes", eligible: true },
    ])
    expect(order.map((entry) => entry.dependsOn)).toEqual([
      [],
      [0],
      [0],
      [0, 2],
    ])
    expect(order.every((entry) => entry.requiresApplied.length === 0)).toBe(
      true
    )
    expect(order.some((entry) => entry.blocked)).toBe(false)
  })

  it("requires hard prerequisites to apply, and blocks on one skipped for any other reason", () => {
    // P09-R5 adds `categories` before service hours and attributes; the
    // rule is data, so it is exercised here with that shape.
    const prerequisites = {
      more_hours: ["categories"],
      attributes: ["categories"],
    }
    const order = bulkListingOrder(
      [
        { operation: "categories", eligible: true },
        { operation: "special_hours", eligible: true },
        { operation: "attributes", eligible: true },
      ],
      prerequisites
    )
    expect(order[2]).toEqual({
      dependsOn: [0, 1],
      requiresApplied: [0],
      blocked: false,
    })
    expect(order[1].requiresApplied).toEqual([])
    const skipped = bulkListingOrder(
      [
        { operation: "categories", eligible: false, skipReason: "not_offered" },
        { operation: "more_hours", eligible: true },
      ],
      prerequisites
    )
    expect(skipped[1]).toEqual({
      dependsOn: [],
      requiresApplied: [],
      blocked: true,
    })
    const alreadyApplied = bulkListingOrder(
      [
        {
          operation: "categories",
          eligible: false,
          skipReason: "already_applied",
        },
        { operation: "more_hours", eligible: true },
      ],
      prerequisites
    )
    expect(alreadyApplied[1].blocked).toBe(false)
  })
})
