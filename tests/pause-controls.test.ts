import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { serverEnvSchema, type ServerEnv } from "@/lib/server/env"
import { claimableKinds } from "@/lib/server/jobs"
import {
  pausedTicks,
  tickFindings,
  tickLiveness,
  type TickRow,
} from "@/lib/server/ops-liveness"
import {
  NO_PAUSES,
  PAUSE_ENV_OVERRIDE,
  PAUSE_SCOPES,
  createPauseReader,
  effectiveEnabled,
  pausedScopes,
  scopesEnabled,
  type PauseScope,
  type PauseSnapshot,
} from "@/lib/server/pause-controls"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const env: ServerEnv = serverEnvSchema.parse({
  DATABASE_URL: "postgresql://localhost/nabapresence",
  NEXTAUTH_SECRET: "n".repeat(32),
  TOKEN_ENCRYPTION_KEY: "t".repeat(32),
  CRON_SECRET: "c".repeat(16),
})

const paused = (...scopes: PauseScope[]): PauseSnapshot => ({
  paused: new Set(scopes),
  readFailed: false,
})
const UNREADABLE: PauseSnapshot = { paused: new Set(), readFailed: true }

describe("effectiveEnabled", () => {
  it.each([
    // env, db paused, read-error mode, expected
    [true, false, "closed", true],
    [true, true, "closed", false],
    [false, false, "closed", false],
    [false, true, "closed", false],
    [true, null, "closed", false],
    [true, null, "open", true],
    // An env flag that is off is a hard override, even fail-open.
    [false, null, "open", false],
  ] as const)("env %s, db paused %s, %s -> %s", (envOn, db, mode, expected) => {
    expect(effectiveEnabled(envOn, db, mode)).toBe(expected)
  })

  it("fails closed by default", () => {
    expect(effectiveEnabled(true, null)).toBe(false)
  })
})

describe("scopesEnabled", () => {
  it("needs every scope enabled under both layers", () => {
    expect(scopesEnabled(env, NO_PAUSES, ["publish", "posts"])).toBe(true)
    expect(scopesEnabled(env, paused("posts"), ["publish", "posts"])).toBe(
      false
    )
    expect(
      scopesEnabled({ ...env, PUBLISH_ENABLED: false }, NO_PAUSES, ["posts"])
    ).toBe(true)
    expect(
      scopesEnabled({ ...env, PUBLISH_ENABLED: false }, NO_PAUSES, [
        "publish",
        "posts",
      ])
    ).toBe(false)
  })

  it("treats each env flag as its scope's hard override", () => {
    for (const [scope, flag] of Object.entries(PAUSE_ENV_OVERRIDE)) {
      expect(
        scopesEnabled({ ...env, [flag]: false }, NO_PAUSES, [
          scope as PauseScope,
        ]),
        scope
      ).toBe(false)
    }
  })

  it("lets scopes without an env flag answer to the table alone", () => {
    expect(scopesEnabled(env, NO_PAUSES, ["scheduled_post"])).toBe(true)
    expect(scopesEnabled(env, paused("bulk"), ["bulk"])).toBe(false)
  })

  it("resolves an unreadable table by mode", () => {
    expect(scopesEnabled(env, UNREADABLE, ["publish"])).toBe(false)
    expect(scopesEnabled(env, UNREADABLE, ["publish"], "open")).toBe(true)
  })

  it("names the paused scopes", () => {
    expect(
      pausedScopes({ ...env, SYNC_ENABLED: false }, paused("media"))
    ).toEqual(["sync", "media"])
  })

  it("reserves the scopes later work checks", () => {
    for (const scope of [
      "scheduled_post",
      "bulk",
      "billing",
      "mutation_recover",
      "invitation_email",
    ]) {
      expect(PAUSE_SCOPES).toContain(scope)
    }
  })
})

