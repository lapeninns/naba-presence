import { describe, expect, it } from "vitest"

import {
  parseDatabasePoolMax,
  parseFeatureFlag,
} from "@/lib/server/env"

describe("feature flags", () => {
  it("treats empty string as the documented default, not true", () => {
    expect(parseFeatureFlag("", true)).toBe(true)
    expect(parseFeatureFlag("", false)).toBe(false)
    expect(parseFeatureFlag(undefined, false)).toBe(false)
    expect(parseFeatureFlag("true", false)).toBe(true)
    expect(parseFeatureFlag("false", true)).toBe(false)
  })
})

describe("database pool sizing", () => {
  it("uses ten by default and accepts a bounded positive integer", () => {
    expect(parseDatabasePoolMax(undefined)).toBe(10)
    expect(parseDatabasePoolMax("")).toBe(10)
    expect(parseDatabasePoolMax("3")).toBe(3)
    expect(() => parseDatabasePoolMax("0")).toThrow()
    expect(() => parseDatabasePoolMax("3.5")).toThrow()
    expect(() => parseDatabasePoolMax("101")).toThrow()
  })
})
