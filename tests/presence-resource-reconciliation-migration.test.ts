import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Presence resource reconciliation migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/0023_presence_resource_reconciliation.sql"), "utf8")

  it("tracks bounded fair sweeps without storing provider content", () => {
    expect(migration).toContain("create table presence_resource_reconcile_state")
    expect(migration).toContain("last_attempt_at")
    expect(migration).toContain("last_succeeded_at")
    expect(migration).not.toContain("jsonb")
  })

  it("forces tenant isolation", () => {
    expect(migration).toContain("force row level security")
  })
})
