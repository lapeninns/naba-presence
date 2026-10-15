import { describe, expect, it } from "vitest"

import { countNoun } from "@/components/ui/count-text"

describe("countNoun", () => {
  it("pluralises by count", () => {
    expect(countNoun(0, "item")).toBe("0 items")
    expect(countNoun(1, "item")).toBe("1 item")
    expect(countNoun(3, "section")).toBe("3 sections")
  })

  it("takes an irregular plural", () => {
    expect(countNoun(1, "category", "categories")).toBe("1 category")
    expect(countNoun(2, "category", "categories")).toBe("2 categories")
  })
})
