import { readFileSync } from "node:fs"

import type { TransactionSql } from "postgres"
import { describe, expect, it, vi } from "vitest"

import { purgeExpiredStagingAssets } from "@/lib/server/assets"
import { settleInterruptedListingChanges } from "@/lib/server/listing-changes"
import { settleOperationsForAttempts } from "@/lib/server/mutation-operations"
import { renderPlatformEmail } from "@/lib/server/notifications/messages"
import {
  TICK_CYCLE_STALE_AFTER_SECONDS,
  TICK_STALE_AFTER_SECONDS,
} from "@/lib/server/ops-liveness"
import { reapStrandedLocalPosts } from "@/lib/server/posts"
import {
  RETENTION_CYCLE_START_HOUR_UTC,
  RETENTION_ORG_MAX_ATTEMPTS,
  RETENTION_ORG_MAX_RESUMES,
  retentionCycleDate,
} from "@/lib/server/retention/cycle"
import {
  purgeOrganisation,
  RETENTION_BATCH_ROWS_DEFAULT,
  retentionBatchRows,
  retentionPurgeCatalog,
} from "@/lib/server/retention/purge"

import { pgliteSql } from "./helpers/pglite-tx"

// The tenant transaction the purge runs in, set by the batch-bound test below.
const tenant = vi.hoisted(() => ({ sql: null as TransactionSql | null }))

vi.mock("@/lib/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/db")>()),
  withTenant: async (
    _organisationId: string,
    callback: (sql: TransactionSql) => Promise<unknown>
  ) => {
    if (!tenant.sql) throw new Error("no tenant transaction stubbed")
    return callback(tenant.sql)
  },
}))
// What the purge calls outside its own statements: the once-per-run reapers,
// the receipts settled for reaped attempts, and staged-photo storage.
vi.mock("@/lib/server/posts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/posts")>()),
  reapStrandedLocalPosts: vi.fn(async () => ({ count: 0 })),
}))
vi.mock("@/lib/server/listing-changes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/listing-changes")>()),
  settleInterruptedListingChanges: vi.fn(async () => 0),
}))
vi.mock("@/lib/server/mutation-operations", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/server/mutation-operations")
  >()),
  settleOperationsForAttempts: vi.fn(async () => undefined),
}))
vi.mock("@/lib/server/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/assets")>()),
  purgeExpiredStagingAssets: vi.fn(async () => 0),
}))

describe("retentionCycleDate", () => {
  it("opens no cycle before 03:00 UTC", () => {
    expect(RETENTION_CYCLE_START_HOUR_UTC).toBe(3)
    expect(retentionCycleDate(new Date("2026-10-11T00:00:00Z"))).toBeNull()
    expect(retentionCycleDate(new Date("2026-10-11T02:59:59.999Z"))).toBeNull()
  })

  it("names the UTC day at and after 03:00 UTC", () => {
    expect(retentionCycleDate(new Date("2026-10-11T03:00:00Z"))).toBe(
      "2026-10-11"
    )
    expect(retentionCycleDate(new Date("2026-10-11T23:59:59Z"))).toBe(
      "2026-10-11"
    )
  })

  it("uses the UTC day, not the server's local one", () => {
    // 01:30 in UTC+3 is 22:30 the previous day in UTC: that day's cycle.
    expect(retentionCycleDate(new Date("2026-10-12T01:30:00+03:00"))).toBe(
      "2026-10-11"
    )
    // 23:30 in UTC-5 is 04:30 the next day in UTC.
    expect(retentionCycleDate(new Date("2026-10-11T23:30:00-05:00"))).toBe(
      "2026-10-12"
    )
    // 04:00 in UTC+2 is 02:00 UTC: still before the start.
    expect(retentionCycleDate(new Date("2026-10-11T04:00:00+02:00"))).toBeNull()
  })

  it("gives each organisation a bounded number of runs per cycle", () => {
    expect(RETENTION_ORG_MAX_ATTEMPTS).toBeGreaterThan(1)
    expect(RETENTION_ORG_MAX_ATTEMPTS).toBeLessThanOrEqual(5)
  })
})

describe("retention dispatcher liveness", () => {
  it("expects a fire every few minutes and a finished cycle within 26 hours", () => {
    expect(TICK_STALE_AFTER_SECONDS.retention).toBe(900)
    expect(TICK_CYCLE_STALE_AFTER_SECONDS.retention).toBe(26 * 3600)
  })
})

