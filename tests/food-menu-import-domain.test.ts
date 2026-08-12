import { describe, expect, it } from "vitest"

import {
  applyFoodMenuPatch,
  buildFoodMenuProposals,
  diffMenuItem,
  flattenMenuItems,
  identitiesFromAlignedMenus,
  matchMenuItems,
  MenuPatchTargetMissingError,
  type MenuItemIdentity,
} from "@/lib/domain/food-menu-import"
import { planDecision, ProposalDecisionError } from "@/lib/domain/import-review"

function item(name: string, price?: { units: string; nanos?: number }, extra: Record<string, unknown> = {}) {
  return {
    labels: [{ displayName: name, ...(typeof extra.description === "string" ? { description: extra.description } : {}) }],
    ...(price
      ? { attributes: { price: { currencyCode: "GBP", units: price.units, nanos: price.nanos ?? 0 }, ...(extra.attributes as Record<string, unknown> ?? {}) } }
      : extra.attributes
        ? { attributes: extra.attributes }
        : {}),
    ...(extra.options ? { options: extra.options } : {}),
  }
}

function menu(sections: Array<{ label: string; items: Array<Record<string, unknown>> }>) {
  return [
    {
      labels: [{ displayName: "Menu" }],
      sections: sections.map((section) => ({
        labels: [{ displayName: section.label }],
        items: section.items,
      })),
    },
  ]
}

describe("menu item match ladder", () => {
  const canonical = menu([{ label: "Mains", items: [item("Fish & Chips", { units: "12" }), item("Burger", { units: "10" })] }])
  const google = menu([{ label: "Mains", items: [item("Fish & Chips", { units: "12" }), item("Burger", { units: "10" })] }])

  it("trusts a previous identity only after labels re-verify", () => {
    const identities: MenuItemIdentity[] = [
      {
        googlePath: "menus[0].sections[0].items[0]",
        localPath: "menus[0].sections[0].items[0]",
        sectionLabel: "Mains",
        itemLabel: "Fish & Chips",
        priceUnits: "12",
        priceNanos: 0,
      },
    ]
    const matches = matchMenuItems({
      canonicalItems: flattenMenuItems(canonical),
      googleItems: flattenMenuItems(google),
      identities,
    })
    const pinned = matches.find((match) => match.google?.itemLabel === "Fish & Chips")
    expect(pinned?.status).toBe("previous_identity")
    expect(pinned?.confidence).toBe(1)
  })

  it("rejects a stale identity whose labels moved and falls back to label matching", () => {
    const identities: MenuItemIdentity[] = [
      {
        googlePath: "menus[0].sections[0].items[0]",
        localPath: "menus[0].sections[0].items[1]", // points at Burger — labels will not verify
        sectionLabel: "Mains",
        itemLabel: "Fish & Chips",
        priceUnits: "12",
        priceNanos: 0,
      },
    ]
    const matches = matchMenuItems({
      canonicalItems: flattenMenuItems(canonical),
      googleItems: flattenMenuItems(google),
      identities,
    })
    const fish = matches.find((match) => match.google?.itemLabel === "Fish & Chips")
    expect(fish?.status).toBe("label_price")
  })

  it("disambiguates duplicate labels by price within a penny", () => {
    const local = menu([
      { label: "Wine", items: [item("House Red", { units: "6" }), item("House Red", { units: "22" })] },
    ])
    const remote = menu([
      { label: "Wine", items: [item("House Red", { units: "6", nanos: 5_000_000 }), item("House Red", { units: "22" })] },
    ])
    const matches = matchMenuItems({
      canonicalItems: flattenMenuItems(local),
      googleItems: flattenMenuItems(remote),
      identities: [],
    })
    const glasses = matches.filter((match) => match.status === "label_price")
    expect(glasses).toHaveLength(2)
  })

  it("leaves ambiguous same-label same-price rows unmatched", () => {
    const local = menu([{ label: "Wine", items: [item("House Red", { units: "6" }), item("House Red", { units: "6" })] }])
    const remote = menu([{ label: "Wine", items: [item("House Red", { units: "6" })] }])
    const matches = matchMenuItems({
      canonicalItems: flattenMenuItems(local),
      googleItems: flattenMenuItems(remote),
      identities: [],
    })
    expect(matches.every((match) => match.status === "unmatched")).toBe(true)
  })

  it("matches unique labels without price", () => {
    const local = menu([{ label: "Mains", items: [item("Pie")] }])
    const remote = menu([{ label: "Mains", items: [item("Pie", { units: "14" })] }])
    const matches = matchMenuItems({
      canonicalItems: flattenMenuItems(local),
      googleItems: flattenMenuItems(remote),
      identities: [],
    })
    expect(matches[0].status).toBe("label_unique")
  })
})

