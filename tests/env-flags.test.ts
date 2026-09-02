import { describe, expect, it } from "vitest"

import {
  gbpIngestionEnabled,
  gbpWritesEnabled,
  parseDatabasePoolMax,
  parseFeatureFlag,
  serverEnvSchema,
} from "@/lib/server/env"

const allOn = {
  PUBLISH_ENABLED: true,
  GBP_PROFILE_WRITES_ENABLED: true,
  GBP_POSTS_ENABLED: true,
  GBP_MEDIA_ENABLED: true,
  GBP_PLACE_ACTIONS_ENABLED: true,
  GBP_FOOD_MENUS_ENABLED: true,
  GBP_PERFORMANCE_ENABLED: true,
  GBP_KEYWORDS_ENABLED: true,
}

describe("feature flags", () => {
  it("treats empty string as the documented default, not true", () => {
    expect(parseFeatureFlag("", true)).toBe(true)
    expect(parseFeatureFlag("", false)).toBe(false)
    expect(parseFeatureFlag(undefined, false)).toBe(false)
    expect(parseFeatureFlag("true", false)).toBe(true)
    expect(parseFeatureFlag("false", true)).toBe(false)
  })

  it("defaults product GBP capability flags on", () => {
    const env = serverEnvSchema.parse({
      DATABASE_URL: "postgresql://localhost/nabapresence",
      NEXTAUTH_SECRET: "n".repeat(32),
      TOKEN_ENCRYPTION_KEY: "t".repeat(32),
      CRON_SECRET: "c".repeat(16),
    })

    expect(env.GBP_PERFORMANCE_ENABLED).toBe(true)
    expect(env.GBP_KEYWORDS_ENABLED).toBe(true)
    expect(env.GBP_POSTS_ENABLED).toBe(true)
    expect(env.GBP_MEDIA_ENABLED).toBe(true)
    expect(env.GBP_FOOD_MENUS_ENABLED).toBe(true)
    expect(env.GBP_PLACE_ACTIONS_ENABLED).toBe(true)
    expect(env.GBP_PROFILE_WRITES_ENABLED).toBe(true)
    expect(env.IMPORT_REVIEW_ENABLED).toBe(true)
  })

  it("no longer declares the deleted lodging and Actions Center stubs", () => {
    expect(Object.keys(serverEnvSchema.shape)).not.toContain("GBP_LODGING_ENABLED")
    expect(Object.keys(serverEnvSchema.shape)).not.toContain("ACTIONS_CENTER_ENABLED")
  })
})

describe("per-surface GBP kill switches", () => {
  it("allows writes only when the global publish control and the surface flag are both on", () => {
    expect(gbpWritesEnabled(allOn, "profileWrites")).toBe(true)
    expect(gbpWritesEnabled({ ...allOn, PUBLISH_ENABLED: false }, "profileWrites")).toBe(false)
    expect(gbpWritesEnabled({ ...allOn, GBP_PROFILE_WRITES_ENABLED: false }, "profileWrites")).toBe(false)
  })

  it("maps each write surface to its own flag without touching the others", () => {
    const cases = [
      ["profileWrites", "GBP_PROFILE_WRITES_ENABLED"],
      ["posts", "GBP_POSTS_ENABLED"],
      ["media", "GBP_MEDIA_ENABLED"],
      ["placeActions", "GBP_PLACE_ACTIONS_ENABLED"],
      ["foodMenus", "GBP_FOOD_MENUS_ENABLED"],
    ] as const
    for (const [surface, flag] of cases) {
      const env = { ...allOn, [flag]: false }
      expect(gbpWritesEnabled(env, surface)).toBe(false)
      for (const [other] of cases) {
        if (other !== surface) expect(gbpWritesEnabled(env, other)).toBe(true)
      }
    }
  })

  it("gates ingestion on the surface flag alone, independent of PUBLISH_ENABLED", () => {
    expect(gbpIngestionEnabled({ ...allOn, PUBLISH_ENABLED: false }, "performance")).toBe(true)
    expect(gbpIngestionEnabled({ ...allOn, PUBLISH_ENABLED: false }, "keywords")).toBe(true)
    expect(gbpIngestionEnabled({ ...allOn, GBP_PERFORMANCE_ENABLED: false }, "performance")).toBe(false)
    expect(gbpIngestionEnabled({ ...allOn, GBP_PERFORMANCE_ENABLED: false }, "keywords")).toBe(true)
    expect(gbpIngestionEnabled({ ...allOn, GBP_KEYWORDS_ENABLED: false }, "keywords")).toBe(false)
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
