import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("standalone presence migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/0024_standalone_presence.sql"), "utf8")

  it("creates tenant-isolated, revisioned NabaPresence canonical resources", () => {
    expect(migration).toContain("create table presence_canonical_resource")
    expect(migration).toContain("resource_type in ('profile', 'hours', 'food_menus')")
    expect(migration).toContain("revision bigint not null default 1")
    expect(migration).toContain("alter table presence_canonical_resource force row level security")
    expect(migration).toContain("create policy presence_canonical_resource_isolation")
  })

  it("migrates snapshots and removes the transitional venue mapping", () => {
    expect(migration).toContain("last_canonical_hours")
    expect(migration).toContain("jsonb_object_agg")
    expect(migration).toContain("canonical_payload")
    expect(migration).toContain("drop table nabatable_venue_link")
    expect(migration).toContain("pinned_canonical_revision")
  })
})
