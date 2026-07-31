import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Media migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/0019_media_management.sql"), "utf8")
  it("persists owner/customer media, attribution, and mutations", () => {
    expect(migration).toContain("create table gbp_media_item")
    expect(migration).toContain("ownership in ('merchant', 'customer')")
    expect(migration).toContain("attribution jsonb")
    expect(migration).toContain("create table gbp_media_mutation")
    expect(migration).toContain("gbp_media_mutation_expiry_idx")
  })
  it("forces tenant RLS", () => {
    expect(migration).toContain("alter table gbp_media_item force row level security")
    expect(migration).toContain("alter table gbp_media_mutation force row level security")
  })
})