describe("menu item minimal diff", () => {
  const flat = (menus: Array<Record<string, unknown>>) => flattenMenuItems(menus)[0]

  it("returns null when nothing differs", () => {
    const local = flat(menu([{ label: "Mains", items: [item("Pie", { units: "14" })] }]))
    const google = flat(menu([{ label: "Mains", items: [item("Pie", { units: "14" })] }]))
    expect(diffMenuItem(local, google)).toBeNull()
  })

  it("includes only changed fields with real Google values", () => {
    const local = flat(menu([{ label: "Mains", items: [item("Pie", { units: "14" }, { description: "Beef" })] }]))
    const google = flat(menu([{ label: "Mains", items: [item("Pie", { units: "15" }, { description: "Beef" })] }]))
    const diff = diffMenuItem(local, google)
    expect(diff?.changedFields).toEqual(["price"])
    expect(diff?.fields["attributes.price"]).toMatchObject({ units: "15" })
  })

  it("never blanks local data when Google is empty — warns instead", () => {
    const local = flat(menu([{ label: "Mains", items: [item("Pie", { units: "14" }, { description: "Beef" })] }]))
    const google = flat(menu([{ label: "Mains", items: [item("Pie", { units: "14" })] }]))
    const diff = diffMenuItem(local, google)
    expect(diff?.changedFields).toEqual([])
    expect(diff?.warnings.join(" ")).toContain("description")
  })

  it("imports dietary attributes only when Google reports them", () => {
    const local = flat(menu([{ label: "Mains", items: [item("Pie", { units: "14" })] }]))
    const google = flat(
      menu([
        {
          label: "Mains",
          items: [item("Pie", { units: "14" }, { attributes: { dietaryRestriction: ["VEGETARIAN"] } })],
        },
      ])
    )
    const diff = diffMenuItem(local, google)
    expect(diff?.fields["attributes.dietaryRestriction"]).toEqual(["VEGETARIAN"])
  })
})

describe("proposal builder", () => {
  it("collapses multi-menu payloads into one structure_changed row", () => {
    const two = [...menu([{ label: "A", items: [] }]), ...menu([{ label: "B", items: [] }])]
    const proposals = buildFoodMenuProposals({
      canonicalMenus: menu([{ label: "A", items: [] }]),
      googleMenus: two,
      identities: [],
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].kind).toBe("structure_changed")
    expect(proposals[0].suggestedPatch.op).toBe("replace_all")
  })

  it("stages changed, added, and missing items", () => {
    const canonical = menu([
      { label: "Mains", items: [item("Pie", { units: "14" }), item("Salad", { units: "9" })] },
    ])
    const google = menu([
      { label: "Mains", items: [item("Pie", { units: "15" }), item("Curry", { units: "13" })] },
    ])
    const proposals = buildFoodMenuProposals({ canonicalMenus: canonical, googleMenus: google, identities: [] })
    const kinds = proposals.map((proposal) => proposal.kind).sort()
    expect(kinds).toEqual(["item_added_on_google", "item_changed", "item_missing_from_google"])
  })

  it("produces no rows when in sync", () => {
    const canonical = menu([{ label: "Mains", items: [item("Pie", { units: "14" })] }])
    expect(
      buildFoodMenuProposals({ canonicalMenus: canonical, googleMenus: canonical, identities: [] })
    ).toHaveLength(0)
  })
})

