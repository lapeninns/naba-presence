import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0016_profile_management.sql"),
  "utf8"
)

describe("profile management migration", () => {
  it("creates durable field state and operation ledgers", () => {
    expect(migration).toContain("create table profile_field_state")
    expect(migration).toContain("create table profile_sync_attempt")
    expect(migration).toContain("idempotency_key text not null")
    expect(migration).toContain("pinned_projection_revision text not null")
  })

  it("forces tenant RLS and adds operational indexes", () => {
    expect(migration).toContain(
      "alter table profile_field_state force row level security"
    )
    expect(migration).toContain(
      "alter table profile_sync_attempt force row level security"
    )
    expect(migration).toContain("profile_field_state_location_status_idx")
    expect(migration).toContain("profile_sync_attempt_location_idx")
  })
})