describe("0097_retention_cycle migration", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/0097_retention_cycle.sql", import.meta.url),
    "utf8"
  )

  it("keeps one cycle per UTC day and one row per organisation in it", () => {
    expect(migration).toMatch(/cycle_date date not null unique/)
    expect(migration).toMatch(/primary key \(cycle_id, organisation_id\)/)
    expect(migration).toMatch(
      /check \(status in \('pending', 'succeeded', 'failed'\)\)/
    )
    expect(migration).toMatch(/check \(status in \('running', 'completed'\)\)/)
  })

  it("is platform-level and granted to the runtime role", () => {
    expect(migration).not.toMatch(/enable row level security/)
    expect(migration).toContain(
      "grant select, insert, update, delete on retention_cycle to naba_app_runtime;"
    )
    expect(migration).toContain(
      "grant select, insert, update, delete on retention_cycle_org to naba_app_runtime;"
    )
    expect(migration).toContain("'0097_retention_cycle'")
  })
})

// The route's cycle-versus-page dispatch is behavioural in
// tests/integration/routes/leases.test.ts ("keeps a hand-run retention page off
// the cron heartbeat and the cycle", and the cycle fires before it) and
// tests/integration/routes/retention-purge.test.ts ("through a dispatcher
// cycle, not only a hand page").

describe("tick_cycle_failures alert", () => {
  it("names the cycle, the failed organisations and their codes, and repeats", () => {
    const email = renderPlatformEmail("tick_cycle_failures", "retention", {
      cycleDate: "2026-10-10",
      enumerated: 40,
      failed: 2,
      repeated: 1,
      organisations: [
        {
          organisationId: "org-a",
          attempts: 3,
          lastErrorCode: "internal_error",
        },
        {
          organisationId: "org-b",
          attempts: 3,
          lastErrorCode: "attempt_interrupted",
        },
      ],
    })
    expect(email.subject).toBe(
      "NabaPresence: the retention cycle left organisations unretained"
    )
    expect(email.text).toContain(
      'The "retention" cycle for 2026-10-10 completed with 2 of 40 organisations failed'
    )
    expect(email.text).toContain("1 of them also failed in the cycle before.")
    expect(email.text).toContain("- org-a: internal_error after 3 runs")
    expect(email.text).toContain("- org-b: attempt_interrupted after 3 runs")
    expect(email.text).toContain('"Retention cycle"')
  })

  it("leaves out the repeat line when nothing repeated", () => {
    const email = renderPlatformEmail("tick_cycle_failures", "retention", {
      cycleDate: "2026-10-10",
      enumerated: 5,
      failed: 1,
      repeated: 0,
      organisations: [],
    })
    expect(email.text).not.toContain("cycle before")
  })
})

describe("retention batches", () => {
  it("reads RETENTION_BATCH_ROWS within 1-10000 and falls back otherwise", () => {
    const saved = process.env.RETENTION_BATCH_ROWS
    try {
      delete process.env.RETENTION_BATCH_ROWS
      expect(retentionBatchRows()).toBe(RETENTION_BATCH_ROWS_DEFAULT)
      process.env.RETENTION_BATCH_ROWS = "2"
      expect(retentionBatchRows()).toBe(2)
      for (const invalid of ["0", "-5", "10001", "2.5", "many", ""]) {
        process.env.RETENTION_BATCH_ROWS = invalid
        expect(retentionBatchRows()).toBe(RETENTION_BATCH_ROWS_DEFAULT)
      }
    } finally {
      if (saved === undefined) delete process.env.RETENTION_BATCH_ROWS
      else process.env.RETENTION_BATCH_ROWS = saved
    }
  })

  it("hands back a bounded number of stopped runs", () => {
    expect(RETENTION_ORG_MAX_RESUMES).toBeGreaterThan(0)
    expect(RETENTION_ORG_MAX_RESUMES).toBeLessThanOrEqual(288)
  })

  it("0099 records per-organisation counts and resumes and indexes the repeated scans", () => {
    const migration = readFileSync(
      new URL(
        "../supabase/migrations/0099_retention_batches.sql",
        import.meta.url
      ),
      "utf8"
    )
    expect(migration).toMatch(
      /add column counts jsonb not null default '\{\}'::jsonb/
    )
    expect(migration).toMatch(
      /add column resumes integer not null default 0 check \(resumes >= 0\)/
    )
    expect(migration).toMatch(
      /on review \(organisation_id, raw_content_expires_at\)\s+where review_text is not null/
    )
    expect(migration).toContain("on review_media_item (review_id)")
    expect(migration).toContain(
      "on hours_sync_attempt (organisation_id, expires_at)"
    )
    expect(migration).not.toMatch(/create index concurrently/i)
    expect(migration).toContain("'0099_retention_batches'")
  })
})

// The purge statements are behavioural in
// tests/integration/routes/retention-purge.test.ts: batch bounds ("changes at
// most the batch per statement and resumes across runs", "bounds destructive
// deletes and the stranded reapers"), reviewer photo redaction under legal
// holds ("drops an expired review's photo link, keeps live and held ones") and
// the ai_usage deletion guard ("deletes settled AI usage past 13 months but
// never a reserved row, an open month or allowance period, or with deletions
// off"). Those seed rows for the steps they exercise; the guard below runs
// every step without a database and holds each one to the bounded path.

