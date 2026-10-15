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
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      field: "Menu · Menu · Starters · Soup · Price",
      before: "£6.00",
      after: "EUR 7.000000001",
    })
  })
  it("shows a removed price as one row in pounds", () => {
    const rows = menuChangeRows({
      google: menu([item()]),
      draft: menu([{ labels: item().labels }]),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ before: "£6.00", after: "Removed" })
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
    expect(rows[0]?.before).toBe(
      "Label: Small, Price: 5; Label: Large, Price: 9"
    )
    expect(rows[0]?.after).toBe(
      "Label: Large, Price: 9; Label: Small, Price: 5"
    )
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
      rows.some((row) => row.before === "Yes" && row.after === "Removed")
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
    expect(result.rows[0]).toMatchObject({ before: "Not set", after: "Empty" })
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

describe("readable rows at consent", () => {
  function section(name: string, items: Array<Record<string, unknown>>) {
    return { labels: [{ displayName: name }], items }
  }
  function whole(name: string, sections: Array<Record<string, unknown>>) {
    return { labels: [{ displayName: name }], sections }
  }
  function expectNoJson(
    rows: ReadonlyArray<{ before: string; after: string }>
  ) {
    for (const row of rows) {
      for (const value of [row.before, row.after]) {
        expect(value).not.toMatch(/^[{[]/)
        expect(value).not.toMatch(/"(units|nanos|labels|displayName)"/)
        expect(value).not.toMatch(/nanos|units/)
      }
    }
  }
  const priced = {
    labels: [{ displayName: "Burger", description: "Beef, cheese" }],
    attributes: {
      price: { currencyCode: "GBP", units: "16", nanos: 500000000 },
    },
  }

  it("shows an added menu with its counts, then every section and dish", () => {
    const rows = menuChangeRows({
      google: [],
      draft: [whole("Lunch", [section("Mains", [priced, item()])])],
    })
    expect(rows.map((row) => row.after)).toEqual([
      "Lunch — 1 section · 2 items",
      "Mains — 2 items",
      "Burger — Beef, cheese — £16.50",
      "Soup — Fresh soup — £6.00",
    ])
    expect(rows.every((row) => row.before === "Not on Google")).toBe(true)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
    expectNoJson(rows)
  })
  it("shows a removed menu and everything in it in words", () => {
    const rows = menuChangeRows({
      google: [whole("Lunch", [section("Mains", [priced])])],
      draft: [],
    })
    expect(rows.map((row) => row.before)).toEqual([
      "Lunch — 1 section · 1 item",
      "Mains — 1 item",
      "Burger — Beef, cheese — £16.50",
    ])
    expect(rows.every((row) => row.after === "Removed from Google")).toBe(true)
    expectNoJson(rows)
  })
  it("shows an added item with its description and £16.50 price", () => {
    const rows = menuChangeRows({
      google: [whole("Menu", [section("Mains", [])])],
      draft: [whole("Menu", [section("Mains", [priced])])],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.after).toBe("Burger — Beef, cheese — £16.50")
    expectNoJson(rows)
  })
  it("shows a removed section and its dishes in words", () => {
    const rows = menuChangeRows({
      google: [whole("Menu", [section("Mains", [priced, item()])])],
      draft: [whole("Menu", [])],
    })
    expect(rows.map((row) => row.before)).toEqual([
      "Mains — 2 items",
      "Burger — Beef, cheese — £16.50",
      "Soup — Fresh soup — £6.00",
    ])
    expectNoJson(rows)
  })
  it("shows a changed price as pounds, not currency, units and nanos", () => {
    const cheaper = {
      ...priced,
      attributes: { price: { currencyCode: "GBP", units: "15", nanos: 0 } },
    }
    const rows = menuChangeRows({
      google: [whole("Menu", [section("Mains", [priced])])],
      draft: [whole("Menu", [section("Mains", [cheaper])])],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ before: "£16.50", after: "£15.00" })
    expect(rows[0]?.field).toMatch(/Price$/)
    expectNoJson(rows)
  })
  it("never shows JSON for nested or unlabelled values", () => {
    const rows = menuChangeRows({
      google: menu([{ ...item(), nutrition: { calories: 400, tags: ["a"] } }]),
      draft: menu([
        {
          ...item(),
          nutrition: { calories: 450, tags: ["a", "b"] },
          extra: [{ note: { deep: true } }],
        },
      ]),
    })
    expect(rows.length).toBeGreaterThan(0)
    expectNoJson(rows)
  })
})
