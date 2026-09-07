import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  currencyOf, hydrateMenus, insertAt, menuIssues, menuStructureSummary,
  moveBy, parseMenuPrice, readLabel, readPrice, restoreRemoval,
  serializeMenus, withLabel, withPrice, type MenuRecord,
} from "@/lib/locations/forms/menu-editor"

const item = (name = "Soup", code = "GBP", units = "6", nanos = 500_000_000): MenuRecord => ({
  labels: [{ displayName: name, description: "Made fresh daily", languageCode: "en", custom: "keep" }, { displayName: "Soupe", languageCode: "fr" }],
  attributes: { price: { currencyCode: code, units, nanos, custom: "keep-price" }, dietaryRestriction: ["VEGETARIAN"], custom: "keep-attributes" },
  options: [{ labels: [{ displayName: "Large" }], custom: "keep-option" }],
  custom: "keep-item",
})
const menus = (): MenuRecord[] => [
  { labels: [{ displayName: "Lunch" }], custom: "keep-menu", sections: [{ labels: [{ displayName: "Starters", description: "To begin" }], custom: "keep-section", items: [item(), item("Salad")] }] },
  { labels: [{ displayName: "Dinner" }], sections: [{ labels: [{ displayName: "Mains" }], items: [item("Curry", "EUR", "12", 0)] }] },
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
    ["9223372036854775807.01", { units: "9223372036854775807", nanos: 10_000_000 }],
  ] as const) {
    it(`parses ${JSON.stringify(input)} without rounding`, () => assert.deepEqual(parseMenuPrice(input), { ok: true, value: expected }))
  }
  for (const value of ["-1", "12,50", "1e3", "NaN", "Infinity", "12.3.4", ".", "£12.50", "0.1234567891", "9223372036854775808", "9999999999999999999999"]) {
    it(`rejects ${JSON.stringify(value)} rather than coercing it`, () => assert.equal(parseMenuPrice(value).ok, false))
  }
  it("distinguishes a missing price from a free item", () => {
    assert.deepEqual(parseMenuPrice(""), { ok: true, value: null })
    assert.deepEqual(parseMenuPrice("0"), { ok: true, value: { units: "0", nanos: 0 } })
    assert.equal(readPrice(withPrice(item(), "")), "")
    assert.equal(readPrice(withPrice(item(), "0")), "0.00")
  })
  it("retains nine-decimal precision when reading imported prices", () => assert.equal(readPrice(item("Soup", "GBP", "12", 999_999_999)), "12.999999999"))
  it("does not lose int64 precision", () => assert.equal(readPrice(item("Soup", "GBP", "9223372036854775807", 1)), "9223372036854775807.000000001"))
  it("rejects malformed imported nanos visibly", () => assert.equal(readPrice(item("Soup", "GBP", "1", Number.NaN)), "Invalid price"))
  it("does not turn a negative imported price positive", () => assert.equal(readPrice(item("Soup", "GBP", "-1", -500_000_000)), "-1.50"))
  it("never replaces a valid price with invalid text", () => {
    const original = item()
    assert.equal(withPrice(original, "oops"), original)
  })
  it("preserves currency after clearing and re-entering a price", () => {
    const original = item("Soup", "EUR")
    const currency = currencyOf(original)
    assert.equal(currencyOf(withPrice(withPrice(original, ""), "12.50", currency)), "EUR")
  })
})