describe("retention purge statements", () => {
  // boundedRows' shape: pick at most `limit` ids of the step's own table, then
  // change only those (and only while they still match).
  const BOUNDED =
    /^with doomed as \( select id from "(\w+)" where .+ limit \$(\d+) \) (?:update "\1" set .+ |delete from "\1" )where id in \(select id from doomed\) and .+ returning id::text as id$/
  const MUTATING = /\bdelete\s+from\b|\bupdate\s+\S+\s+set\b/i
  const BATCH_ROWS = 37

  it("changes at most the batch in every delete and update a round issues", async () => {
    const statements: { text: string; params: unknown[] }[] = []
    tenant.sql = pgliteSql({
      query: async (text, params = []) => {
        statements.push({ text, params })
        return { rows: [] }
      },
    })
    const saved = process.env.RETENTION_BATCH_ROWS
    process.env.RETENTION_BATCH_ROWS = String(BATCH_ROWS)
    try {
      const result = await purgeOrganisation({
        organisationId: "00000000-0000-0000-0000-0000000000a1",
        requestId: "retention-bounds",
        clientRequestId: null,
        // Deletions on, so the destructive steps run too.
        deletesEnabled: true,
        deadline: Date.now() + 60_000,
      })
      // Nothing matched, so one round ran every step once.
      expect(result).toMatchObject({ complete: true, rounds: 1 })
    } finally {
      tenant.sql = null
      if (saved === undefined) delete process.env.RETENTION_BATCH_ROWS
      else process.env.RETENTION_BATCH_ROWS = saved
    }

    const mutating = statements.filter(({ text }) => MUTATING.test(text))
    const unbounded = mutating
      .filter(({ text, params }) => {
        const match = BOUNDED.exec(text)
        return !match || params[Number(match[2]) - 1] !== BATCH_ROWS
      })
      .map(({ text }) => text)
    expect(unbounded).toEqual([])
    // One bounded statement per step, on that step's table, and no other
    // change: the once-per-run reapers live outside this module.
    const catalog = retentionPurgeCatalog()
    expect(mutating.map(({ text }) => BOUNDED.exec(text)?.[1])).toEqual(
      catalog.filter((step) => !step.once).map((step) => step.table)
    )
    expect(catalog.filter((step) => step.once).map((step) => step.key)).toEqual(
      ["strandedPosts", "interruptedApprovals"]
    )
    expect(reapStrandedLocalPosts).toHaveBeenCalledTimes(1)
    expect(settleInterruptedListingChanges).toHaveBeenCalledTimes(1)
    // Each batched reaper settles the receipts of the attempts it aged.
    expect(settleOperationsForAttempts).toHaveBeenCalledTimes(
      catalog.filter((step) => step.kind === "reap" && !step.once).length
    )
    expect(purgeExpiredStagingAssets).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-0000000000a1",
      expect.objectContaining({ limit: BATCH_ROWS })
    )
  })
})

describe("0100 AI usage retention migration", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/0100_ai_usage_retention.sql",
      import.meta.url
    ),
    "utf8"
  )

  it("grants the runtime role delete on ai_usage and indexes the age scan", () => {
    expect(migration).toContain("grant delete on ai_usage to naba_app_runtime;")
    expect(migration).toMatch(
      /create index if not exists ai_usage_created_idx\s+on ai_usage \(organisation_id, created_at\);/
    )
    expect(migration).toContain("'0100_ai_usage_retention'")
    expect(migration).not.toMatch(/create index concurrently/i)
  })

  it("builds the wider unredacted-review index before dropping 0099's", () => {
    const create = migration.search(
      /create index if not exists review_unredacted_expiry_v2_idx\s+on review \(organisation_id, raw_content_expires_at\)\s+where review_text is not null\s+or reviewer_display_name is not null\s+or reviewer_profile_photo_url is not null\s+or raw_payload is not null;/
    )
    const drop = migration.indexOf(
      "drop index if exists review_unredacted_expiry_idx;"
    )
    const version = migration.indexOf("insert into schema_migration")
    expect(create).toBeGreaterThan(-1)
    // DROP INDEX holds ACCESS EXCLUSIVE (blocking reads) until commit, so it
    // must come after the build and be the last statement before the version row.
    expect(drop).toBeGreaterThan(create)
    expect(version).toBeGreaterThan(drop)
    expect(migration.slice(drop, version)).not.toMatch(
      /^\s*(create|alter|update|insert|delete|grant)\b/im
    )
  })
})
