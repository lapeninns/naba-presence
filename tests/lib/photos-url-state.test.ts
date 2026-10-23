import { describe, expect, it } from "vitest"

import {
  hasActivePhotoFilters,
  parsePhotosState,
  serializePhotosState,
  toMediaQuery,
} from "@/lib/locations/photos-url-state"

describe("photos url state", () => {
  it("defaults to no filters", () => {
    const state = parsePhotosState(new URLSearchParams())
    expect(state).toEqual({ ownership: "all", category: "all" })
    expect(hasActivePhotoFilters(state)).toBe(false)
    expect(toMediaQuery(state)).toEqual({
      category: null,
      ownership: null,
    })
  })

  it("parses ownership and category, and ignores an old page", () => {
    const state = parsePhotosState(
      new URLSearchParams("page=3&ownership=customer&category=INTERIOR")
    )
    expect(state).toEqual({
      ownership: "customer",
      category: "INTERIOR",
    })
    expect(hasActivePhotoFilters(state)).toBe(true)
    expect(toMediaQuery(state)).toEqual({
      category: "INTERIOR",
      ownership: "customer",
    })
  })

  it("falls back to the defaults for unknown or malformed values", () => {
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
        ownership: "all",
        category: "all",
      }).toString()
    ).toBe("")
  })

  it("serialises only the non-default parts", () => {
    expect(
      serializePhotosState({
        ownership: "merchant",
        category: "EXTERIOR",
      }).toString()
    ).toBe("ownership=merchant&category=EXTERIOR")
  })

  it("round-trips through parse", () => {
    const state = {
      ownership: "customer" as const,
      category: "MENU" as const,
    }
    expect(parsePhotosState(serializePhotosState(state))).toEqual(state)
  })

  it("preserves unrelated params and drops stale photo params", () => {
    const current = new URLSearchParams("tab=x&page=9&ownership=merchant")
    const next = serializePhotosState(
      { ownership: "all", category: "COVER" },
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