describe("passthrough preservation and editor identity", () => {
  it("round-trips all menus, options, translations and unknown fields", () => {
    const original = menus()
    assert.deepEqual(serializeMenus(hydrateMenus(original)), original)
  })
  it("does not add empty structural properties to a no-op round trip", () => {
    const original = [{ labels: [{ displayName: "Empty" }], opaque: true }]
    assert.deepEqual(serializeMenus(hydrateMenus(original)), original)
  })
  it("changes only the primary label", () => {
    const original = item()
    const next = withLabel(original, { displayName: "New soup" })
    assert.equal(readLabel(original).displayName, "Soup")
    assert.equal(readLabel(next).displayName, "New soup")
    assert.deepEqual((next.labels as unknown[])[1], (original.labels as unknown[])[1])
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
  it("edits the second menu without altering the first", () => {
    const original = menus()
    const tree = hydrateMenus(original)
    tree[1] = { ...tree[1]!, data: withLabel(tree[1]!.data, { displayName: "Evening menu" }) }
    const output = serializeMenus(tree)
    assert.deepEqual(output[0], original[0])
    assert.equal(readLabel(output[1]!).displayName, "Evening menu")
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
  it("does not serialize editor IDs, currency memory or raw price drafts", () => {
    const tree = hydrateMenus(menus())
    tree[0]!.sections[0]!.items[0]!.priceText = "invalid"
    const wire = JSON.stringify(serializeMenus(tree))
    assert.equal(wire.includes('"priceText"'), false)
    assert.equal(wire.includes('"id":"menu-'), false)
    assert.equal(wire.includes("invalid"), false)
  })
})

describe("validation and safe undo", () => {
  it("validates hidden menus, not only the first", () => {
    const tree = hydrateMenus(menus())
    tree[1]!.sections[0]!.items[0]!.priceText = "1,50"
    const issues = menuIssues(tree)
    assert.equal(issues.length, 1)
    assert.equal(issues[0]!.menuId, tree[1]!.id)
    assert.equal(issues[0]!.field, "price")
  })
  it("reports missing names at every level with focusable IDs", () => {
    const tree = hydrateMenus([{ labels: [], sections: [{ labels: [], items: [{ labels: [] }] }] }])
    assert.deepEqual(menuIssues(tree).map((issue) => issue.message), ["Give this menu a name.", "Give this section a name.", "Give this item a name."])
  })
  it("allows a deliberately empty full replacement", () => assert.deepEqual(menuIssues([]), []))
  it("undoes an item removal without overwriting a later edit", () => {
    const tree = hydrateMenus(menus())
    const menu = tree[0]!, section = menu.sections[0]!, removed = section.items[0]!
    const remaining = { ...section.items[1]!, data: withLabel(section.items[1]!.data, { displayName: "Edited salad" }) }
    const current = [{ ...menu, sections: [{ ...section, items: [remaining] }] }, tree[1]!]
    const result = restoreRemoval(current, { kind: "item", node: removed, index: 0, menuId: menu.id, sectionId: section.id })
    assert.equal(result[0]!.sections[0]!.items[0]!.id, removed.id)
    assert.equal(readLabel(result[0]!.sections[0]!.items[1]!.data).displayName, "Edited salad")
    assert.equal(current[0]!.sections[0]!.items.length, 1)
  })
  it("restores a whole section including its raw price and options", () => {
    const tree = hydrateMenus(menus())
    const menu = tree[0]!, section = menu.sections[0]!
    section.items[0]!.priceText = "12."
    const current = [{ ...menu, sections: [] }, tree[1]!]
    const restored = restoreRemoval(current, { kind: "section", node: section, index: 0, menuId: menu.id })
    assert.deepEqual(restored[0]!.sections[0], section)
  })
  it("restores a deleted menu without reverting another menu's edit", () => {
    const tree = hydrateMenus(menus())
    const current = [{ ...tree[1]!, data: withLabel(tree[1]!.data, { displayName: "Updated dinner" }) }]
    const restored = restoreRemoval(current, { kind: "menu", node: tree[0]!, index: 0 })
    assert.equal(restored[0]!.id, tree[0]!.id)
    assert.equal(readLabel(restored[1]!.data).displayName, "Updated dinner")
  })
  it("includes menu names, section names, item order and descriptions in review", () => {
    const original = menus()
    const summary = menuStructureSummary(original)
    assert.match(summary, /Lunch/)
    assert.match(summary, /Starters — To begin/)
    assert.match(summary, /Made fresh daily/)
    const tree = hydrateMenus(original)
    tree[0]!.sections[0]!.items = moveBy(tree[0]!.sections[0]!.items, 0, 1)
    assert.notEqual(menuStructureSummary(serializeMenus(tree)), summary)
  })
})
