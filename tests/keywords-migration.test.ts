import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("Search keyword performance migration", () => {
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/0017_search_keyword_performance.sql"
    ),
    "utf8"
  )

  it("stores exact or thresholded monthly keyword values with tenant isolation", () => {
    expect(migration).toContain(
      "create table performance_search_keyword_monthly"
    )
    expect(migration).toContain("num_nonnulls(impressions, threshold) = 1")
    expect(migration).toContain(
      "performance_search_keyword_monthly_range_idx"
    )
    expect(migration).toContain(
      "alter table performance_search_keyword_monthly force row level security"
    )
    expect(migration).toContain(
      "performance_search_keyword_monthly_isolation"
    )
  })

  it("adds an independent keyword checkpoint and watermark", () => {
    expect(migration).toContain("add column last_keyword_month date")
    expect(migration).toContain("'keywords'")
    expect(migration).toContain("keyword_checkpoint_due_idx")
  })
})
