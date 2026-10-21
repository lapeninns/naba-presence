import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  currencyOf,
  hydrateMenus,
  insertAt,
  moveBy,
  parseMenuPrice,
  readLabel,
  readPrice,
  withLabel,
  withPrice,
  type MenuRecord,
} from "@/lib/locations/forms/menu-editor"

const item = (
  name = "Soup",
  code = "GBP",
  units = "6",
  nanos = 500_000_000
): MenuRecord => ({
  labels: [
    {
      displayName: name,
      description: "Made fresh daily",
      languageCode: "en",
      custom: "keep",
    },
    { displayName: "Soupe", languageCode: "fr" },
  ],
  attributes: {
    price: { currencyCode: code, units, nanos, custom: "keep-price" },
    dietaryRestriction: ["VEGETARIAN"],
    custom: "keep-attributes",
  },
  options: [{ labels: [{ displayName: "Large" }], custom: "keep-option" }],
  custom: "keep-item",
})
const menus = (): MenuRecord[] => [
  {
    labels: [{ displayName: "Lunch" }],
    custom: "keep-menu",
    sections: [
      {
        labels: [{ displayName: "Starters", description: "To begin" }],
        custom: "keep-section",
        items: [item(), item("Salad")],
      },
    ],
  },
  {
    labels: [{ displayName: "Dinner" }],
    sections: [
      {
        labels: [{ displayName: "Mains" }],
        items: [item("Curry", "EUR", "12", 0)],
      },
    ],
  },
]

describe("exact menu prices", () => {
  for (const [input, expected] of [
    ["12.50", { units: "12", nanos: 500_000_000 }],
    ["12.", { units: "12", nanos: 0 }],
    [".50", { units: "0", nanos: 500_000_000 }],
    ["0", { units: "0", nanos: 0 }],
    ["0.00", { units: "0", nanos: 0 }],
    ["0012.50", { units: "12", nanos: 500_000_000 }],
    [" 12.50 ", { units: "12", nanos: 500_000_000 }],
    ["0.000000001", { units: "0", nanos: 1 }],
    ["12.999999999", { units: "12", nanos: 999_999_999 }],
    [
      "9223372036854775807.01",
      { units: "9223372036854775807", nanos: 10_000_000 },
    ],
  ] as const) {
    it(`parses ${JSON.stringify(input)} without rounding`, () =>
      assert.deepEqual(parseMenuPrice(input), { ok: true, value: expected }))
  }
  for (const value of [
    "-1",
    "12,50",
    "1e3",
    "NaN",
    "Infinity",
    "12.3.4",
    ".",
    "£12.50",
    "0.1234567891",
    "9223372036854775808",
    "9999999999999999999999",
  ]) {
    it(`rejects ${JSON.stringify(value)} rather than coercing it`, () =>
      assert.equal(parseMenuPrice(value).ok, false))
  }
  it("distinguishes a missing price from a free item", () => {
    assert.deepEqual(parseMenuPrice(""), { ok: true, value: null })
    assert.deepEqual(parseMenuPrice("0"), {
      ok: true,
      value: { units: "0", nanos: 0 },
    })
    assert.equal(readPrice(withPrice(item(), "")), "")
    assert.equal(readPrice(withPrice(item(), "0")), "0.00")
  })
  it("retains nine-decimal precision when reading imported prices", () =>
    assert.equal(
      readPrice(item("Soup", "GBP", "12", 999_999_999)),
      "12.999999999"
    ))
  it("does not lose int64 precision", () =>
    assert.equal(
      readPrice(item("Soup", "GBP", "9223372036854775807", 1)),
      "9223372036854775807.000000001"
    ))
  it("rejects malformed imported nanos visibly", () =>
    assert.equal(
      readPrice(item("Soup", "GBP", "1", Number.NaN)),
      "Invalid price"
    ))
  it("does not turn a negative imported price positive", () =>
    assert.equal(readPrice(item("Soup", "GBP", "-1", -500_000_000)), "-1.50"))
  it("never replaces a valid price with invalid text", () => {
    const original = item()
    assert.equal(withPrice(original, "oops"), original)
  })
  it("preserves currency after clearing and re-entering a price", () => {
    const original = item("Soup", "EUR")
    const currency = currencyOf(original)
    assert.equal(
      currencyOf(withPrice(withPrice(original, ""), "12.50", currency)),
      "EUR"
    )
  })
})

