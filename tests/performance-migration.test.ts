import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("Performance migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0014_performance_metrics.sql"),
    "utf8"
  )

  it("creates indexed, constrained, tenant-isolated daily metrics", () => {
    expect(migration).toContain("create table performance_metric_daily")
    expect(migration).toContain("value bigint not null check (value >= 0)")
    expect(migration).toContain("performance_metric_daily_range_idx")
    expect(migration).toContain(
      "alter table performance_metric_daily force row level security"
    )
    expect(migration).toContain("performance_metric_daily_isolation")
  })

  it("adds performance checkpoints and a local-date watermark", () => {
    expect(migration).toContain("add column last_metric_date date")
    expect(migration).toContain("'performance'")
    expect(migration).toContain("performance_checkpoint_due_idx")
  })
})
