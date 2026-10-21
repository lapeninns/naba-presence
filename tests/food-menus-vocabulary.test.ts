import { describe, expect, it } from "vitest"

import { foodMenuCounts } from "@/lib/domain/food-menus-vocabulary"

/** The client-safe food-menus counter (lib/domain/food-menus-vocabulary.ts). */

describe("foodMenuCounts", () => {
  it("counts menus, sections, items and options across every menu", () => {
    expect(
      foodMenuCounts([
        {
          sections: [
            { items: [{ options: [{}, {}] }, {}] },
            { items: [{ options: [{}] }] },
          ],
        },
        { sections: [{ items: [] }] },
      ])
    ).toEqual({ menus: 2, sections: 3, items: 3, options: 3 })
  })

  it("skips sections, items and options that are not lists, without throwing", () => {
    expect(
      foodMenuCounts([
        {},
        { sections: "Starters" },
        { sections: [{ items: "none" }, { items: [{ options: "Large" }] }] },
      ])
    ).toEqual({ menus: 3, sections: 2, items: 1, options: 0 })
    expect(foodMenuCounts([])).toEqual({
      menus: 0,
      sections: 0,
      items: 0,
      options: 0,
    })
  })
})