describe("passthrough preservation and editor identity", () => {
  it("hydrates every menu, section and item around the untouched provider record", () => {
    const original = menus()
    const tree = hydrateMenus(original)
    assert.equal(tree.length, 2)
    assert.equal(tree[0]!.data, original[0])
    assert.equal(
      tree[0]!.sections[0]!.data,
      (original[0]!.sections as MenuRecord[])[0]
    )
    assert.equal(
      tree[0]!.sections[0]!.items[1]!.data,
      ((original[0]!.sections as MenuRecord[])[0]!.items as MenuRecord[])[1]
    )
    assert.deepEqual(original, menus())
  })
  it("seeds each item's price draft and currency from the provider price", () => {
    const tree = hydrateMenus(menus())
    assert.deepEqual(
      tree[0]!.sections[0]!.items.map((entry) => [
        entry.priceText,
        entry.currencyCode,
      ]),
      [
        ["6.50", "GBP"],
        ["6.50", "GBP"],
      ]
    )
    assert.deepEqual(
      tree[1]!.sections[0]!.items.map((entry) => [
        entry.priceText,
        entry.currencyCode,
      ]),
      [["12.00", "EUR"]]
    )
  })
  it("gives every node a distinct editor ID", () => {
    const tree = hydrateMenus(menus())
    const ids = tree.flatMap((menu) => [
      menu.id,
      ...menu.sections.flatMap((section) => [
        section.id,
        ...section.items.map((entry) => entry.id),
      ]),
    ])
    assert.equal(new Set(ids).size, ids.length)
  })
  it("changes only the primary label", () => {
    const original = item()
    const next = withLabel(original, { displayName: "New soup" })
    assert.equal(readLabel(original).displayName, "Soup")
    assert.equal(readLabel(next).displayName, "New soup")
    assert.deepEqual(
      (next.labels as unknown[])[1],
      (original.labels as unknown[])[1]
    )
    assert.deepEqual(next.options, original.options)
    assert.deepEqual(next.attributes, original.attributes)
  })
  it("preserves unknown price and attribute properties while editing", () => {
    const result = withPrice(item(), "12.50")
    const attributes = result.attributes as MenuRecord
    assert.equal(attributes.custom, "keep-attributes")
    assert.equal((attributes.price as MenuRecord).custom, "keep-price")
    assert.deepEqual(result.options, item().options)
  })
  it("keeps IDs and unfinished decimals attached to the item when reordered", () => {
    const tree = hydrateMenus(menus())
    const items = tree[0]!.sections[0]!.items
    items[0] = { ...items[0]!, priceText: "12." }
    const moved = moveBy(items, 0, 1)
    assert.equal(moved[1]!.id, items[0]!.id)
    assert.equal(moved[1]!.priceText, "12.")
    assert.equal(items[0]!.data.labels, moved[1]!.data.labels)
  })
  it("does not move outside either boundary or mutate the input", () => {
    const input = [1, 2, 3]
    assert.equal(moveBy(input, 0, -1), input)
    assert.equal(moveBy(input, 2, 1), input)
    assert.equal(moveBy(input, -1, 1), input)
    assert.deepEqual(moveBy(input, 1, 1), [1, 3, 2])
    assert.deepEqual(input, [1, 2, 3])
  })
  it("clamps insert positions", () => {
    assert.deepEqual(insertAt([1], 50, 2), [1, 2])
    assert.deepEqual(insertAt([1], -10, 2), [2, 1])
  })
})
