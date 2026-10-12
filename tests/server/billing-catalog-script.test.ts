import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterAll, describe, expect, it } from "vitest"

import {
  describeActions,
  parseCatalog,
  planCatalogChanges,
  refusal,
} from "../../scripts/billing-catalog.mjs"

/**
 * scripts/billing-catalog.mjs (plan P07-S7): the reviewed-JSON catalog seed.
 * The planner is pure, so the dry run is pinned here without a database;
 * the CLI is run for the paths that never reach one (--validate and the
 * live refusal).
 */

const starter = {
  code: "starter",
  version: 1,
  workspaceMode: "business",
  name: "Starter",
  stripePriceId: "price_Starter1",
  locationLimit: 3,
  memberLimit: null,
  aiDraftCreditsPerPeriod: 100,
  isTestOffer: true,
  active: true,
}

const testCatalog = (plans: unknown[] = [starter]) => {
  const parsed = parseCatalog({ environment: "test", plans })
  if (!parsed.catalog) throw new Error(parsed.problems.join("; "))
  return parsed.catalog
}

const row = (overrides: Record<string, unknown> = {}) => ({
  ...starter,
  environment: "test",
  ...overrides,
})

describe("billing catalog file validation", () => {
  it("accepts a valid test catalog and normalises optional fields", () => {
    const bare: Record<string, unknown> = { ...starter }
    delete bare.stripePriceId
    delete bare.memberLimit
    const parsed = parseCatalog({
      environment: "test",
      plans: [{ ...bare, active: false }],
    })
    expect(parsed.problems).toEqual([])
    expect(parsed.catalog?.plans[0]).toMatchObject({
      stripePriceId: null,
      memberLimit: null,
      active: false,
    })
  })

  it("mirrors the table's checks and the file's own consistency", () => {
    const { problems } = parseCatalog({
      environment: "test",
      plans: [
        { ...starter, code: "Starter", isTestOffer: false },
        { ...starter, stripePriceId: null },
        { ...starter, version: 0, locationLimit: 0, memberLimit: 0 },
        { ...starter, aiDraftCreditsPerPeriod: -1, workspaceMode: "team" },
        { ...starter, code: "other", stripePriceId: "prod_x" },
      ],
    })
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/plans\[0\]\.code/),
        "plans[0]: every test-environment plan is a test offer (isTestOffer: true)",
        "plans[1]: an active plan needs its stripePriceId",
        "plans[3]: starter@1 is listed twice",
        "plans[2].version must be an integer >= 1",
        "plans[2].locationLimit must be an integer >= 1",
        "plans[2].memberLimit must be null or an integer >= 1",
        "plans[3].aiDraftCreditsPerPeriod must be an integer >= 0",
        "plans[3].workspaceMode must be one of business | agency",
        "plans[3]: price_Starter1 is used by two plans",
        "plans[4].stripePriceId must be null or a Stripe price id (price_...)",
      ])
    )
  })

  it("refuses a live test offer, an unknown environment and an empty file", () => {
    expect(
      parseCatalog({ environment: "live", plans: [starter] }).problems
    ).toEqual(["plans[0]: a live plan cannot be a test offer"])
    expect(parseCatalog({ environment: "prod", plans: [] }).problems).toEqual([
      "environment must be one of test | live",
      "plans must be a non-empty array",
    ])
    expect(parseCatalog([]).problems).toEqual([
      "the file must be a JSON object",
    ])
  })
})