describe("createPauseReader", () => {
  it("caches a successful read for the TTL and re-reads after it", async () => {
    let clock = 0
    const load = vi.fn(async () => ["publish"])
    const reader = createPauseReader({ load, ttlMs: 5_000, now: () => clock })
    expect([...(await reader.read()).paused]).toEqual(["publish"])
    clock = 4_999
    await reader.read()
    expect(load).toHaveBeenCalledTimes(1)
    clock = 5_000
    load.mockResolvedValueOnce([])
    expect((await reader.read()).paused.size).toBe(0)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("drops the cache on invalidate", async () => {
    const load = vi.fn(async () => [])
    const reader = createPauseReader({ load, now: () => 0 })
    await reader.read()
    reader.invalidate()
    await reader.read()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("does not cache a failure, and reports it as unreadable", async () => {
    const load = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("relation does not exist"))
      .mockResolvedValueOnce(["sync"])
    const reader = createPauseReader({ load, now: () => 0 })
    expect(await reader.read()).toMatchObject({ readFailed: true })
    expect(await reader.read()).toMatchObject({ readFailed: false })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it("shares one in-flight read and ignores unknown scopes", async () => {
    const load = vi.fn(async () => ["posts", "not_a_scope"])
    const reader = createPauseReader({ load, now: () => 0 })
    const [a, b] = await Promise.all([reader.read(), reader.read()])
    expect(load).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect([...a.paused]).toEqual(["posts"])
  })
})

describe("claimableKinds", () => {
  it("claims every kind when nothing is paused", () => {
    expect(claimableKinds(env, NO_PAUSES)).toHaveLength(9)
  })

  it("drops the publish kinds for a publish pause in the table", () => {
    const kinds = claimableKinds(env, paused("publish"))
    expect(kinds).not.toContain("recover")
    expect(kinds).not.toContain("retry")
    expect(kinds).not.toContain("mutation_recover")
    expect(kinds).toContain("webhook")
  })

  it("drops the sync kinds and the ingestion kinds by their own scopes", () => {
    expect(claimableKinds(env, paused("sync"))).toEqual([
      "recover",
      "retry",
      "performance",
      "keywords",
      "mutation_recover",
    ])
    expect(claimableKinds(env, paused("keywords"))).not.toContain("keywords")
  })

  it("claims nothing when jobs is paused or the table is unreadable", () => {
    expect(claimableKinds(env, paused("jobs"))).toEqual([])
    expect(claimableKinds(env, UNREADABLE)).toEqual([])
    expect(claimableKinds({ ...env, JOBS_ENABLED: false }, NO_PAUSES)).toEqual(
      []
    )
  })
})

describe("paused ticks", () => {
  const NOW = new Date("2026-10-10T12:00:00.000Z")
  const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000)
  const row = (name: string, overrides: Partial<TickRow> = {}): TickRow => ({
    name,
    beatAt: ago(10),
    registeredAt: ago(30 * 86_400),
    lastStartedAt: ago(11),
    lastSkippedAt: null,
    consecutiveSkips: 0,
    lastFailedAt: null,
    lastErrorCode: null,
    lastManualCompletedAt: null,
    lastCycleCompletedAt: name === "retention" ? ago(3_600) : null,
    ...overrides,
  })
  const deadRetention = row("retention", {
    beatAt: ago(10 * 86_400),
    lastCycleCompletedAt: ago(10 * 86_400),
    lastFailedAt: ago(60),
    lastErrorCode: "retention_paused",
  })

  it("maps scopes onto the ticks they hold", () => {
    const held = pausedTicks(
      { ...env, NOTIFICATIONS_ENABLED: false },
      paused("sync")
    )
    expect(Object.fromEntries(held)).toEqual({
      reconcile: ["sync"],
      sweep: ["sync"],
      health: ["notifications"],
    })
    // Alerting fails open on an unreadable table.
    expect(pausedTicks(env, UNREADABLE).size).toBe(0)
  })

  it("reports a paused tick as paused and raises no staleness alert", () => {
    const held = pausedTicks(env, paused("retention"))
    const ticks = tickLiveness([deadRetention], NOW, held)
    const retention = ticks.find((tick) => tick.name === "retention")
    expect(retention).toMatchObject({
      stale: true,
      paused: true,
      pausedScopes: ["retention"],
    })
    expect(
      tickFindings(ticks, NOW).filter((f) => f.subject === "retention")
    ).toEqual([])
  })

  it("alerts the same tick once it is not paused", () => {
    const ticks = tickLiveness([deadRetention], NOW)
    expect(
      tickFindings(ticks, NOW)
        .filter((f) => f.subject === "retention")
        .map((f) => f.kind)
    ).toEqual(["stale_heartbeat", "tick_cycle_overdue"])
  })

  it("still reports a wedged lease on a paused tick", () => {
    const ticks = tickLiveness(
      [row("reconcile", { consecutiveSkips: 5, lastSkippedAt: ago(5) })],
      NOW,
      pausedTicks(env, paused("sync"))
    )
    expect(
      tickFindings(ticks, NOW)
        .filter((f) => f.subject === "reconcile")
        .map((f) => f.kind)
    ).toEqual(["tick_lock_wedged"])
  })
})

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0090_pause_controls.sql"),
  "utf8"
)
const noTruncate = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/0091_ops_pause_event_no_truncate.sql"
  ),
  "utf8"
)
const ORG = "00000000-0000-4000-8000-00000000000a"
const OTHER = "00000000-0000-4000-8000-00000000000b"

// Dispatch paths that do not run through runGbpWrite (main's reviewed change
// sets, onboarding, administration, and the bulk and schedule runners) must
// answer to the operator table too, not only the env flags.
describe("dispatch gates outside runGbpWrite", () => {
  const source = (path: string) =>
    readFileSync(join(process.cwd(), path), "utf8")

  it("routes every reviewed change set dispatch through requireGbpDispatch", () => {
    const changeSets = source("lib/server/gbp-change-sets.ts")
    const approved = changeSets.slice(
      changeSets.indexOf("export async function approvedGbpChange")
    )
    expect(approved.slice(0, approved.indexOf("\n}\n"))).toContain(
      "await requireGbpDispatch(surface.scope, surface.paused)"
    )
    // Each resource answers to the surface it writes to: a reviewed Place
    // Action link to placeActions (main's reviewed path is now the only one
    // that writes links), the listing resources to profileWrites.
    expect(approved).toContain(
      'resourceType === "place_action" ? PLACE_ACTION_DISPATCH : LISTING_DISPATCH'
    )
    expect(changeSets).toMatch(
      /const PLACE_ACTION_DISPATCH = \{ scope: "placeActions"/
    )
    expect(changeSets).toMatch(
      /const LISTING_DISPATCH = \{ scope: "profileWrites"/
    )
    // currentPlaceActionContext's requireGbpWrite is the env flag alone, so
    // the reviewed change set gate must run on the Place Action send path.
    const execution = source("lib/server/place-action-execution.ts")
    expect(
      execution.match(
        /await approvedGbpChange\(\{[^}]*resourceType: "place_action"/g
      )
    ).toHaveLength(2)
  })

  it("leaves no env-only google_writes_paused refusal", () => {
    for (const path of [
      "lib/server/gbp-change-sets.ts",
      "lib/server/industry-management.ts",
      "lib/server/google-onboarding-creation.ts",
      "lib/server/google-onboarding-reviews.ts",
      "lib/server/location-administration.ts",
    ]) {
      const text = source(path)
      expect(text, path).not.toMatch(
        /if \(!gbpWritesEnabled\([^)]*\)\)\s*throw new ApiError\(503, "google_writes_paused"/
      )
      expect(text, path).toMatch(
        /requireGbpDispatch\(|requireScopesEnabled\(gbpWriteScopes\(/
      )
    }
  })

  it("holds the bulk and schedule runners off by their surface's scopes", () => {
    expect(source("lib/server/bulk-listing-runner.ts")).toContain(
      "isScopeEnabled(gbpWriteScopes(family.writeSurface))"
    )
    // Read before the schedule's transaction, never inside it.
    const schedules = source("lib/server/publication-schedule-runner.ts")
    expect(schedules).toContain(
      'scopesEnabled(env, pauses, gbpWriteScopes("posts"))'
    )
    expect(
      schedules.indexOf("const pauses = await loadPauseSnapshot()")
    ).toBeLessThan(schedules.indexOf("const plan = await withTenant("))
  })

  // A pooled pause-table read inside a tenant transaction can wait on the
  // connection that transaction holds once the cached snapshot has expired.
  it("reads the pause table before tenant transactions, not inside them", () => {
    // Capabilities take the snapshot from their callers, which load it
    // before tenant()/withTenant().
    expect(source("lib/server/capabilities.ts")).not.toContain(
      "loadPauseSnapshot("
    )
    for (const [path, open] of [
      ["app/api/locations/[id]/capabilities/route.ts", "await tenant("],
      [
        "lib/server/prefetch.ts",
        "locationCapabilities(sql, session, locationId, pauses)",
      ],
    ] as const) {
      const text = source(path)
      expect(text, path).toContain("const pauses = await loadPauseSnapshot()")
      expect(
        text.indexOf("const pauses = await loadPauseSnapshot()"),
        path
      ).toBeLessThan(text.indexOf(open))
    }
    const posts = source("lib/server/posts.ts")
    const decide = posts.slice(posts.indexOf("const decide = async"))
    expect(
      decide.indexOf("const pauses = await loadPauseSnapshot()")
    ).toBeLessThan(decide.indexOf("return withTenant("))
    expect(decide).toContain(
      'await requireGbpDispatch("posts", POSTS_PAUSED, { snapshot: pauses })'
    )
  })
})

describe("0090 pause controls migration", () => {
  it("lets the runtime read and never write", () => {
    for (const table of [
      "ops_pause_control",
      "ops_pause_event",
      "organisation_feature",
    ]) {
      expect(migration).toContain(
        `grant select on ${table} to naba_app_runtime`
      )
      expect(migration).not.toMatch(
        new RegExp(`grant[^;]*(insert|update|delete)[^;]*on ${table}`)
      )
    }
    expect(migration).not.toMatch(
      /grant execute on function set_ops_pause[^;]*naba_app_runtime/
    )
    expect(migration).toContain(
      "alter table organisation_feature force row level security"
    )
    expect(migration).toMatch(
      /create policy tenant_isolation on organisation_feature/
    )
  })

  it("allows exactly the pause scopes the code knows", () => {
    for (const scope of PAUSE_SCOPES) expect(migration).toContain(`'${scope}'`)
  })

  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0090_pause_controls")
    expect(REQUIRED_MIGRATIONS).toContain("0091_ops_pause_event_no_truncate")
  })

  describe("against PGlite", () => {
    let db: PGlite

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        insert into organisation values ('${ORG}'), ('${OTHER}');
      `)
      await db.exec(migration)
      await db.exec(noTruncate)
    })

    afterAll(async () => {
      await db.close()
    })

    it("seeds every scope unpaused", async () => {
      const { rows } = await db.query<{ scope: string; paused: boolean }>(
        "select scope, paused from ops_pause_control order by scope"
      )
      expect(rows.map((r) => r.scope).sort()).toEqual([...PAUSE_SCOPES].sort())
      expect(rows.every((r) => !r.paused)).toBe(true)
    })

    it("pauses and resumes through set_ops_pause with an appended history", async () => {
      const pause = await db.query<{
        paused: boolean
        previously_paused: boolean
      }>(
        "select * from set_ops_pause('publish', true, 'Google incident', 'oncall@example.com')"
      )
      expect(pause.rows[0]).toMatchObject({
        paused: true,
        previously_paused: false,
      })
      await db.query(
        "select * from set_ops_pause('publish', false, 'Incident over', 'oncall@example.com')"
      )
      const { rows } = await db.query<{
        paused: boolean
        previously_paused: boolean
      }>(
        "select paused, previously_paused from ops_pause_event where scope = 'publish' order by id"
      )
      expect(rows).toEqual([
        { paused: true, previously_paused: false },
        { paused: false, previously_paused: true },
      ])
      await expect(
        db.query("update ops_pause_event set paused = true")
      ).rejects.toThrow(/append-only/)
      await expect(db.query("delete from ops_pause_event")).rejects.toThrow(
        /append-only/
      )
      await expect(db.query("truncate ops_pause_event")).rejects.toThrow(
        /append-only/
      )
    })

    it("refuses an unknown scope, a pause without a reason, and a bare paused row", async () => {
      await expect(
        db.query("select * from set_ops_pause('nonsense', true, 'why', 'me')")
      ).rejects.toThrow(/unknown scope/)
      await expect(
        db.query("select * from set_ops_pause('sync', true, '  ', 'me')")
      ).rejects.toThrow(/reason is required/)
      await expect(
        db.query(
          "update ops_pause_control set paused = true, reason = null where scope = 'sync'"
        )
      ).rejects.toThrow(/check constraint/)
    })

    it("keeps organisation features per tenant and off by default", async () => {
      await db.query(
        "insert into organisation_feature (organisation_id, feature, enabled) values ($1, 'post_scheduling', true)",
        [ORG]
      )
      await expect(
        db.query(
          "insert into organisation_feature (organisation_id, feature) values ($1, 'Bad-Name')",
          [ORG]
        )
      ).rejects.toThrow(/check constraint/)
      const { rows } = await db.query(
        "select organisation_id from organisation_feature where organisation_id = $1",
        [OTHER]
      )
      expect(rows).toEqual([])
    })
  })
})
