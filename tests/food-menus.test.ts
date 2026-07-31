import { describe, expect, it } from "vitest"

import { foodMenuCounts, hashFoodMenus } from "@/lib/domain/food-menus"

describe("Food Menus domain", () => {
  const menus = [{
    labels: [{ displayName: "Main", languageCode: "en-GB" }],
    sections: [{
      labels: [{ displayName: "Mains", languageCode: "en-GB" }],
      items: [{
        labels: [{ displayName: "Pie", languageCode: "en-GB" }],
        attributes: { price: { currencyCode: "GBP", units: "12", nanos: 0 } },
        options: [{ labels: [{ displayName: "Chips", languageCode: "en-GB" }], attributes: {} }],
      }],
    }],
  }]

  it("hashes recursively with stable object-key ordering", () => {
    const reordered = JSON.parse(JSON.stringify(menus))
    reordered[0].sections[0].items[0].attributes = {
      price: { nanos: 0, units: "12", currencyCode: "GBP" },
    }
    expect(hashFoodMenus(menus)).toBe(hashFoodMenus(reordered))
  })

  it("counts complete projected hierarchy", () => {
    expect(foodMenuCounts(menus)).toEqual({ menus: 1, sections: 1, items: 1, options: 1 })
  })
})
