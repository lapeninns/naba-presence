import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { renderPlatformEmail } from "@/lib/server/notifications/messages"
import {
  TICK_CYCLE_STALE_AFTER_SECONDS,
  TICK_STALE_AFTER_SECONDS,
} from "@/lib/server/ops-liveness"
import {
  RETENTION_CYCLE_START_HOUR_UTC,
  RETENTION_ORG_MAX_ATTEMPTS,
  RETENTION_ORG_MAX_RESUMES,
  retentionCycleDate,
} from "@/lib/server/retention/cycle"
import {
  RETENTION_BATCH_ROWS_DEFAULT,
  retentionBatchRows,
} from "@/lib/server/retention/purge"

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

describe("retention route", () => {
  const route = readFileSync(
    new URL("../app/api/cron/retention/route.ts", import.meta.url),
    "utf8"
  )

  it("dispatches the cycle unless a page cursor is given", () => {
    expect(route).toContain('searchParams.has("cursor")')
    expect(route).toContain("runRetentionCycle(")
    expect(route).toMatch(/retainPage\([\s\S]*trigger: "manual"/)
  })
})

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
    expect(migration).toMatch(/on review \(organisation_id, raw_content_expires_at\)\s+where review_text is not null/)
    expect(migration).toContain("on review_media_item (review_id)")
    expect(migration).toContain("on hours_sync_attempt (organisation_id, expires_at)")
    expect(migration).not.toMatch(/create index concurrently/i)
    expect(migration).toContain("'0099_retention_batches'")
  })
})

describe("retention purge statements", () => {
  const purge = readFileSync(
    new URL("../lib/server/retention/purge.ts", import.meta.url),
    "utf8"
  )

  it("bounds every dataset statement by the batch", () => {
    // Every delete and update the purge issues goes through boundedRows,
    // apart from the two in-flight reapers it calls once per run.
    expect(purge.match(/delete from /g)).toHaveLength(1)
    expect(purge.match(/\bupdate \$\{target\}/g)).toHaveLength(1)
    expect(purge).toMatch(/select id from \$\{target\} where \$\{where\(\)\} limit \$\{limit\}/)
  })
})