describe("billing catalog dry run", () => {
  it("inserts a missing version and leaves a matching one unchanged", () => {
    const plus = {
      ...starter,
      code: "plus",
      name: "Plus",
      stripePriceId: "price_Plus1",
    }
    const result = planCatalogChanges(testCatalog([starter, plus]), [row()])
    expect(result.problems).toEqual([])
    expect(result.actions.map((a: { type: string }) => a.type)).toEqual([
      "unchanged",
      "insert",
    ])
    expect(result.writes).toHaveLength(1)
    expect(describeActions(result.actions)).toEqual([
      "  = starter@1 unchanged",
      '  + insert plus@1 "Plus" (business, 3 location(s), 100 AI credits, price_Plus1) active',
    ])
  })

  it("is repeatable: a second run against its own result writes nothing", () => {
    const catalog = testCatalog()
    const first = planCatalogChanges(catalog, [])
    expect(first.writes).toHaveLength(1)
    const second = planCatalogChanges(catalog, [row()])
    expect(second.writes).toEqual([])
  })

  it("only toggles active on an existing version", () => {
    const result = planCatalogChanges(
      testCatalog([{ ...starter, active: false }]),
      [row()]
    )
    expect(result.actions).toEqual([
      expect.objectContaining({ type: "deactivate", key: "starter@1" }),
    ])
    expect(
      planCatalogChanges(testCatalog(), [row({ active: false })]).actions[0]
        .type
    ).toBe("activate")
  })

  it("refuses changed terms on a published version", () => {
    const result = planCatalogChanges(testCatalog(), [
      row({ aiDraftCreditsPerPeriod: 50, name: "Old starter" }),
    ])
    expect(result.problems).toEqual([
      "starter@1: terms differ in the database (name, aiDraftCreditsPerPeriod); published terms are immutable, add a new version",
    ])
    expect(result.writes).toEqual([])
  })

  it("reports an unlisted active plan and retires it only when asked", () => {
    const legacy = row({ code: "legacy", stripePriceId: "price_Legacy1" })
    const inactive = row({ code: "old", stripePriceId: null, active: false })
    const kept = planCatalogChanges(testCatalog(), [row(), legacy, inactive])
    expect(kept.actions.map((a: { type: string }) => a.type)).toEqual([
      "unchanged",
      "unlisted",
    ])
    expect(kept.writes).toEqual([])
    const retired = planCatalogChanges(
      testCatalog(),
      [row(), legacy, inactive],
      { deactivateUnlisted: true }
    )
    expect(retired.writes).toEqual([
      expect.objectContaining({ type: "deactivate", key: "legacy@1" }),
    ])
  })

  it("ignores the other environment's rows", () => {
    const result = planCatalogChanges(testCatalog(), [
      row({ environment: "live", isTestOffer: false, name: "Live starter" }),
    ])
    expect(result.actions.map((a: { type: string }) => a.type)).toEqual([
      "insert",
    ])
  })

  it("needs --allow-live to apply a live catalog", () => {
    const live = { environment: "live", plans: [] }
    expect(refusal(live, { apply: true, allowLive: false })).toMatch(
      /--allow-live/
    )
    expect(refusal(live, { apply: false, allowLive: false })).toBeNull()
    expect(refusal(live, { apply: true, allowLive: true })).toBeNull()
    expect(
      refusal({ environment: "test", plans: [] }, { apply: true })
    ).toBeNull()
  })
})

describe("billing catalog CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "billing-catalog-"))
  const script = fileURLToPath(
    new URL("../../scripts/billing-catalog.mjs", import.meta.url)
  )
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const run = (file: object, args: string[]) => {
    const path = join(dir, `${crypto.randomUUID()}.json`)
    writeFileSync(path, JSON.stringify(file))
    // No database URL: none of these paths may reach one.
    const env = { ...process.env }
    delete env.DIRECT_DATABASE_URL
    delete env.DATABASE_URL
    return spawnSync(process.execPath, [script, "--file", path, ...args], {
      encoding: "utf8",
      env,
      cwd: dir,
    })
  }

  it("validates a file without a database", () => {
    const result = run({ environment: "test", plans: [starter] }, [
      "--validate",
    ])
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Valid. No database was read.")
  })

  it("refuses to apply a live catalog without --allow-live", () => {
    const result = run(
      { environment: "live", plans: [{ ...starter, isTestOffer: false }] },
      ["--apply"]
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "refusing to change the live catalog without --allow-live"
    )
  })

  it("refuses an invalid file before anything else", () => {
    const result = run({ environment: "test", plans: [] }, ["--apply"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("plans must be a non-empty array")
  })
})
