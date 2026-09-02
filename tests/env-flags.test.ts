import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import {
  gbpIngestionEnabled,
  gbpWritesEnabled,
  parseDatabasePoolMax,
  parseFeatureFlag,
  serverEnvSchema,
} from "@/lib/server/env"

const baseEnv = {
  DATABASE_URL: "postgresql://localhost/nabapresence",
  NEXTAUTH_SECRET: "n".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  CRON_SECRET: "c".repeat(16),
}

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
    const env = serverEnvSchema.parse({ ...baseEnv })

    expect(env.GBP_PERFORMANCE_ENABLED).toBe(true)
    expect(env.GBP_KEYWORDS_ENABLED).toBe(true)
    expect(env.GBP_POSTS_ENABLED).toBe(true)
    expect(env.GBP_MEDIA_ENABLED).toBe(true)
    expect(env.GBP_FOOD_MENUS_ENABLED).toBe(true)
    expect(env.GBP_PLACE_ACTIONS_ENABLED).toBe(true)
    expect(env.GBP_PROFILE_WRITES_ENABLED).toBe(true)
    expect(env.IMPORT_REVIEW_ENABLED).toBe(true)
  })

  it("defaults the background and retention kill switches on", () => {
    const env = serverEnvSchema.parse({ ...baseEnv })

    expect(env.JOBS_ENABLED).toBe(true)
    expect(env.SEMANTIC_VERIFY_ENABLED).toBe(true)
    expect(env.RETENTION_ENABLED).toBe(true)
    expect(env.RETENTION_DELETES_ENABLED).toBe(true)
  })

  it('turns each background and retention kill switch off on "false"', () => {
    const env = serverEnvSchema.parse({
      ...baseEnv,
      JOBS_ENABLED: "false",
      SEMANTIC_VERIFY_ENABLED: "false",
      RETENTION_ENABLED: "false",
      RETENTION_DELETES_ENABLED: "false",
    })

    expect(env.JOBS_ENABLED).toBe(false)
    expect(env.SEMANTIC_VERIFY_ENABLED).toBe(false)
    expect(env.RETENTION_ENABLED).toBe(false)
    expect(env.RETENTION_DELETES_ENABLED).toBe(false)
  })

  it("stops deletes without stopping the rest of retention", () => {
    const env = serverEnvSchema.parse({
      ...baseEnv,
      RETENTION_DELETES_ENABLED: "false",
    })

    expect(env.RETENTION_ENABLED).toBe(true)
    expect(env.RETENTION_DELETES_ENABLED).toBe(false)
  })

  it("no longer declares the deleted lodging and Actions Center stubs", () => {
    expect(Object.keys(serverEnvSchema.shape)).not.toContain(
      "GBP_LODGING_ENABLED"
    )
    expect(Object.keys(serverEnvSchema.shape)).not.toContain(
      "ACTIONS_CENTER_ENABLED"
    )
  })
})

describe("per-surface GBP kill switches", () => {
  it("allows writes only when the global publish control and the surface flag are both on", () => {
    expect(gbpWritesEnabled(allOn, "profileWrites")).toBe(true)
    expect(
      gbpWritesEnabled({ ...allOn, PUBLISH_ENABLED: false }, "profileWrites")
    ).toBe(false)
    expect(
      gbpWritesEnabled(
        { ...allOn, GBP_PROFILE_WRITES_ENABLED: false },
        "profileWrites"
      )
    ).toBe(false)
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
    expect(
      gbpIngestionEnabled({ ...allOn, PUBLISH_ENABLED: false }, "performance")
    ).toBe(true)
    expect(
      gbpIngestionEnabled({ ...allOn, PUBLISH_ENABLED: false }, "keywords")
    ).toBe(true)
    expect(
      gbpIngestionEnabled(
        { ...allOn, GBP_PERFORMANCE_ENABLED: false },
        "performance"
      )
    ).toBe(false)
    expect(
      gbpIngestionEnabled(
        { ...allOn, GBP_PERFORMANCE_ENABLED: false },
        "keywords"
      )
    ).toBe(true)
    expect(
      gbpIngestionEnabled({ ...allOn, GBP_KEYWORDS_ENABLED: false }, "keywords")
    ).toBe(false)
  })
})

