import { describe, expect, it } from "vitest"
import {
  compareMenuReplacement,
  menuChangeRows,
} from "@/lib/locations/menu-diff"

function item(description = "Fresh soup", units = "6") {
  return {
    labels: [{ displayName: "Soup", description }],
    attributes: { price: { currencyCode: "GBP", units, nanos: 0 } },
  }
}
function menu(items: Array<Record<string, unknown>>, section = "Starters") {
  return [
    {
      labels: [{ displayName: "Menu" }],
      sections: [{ labels: [{ displayName: section }], items }],
    },
  ]
}

describe("outbound whole-menu comparison", () => {
  it("returns zero changes when identical duplicate occurrences are present", () => {
    const google = menu([item(), item()])
    const rows = menuChangeRows({ google, draft: structuredClone(google) })
    expect(rows).toEqual([])
  })
  it("shows both descriptions when the description changes", () => {
    const rows = menuChangeRows({
      google: menu([item()]),
      draft: menu([item("Roasted tomato")]),
    })
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          before: "Fresh soup",
          after: "Roasted tomato",
        }),
      ])
    )
  })
  it("explicitly removes a description when the draft clears it", () => {
    const rows = menuChangeRows({
      google: menu([item()]),
      draft: menu([item("")]),
    })
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ before: "Fresh soup", after: "Removed" }),
      ])
    )
  })
  it("shows section renaming when its items are unchanged", () => {
    const rows = menuChangeRows({
      google: menu([item()]),
      draft: menu([item()], "Lunch"),
    })
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ before: "Starters", after: "Lunch" }),
      ])
    )
  })
  it("marks duplicate uncertainty without fabricated removal or addition", () => {
    const rows = menuChangeRows({
      google: menu([item("A"), item("B")]),
      draft: menu([item("C"), item("D")]),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ blocking: true })
    expect(rows[0]?.after).not.toBe("Removed from Google")
  })
})

