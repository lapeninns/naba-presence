import { describe, expect, it } from "vitest"

import {
  parseDatabasePoolMax,
  parseFeatureFlag,
  serverEnvSchema,
} from "@/lib/server/env"

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
    expect(env.GBP_LODGING_ENABLED).toBe(false)
    expect(env.ACTIONS_CENTER_ENABLED).toBe(false)
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