describe("provider timeouts", () => {
  it("defaults the OpenAI timeout to thirty seconds", () => {
    expect(serverEnvSchema.parse({ ...baseEnv }).OPENAI_TIMEOUT_MS).toBe(30_000)
    expect(
      serverEnvSchema.parse({ ...baseEnv, OPENAI_TIMEOUT_MS: "45000" })
        .OPENAI_TIMEOUT_MS
    ).toBe(45_000)
  })

  it("rejects an OpenAI timeout that could outlast the transaction holding it", () => {
    expect(() =>
      serverEnvSchema.parse({ ...baseEnv, OPENAI_TIMEOUT_MS: "60000" })
    ).toThrow()
    expect(() =>
      serverEnvSchema.parse({ ...baseEnv, OPENAI_TIMEOUT_MS: "0" })
    ).toThrow()
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

// The drift this guards is not hypothetical: JOBS_ENABLED,
// SEMANTIC_VERIFY_ENABLED and both RETENTION_* switches shipped in the schema
// and stayed out of .env.example, so the only record of a kill switch an
// operator has to set was the runbook prose describing it.
describe(".env.example", () => {
  const example = readFileSync(
    fileURLToPath(new URL("../.env.example", import.meta.url)),
    "utf8"
  )
  const documented = new Set(
    example
      .split("\n")
      .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
      .filter((name): name is string => Boolean(name))
  )

  it("documents every key the server env schema reads", () => {
    const missing = Object.keys(serverEnvSchema.shape).filter(
      (key) => !documented.has(key)
    )
    expect(missing).toEqual([])
  })

  // The reverse direction catches a key deleted from the schema and left in
  // the sample, which reads as a supported control and silently is not one.
  // The scheduler's own variables are the deliberate exception: it is a plain
  // node script that never parses serverEnvSchema.
  it("documents nothing the schema and the scheduler both ignore", () => {
    const schedulerOnly = new Set(
      [
        ...readFileSync(
          fileURLToPath(new URL("../scripts/scheduler.mjs", import.meta.url)),
          "utf8"
        ).matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[["'`]?([A-Z0-9_]+))/g),
      ]
        .map((match) => match[1] ?? match[2])
        .concat([
          // Read through interval(name, ...) rather than a literal
          // process.env reference.
          "RECONCILE_INTERVAL_SECONDS",
          "RETENTION_INTERVAL_SECONDS",
          "SWEEP_INTERVAL_SECONDS",
          "JOBS_INTERVAL_SECONDS",
          "PERFORMANCE_INTERVAL_SECONDS",
          "KEYWORD_INTERVAL_SECONDS",
          "PRESENCE_RESOURCE_RECONCILE_INTERVAL_SECONDS",
          "RETENTION_ENABLED",
        ])
    )
    // Per-page cron budgets are read straight from process.env in the route
    // handlers rather than through the schema; see docs/runbook.md.
    const routeBudgets = new Set([
      "RECONCILE_BUDGET_MS",
      "RETENTION_BUDGET_MS",
      "PERFORMANCE_BUDGET_MS",
      "KEYWORDS_BUDGET_MS",
      "PRESENCE_RESOURCE_BUDGET_MS",
      "NEXT_OTEL_VERBOSE",
      "OTEL_EXPORTER_OTLP_ENDPOINT",
    ])
    const schemaKeys = new Set(Object.keys(serverEnvSchema.shape))
    const orphans = [...documented].filter(
      (key) =>
        !schemaKeys.has(key) && !schedulerOnly.has(key) && !routeBudgets.has(key)
    )
    expect(orphans).toEqual([])
  })
})