describe("applyFoodMenuPatch", () => {
  const canonical = menu([{ label: "Mains", items: [item("Pie", { units: "14" }, { description: "Beef" })] }])

  it("merges fields into a re-resolved target", () => {
    const next = applyFoodMenuPatch(canonical, {
      op: "merge_item",
      localPath: "menus[0].sections[0].items[0]",
      sectionLabel: "Mains",
      itemLabel: "Pie",
      fields: { "labels.displayName": "Steak Pie", "attributes.price": { currencyCode: "GBP", units: "15", nanos: 0 } },
    })
    const [updated] = flattenMenuItems(next)
    expect(updated.itemLabel).toBe("Steak Pie")
    expect(updated.description).toBe("Beef")
    expect(updated.price?.units).toBe("15")
  })

  it("throws proposal_target_missing when the item vanished", () => {
    expect(() =>
      applyFoodMenuPatch(canonical, {
        op: "merge_item",
        localPath: "menus[0].sections[0].items[0]",
        sectionLabel: "Mains",
        itemLabel: "Gone",
        fields: {},
      })
    ).toThrow(MenuPatchTargetMissingError)
  })

  it("inserts an item, creating its section when absent", () => {
    const next = applyFoodMenuPatch(canonical, {
      op: "insert_item",
      sectionLabel: "Desserts",
      node: item("Crumble", { units: "7" }),
    })
    const items = flattenMenuItems(next)
    expect(items.map((entry) => entry.sectionLabel)).toContain("Desserts")
  })

  it("removes an item resolved by labels", () => {
    const next = applyFoodMenuPatch(canonical, {
      op: "remove_item",
      localPath: "menus[0].sections[0].items[0]",
      sectionLabel: "Mains",
      itemLabel: "Pie",
    })
    expect(flattenMenuItems(next)).toHaveLength(0)
  })
})

describe("planDecision matrix", () => {
  const base = { status: "processing" as const, resourceType: "food_menus" as const }

  it("plans an apply for a changed item", () => {
    const plan = planDecision({
      action: "apply",
      row: {
        ...base,
        kind: "item_changed",
        suggestedPatch: { op: "merge_item", localPath: "x", sectionLabel: "Mains", itemLabel: "Pie", fields: {} },
      },
    })
    expect(plan.type).toBe("apply_menu_patch")
  })

  it("refuses apply on a missing_from_google row", () => {
    expect(() =>
      planDecision({
        action: "apply",
        row: { ...base, kind: "item_missing_from_google", suggestedPatch: { op: "remove_item", localPath: "x", sectionLabel: "Mains", itemLabel: "Pie" } },
      })
    ).toThrow(ProposalDecisionError)
  })

  it("refuses delete_local on a changed row", () => {
    expect(() =>
      planDecision({
        action: "delete_local",
        row: { ...base, kind: "item_changed", suggestedPatch: { op: "merge_item", localPath: "x", sectionLabel: "Mains", itemLabel: "Pie", fields: {} } },
      })
    ).toThrow(ProposalDecisionError)
  })

  it("rejects a corrupt stored patch at decision time", () => {
    expect(() =>
      planDecision({
        action: "apply",
        row: { ...base, kind: "item_changed", suggestedPatch: { op: "unknown" } },
      })
    ).toThrow(ProposalDecisionError)
  })

  it("only plans decisions for claimed rows", () => {
    expect(() =>
      planDecision({
        action: "ignore",
        row: { status: "pending", kind: "item_changed", resourceType: "food_menus", suggestedPatch: {} },
      })
    ).toThrow(ProposalDecisionError)
  })
})

describe("identity pins from aligned menus", () => {
  it("pins every item with coinciding paths", () => {
    const aligned = menu([{ label: "Mains", items: [item("Pie", { units: "14" })] }])
    const pins = identitiesFromAlignedMenus(aligned)
    expect(pins).toEqual([
      {
        googlePath: "menus[0].sections[0].items[0]",
        localPath: "menus[0].sections[0].items[0]",
        sectionLabel: "Mains",
        itemLabel: "Pie",
        priceUnits: "14",
        priceNanos: 0,
      },
    ])
  })
})
