import { describe, expect, it } from "vitest"

import {
  hasActivePhotoFilters,
  parsePhotosState,
  serializePhotosState,
  toMediaQuery,
} from "@/lib/locations/photos-url-state"

describe("photos url state", () => {
  it("defaults to page 1 with no filters", () => {
    const state = parsePhotosState(new URLSearchParams())
    expect(state).toEqual({ page: 1, ownership: "all", category: "all" })
    expect(hasActivePhotoFilters(state)).toBe(false)
    expect(toMediaQuery(state)).toEqual({
      page: 1,
      category: null,
      ownership: null,
    })
  })

  it("parses page, ownership and category", () => {
    const state = parsePhotosState(
      new URLSearchParams("page=3&ownership=customer&category=INTERIOR")
    )
    expect(state).toEqual({
      page: 3,
      ownership: "customer",
      category: "INTERIOR",
    })
    expect(hasActivePhotoFilters(state)).toBe(true)
    expect(toMediaQuery(state)).toEqual({
      page: 3,
      category: "INTERIOR",
      ownership: "customer",
    })
  })

  it("falls back to the defaults for unknown or malformed values", () => {
    expect(parsePhotosState(new URLSearchParams("page=0"))).toMatchObject({
      page: 1,
    })
    expect(parsePhotosState(new URLSearchParams("page=-2"))).toMatchObject({
      page: 1,
    })
    expect(parsePhotosState(new URLSearchParams("page=abc"))).toMatchObject({
      page: 1,
    })
    expect(parsePhotosState(new URLSearchParams("page=1.5"))).toMatchObject({
      page: 1,
    })
    expect(
      parsePhotosState(new URLSearchParams("ownership=google"))
    ).toMatchObject({
      ownership: "all",
    })
    expect(
      parsePhotosState(new URLSearchParams("category=SELFIE"))
    ).toMatchObject({
      category: "all",
    })
  })

  it("omits every default from the URL", () => {
    expect(
      serializePhotosState({
        page: 1,
        ownership: "all",
        category: "all",
      }).toString()
    ).toBe("")
  })

  it("serialises only the non-default parts", () => {
    expect(
      serializePhotosState({
        page: 2,
        ownership: "all",
        category: "all",
      }).toString()
    ).toBe("page=2")
    expect(
      serializePhotosState({
        page: 1,
        ownership: "merchant",
        category: "EXTERIOR",
      }).toString()
    ).toBe("ownership=merchant&category=EXTERIOR")
  })

  it("round-trips through parse", () => {
    const state = {
      page: 4,
      ownership: "customer" as const,
      category: "MENU" as const,
    }
    expect(parsePhotosState(serializePhotosState(state))).toEqual(state)
  })

  it("preserves unrelated params and replaces stale photo params", () => {
    const current = new URLSearchParams("tab=x&page=9&ownership=merchant")
    const next = serializePhotosState(
      { page: 1, ownership: "all", category: "COVER" },
      current
    )
    expect(next.get("tab")).toBe("x")
    expect(next.has("page")).toBe(false)
    expect(next.has("ownership")).toBe(false)
    expect(next.get("category")).toBe("COVER")
    // the input is not mutated
    expect(current.get("page")).toBe("9")
  })
})