describe("replacement fields and safe occurrence matching", () => {
  it("matches identical duplicates before the one changed occurrence", () => {
    const result = compareMenuReplacement({
      google: menu([item("A"), item("B"), item("A")]),
      draft: menu([item("A"), item("C"), item("A")]),
    })
    expect(result.publishable).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ before: "B", after: "C" })
  })
  it("blocks a many-to-one duplicate change instead of guessing an identity", () => {
    const result = compareMenuReplacement({
      google: menu([item("A"), item("B")]),
      draft: menu([item("C")]),
    })
    expect(result.publishable).toBe(false)
    expect(result.unresolvedCount).toBe(1)
    expect(result.rows[0]?.explanation).toContain("cannot be matched reliably")
  })
  it("shows exact price changes including currency and sub-penny nanos", () => {
    const draft = item()
    draft.attributes.price = { currencyCode: "EUR", units: "7", nanos: 1 }
    const rows = menuChangeRows({
      google: menu([item()]),
      draft: menu([draft]),
    })
    expect(rows.map(({ before, after }) => [before, after])).toEqual([
      ["GBP", "EUR"],
      ["6", "7"],
      ["0", "1"],
    ])
  })
  it("shows every cleared price field when the price is removed", () => {
    const rows = menuChangeRows({
      google: menu([item()]),
      draft: menu([{ labels: item().labels }]),
    })
    expect(rows).toHaveLength(3)
    expect(rows.every((row) => row.after === "Removed")).toBe(true)
  })
  it("shows removed options and attributes that inbound imports preserve", () => {
    const google = menu([
      {
        ...item(),
        options: [{ labels: [{ displayName: "Large" }] }],
        attributes: {
          ...item().attributes,
          dietaryRestriction: ["VEGETARIAN"],
        },
      },
    ])
    const rows = menuChangeRows({ google, draft: menu([item()]) })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.after === "Removed")).toBe(true)
    expect(rows.some((row) => row.before.includes("Large"))).toBe(true)
    expect(rows.some((row) => row.before.includes("VEGETARIAN"))).toBe(true)
  })
  it("shows options added or reordered including their complete values", () => {
    const options = [
      { label: "Small", price: 5 },
      { label: "Large", price: 9 },
    ]
    const rows = menuChangeRows({
      google: menu([{ ...item(), options }]),
      draft: menu([{ ...item(), options: [...options].reverse() }]),
    })
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]?.before ?? "null")).toEqual(options)
    expect(JSON.parse(rows[0]?.after ?? "null")).toEqual([...options].reverse())
  })
  it("shows item ordering even when the same occurrences remain", () => {
    const rows = menuChangeRows({
      google: menu([item("A"), item("B")]),
      draft: menu([item("B"), item("A")]),
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.field.endsWith("order"))).toBe(true)
  })
  it("shows section ordering and empty section additions/removals", () => {
    const sections = [
      { labels: [{ displayName: "A" }], items: [] },
      { labels: [{ displayName: "B" }], items: [] },
    ]
    const result = compareMenuReplacement({
      google: [{ sections }],
      draft: [{ sections: [...sections].reverse() }],
    })
    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((row) => row.field.endsWith("order"))).toBe(true)
  })
  it("shows an empty section removal without calling it a concurrent conflict", () => {
    const result = compareMenuReplacement({
      google: menu([], "Empty"),
      draft: [{ labels: [{ displayName: "Menu" }], sections: [] }],
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.after).toBe("Removed from Google")
    expect(result.rows[0]?.state).not.toBe("conflict")
    expect(result.publishable).toBe(true)
  })
  it("shows additional translations and arbitrary replacement fields", () => {
    const google = menu([
      {
        ...item(),
        labels: [
          ...item().labels,
          { languageCode: "fr", description: "Soupe" },
        ],
        custom: { enabled: true },
      },
    ])
    const rows = menuChangeRows({ google, draft: menu([item()]) })
    expect(
      rows.some((row) => row.before === "Soupe" && row.after === "Removed")
    ).toBe(true)
    expect(
      rows.some((row) => row.before === "true" && row.after === "Removed")
    ).toBe(true)
  })
  it("uses collision-free keys across matches additions and removals", () => {
    const rows = menuChangeRows({
      google: menu([item("A"), item("B")]),
      draft: menu([item("B")]),
    })
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
    expect(rows).toHaveLength(2)
  })
  it("ignores object property ordering but preserves data without mutation", () => {
    const google = menu([item()])
    const snapshot = structuredClone(google)
    const draft = menu([
      { attributes: item().attributes, labels: item().labels },
    ])
    const result = compareMenuReplacement({ google, draft })
    expect(result.rows).toEqual([])
    expect(google).toEqual(snapshot)
    expect(result.publishable).toBe(true)
  })
})

describe("structural replacement fields", () => {
  it("exposes added empty objects rather than claiming equal hashes", () => {
    const result = compareMenuReplacement({
      google: menu([item()]),
      draft: menu([{ ...item(), nutrition: {} }]),
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ before: "Not set", after: "{}" })
  })
  it("exposes an omitted empty collection in the replacement", () => {
    const result = compareMenuReplacement({
      google: [{ sections: [] }],
      draft: [{}],
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.after).toBe("Removed")
  })
})

describe("duplicate positions", () => {
  it("keeps an equal duplicate in its own position when another occurrence is edited", () => {
    const result = compareMenuReplacement({
      google: menu([item(), item()]),
      draft: menu([item("Changed"), item()]),
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      before: "Fresh soup",
      after: "Changed",
    })
  })
})

describe("uncertainty presentation", () => {
  it("shows readable occurrence summaries for a blocked comparison", () => {
    const google = menu([item("A"), item("B")])
    const draft = menu([item("C"), item("D")])
    const result = compareMenuReplacement({ google, draft })
    expect(result.publishable).toBe(false)
    expect(result.rows[0]).toMatchObject({
      blocking: true,
      explanation: expect.stringContaining("cannot be matched reliably"),
      before: "2 entries: 1. Soup — A — £6.00; 2. Soup — B — £6.00",
      after: "2 entries: 1. Soup — C — £6.00; 2. Soup — D — £6.00",
    })
  })
})
