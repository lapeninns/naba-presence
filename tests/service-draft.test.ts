import { describe, expect, it } from "vitest"
import {
  buildServiceItems,
  parseServicePrice,
  parseServiceDraft,
  setServiceDescription,
  serviceDraftRows,
  servicePriceText,
} from "@/lib/locations/forms/services"

describe("services editor draft preservation", () => {
  it("removes only the chosen description from either service variant", () => {
    const items = [
      {
        structuredServiceItem: {
          serviceTypeId: "repair",
          description: "Repairs",
        },
        price: { units: "15" },
      },
      {
        freeFormServiceItem: {
          category: "gcid:plumber",
          label: {
            displayName: "Callout",
            description: "Visits",
            languageCode: "cy",
          },
        },
      },
    ]
    expect(setServiceDescription(items[0], undefined)).toEqual({
      structuredServiceItem: { serviceTypeId: "repair" },
      price: { units: "15" },
    })
    expect(setServiceDescription(items[1], undefined)).toEqual({
      freeFormServiceItem: {
        category: "gcid:plumber",
        label: { displayName: "Callout", languageCode: "cy" },
      },
    })
    expect(setServiceDescription(items[0], "")).toHaveProperty(
      "structuredServiceItem.description",
      ""
    )
    expect(items[0]).toHaveProperty(
      "structuredServiceItem.description",
      "Repairs"
    )
  })

  it("restores unfinished inputs while refusing malformed or unknown service data", () => {
    const unfinished = [
      {
        item: {
          freeFormServiceItem: {
            category: "gcid:plumber",
            label: { displayName: "" },
          },
        },
        priceEdit: { mode: "set", amount: "12.", currency: "G" },
      },
    ]
    expect(parseServiceDraft(unfinished)).toEqual(unfinished)
    expect(buildServiceItems(parseServiceDraft(unfinished) ?? []).success).toBe(
      false
    )
    for (const value of [
      null,
      {},
      [null],
      [{ item: {}, priceEdit: { mode: "keep" } }],
      [
        {
          item: {
            structuredServiceItem: { serviceTypeId: "repair", unknown: true },
          },
          priceEdit: { mode: "keep" },
        },
      ],
    ]) {
      expect(parseServiceDraft(value)).toBeNull()
    }
  })

  it("does not display an absent amount as a zero price", () => {
    expect(servicePriceText({ currencyCode: "GBP" })).toBe("")
    expect(servicePriceText({ units: "0" })).toBe("0")
    expect(parseServicePrice("-0.5", "GBP")).toEqual({
      success: true,
      price: { currencyCode: "GBP", units: "0", nanos: -500000000 },
    })
  })
  it("preserves absent values and exact existing prices when another service changes", () => {
    const original = [
      {
        structuredServiceItem: { serviceTypeId: "legacy" },
        price: { units: "9223372036854775807", nanos: 1 },
      },
      {
        freeFormServiceItem: {
          category: "gcid:plumber",
          label: { displayName: "Callout", languageCode: "cy" },
        },
      },
    ]
    const rows = serviceDraftRows(original)
    rows[1].priceEdit = { mode: "set", amount: "0.000000001", currency: "GBP" }
    expect(buildServiceItems(rows)).toEqual({
      success: true,
      items: [
        original[0],
        {
          ...original[1],
          price: { units: "0", nanos: 1, currencyCode: "GBP" },
        },
      ],
    })
    expect(original[1]).not.toHaveProperty("price")
  })

  it("distinguishes keeping, clearing and explicitly setting a zero price", () => {
    const item = {
      structuredServiceItem: { serviceTypeId: "repair" },
      price: { currencyCode: "GBP", units: "15" },
    }
    expect(buildServiceItems([{ item, priceEdit: { mode: "keep" } }])).toEqual({
      success: true,
      items: [item],
    })
    expect(buildServiceItems([{ item, priceEdit: { mode: "clear" } }])).toEqual(
      {
        success: true,
        items: [{ structuredServiceItem: item.structuredServiceItem }],
      }
    )
    expect(
      buildServiceItems([
        { item, priceEdit: { mode: "set", currency: "GBP", amount: "0" } },
      ])
    ).toEqual({
      success: true,
      items: [
        { ...item, price: { currencyCode: "GBP", units: "0", nanos: 0 } },
      ],
    })
  })

  it("round-trips signed fractional amounts without floating point rounding", () => {
    for (const amount of [
      "9223372036854775807.000000001",
      "-0.000000001",
      "-12.5",
      "0",
    ]) {
      const parsed = parseServicePrice(amount, "GBP")
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(servicePriceText(parsed.price)).toBe(amount)
    }
  })

  it.each(["", "1e3", "1.0000000001", "9223372036854775808", "NaN", "12,50"])(
    "rejects invalid price %s",
    (amount) => {
      expect(parseServicePrice(amount, "GBP").success).toBe(false)
    }
  )
})
