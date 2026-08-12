import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Import review migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0028_import_review.sql"),
    "utf8"
  )

  it("stages proposals with a suggestion-only lifecycle", () => {
    expect(migration).toContain("create table presence_import_proposal")
    expect(migration).toContain("suggested_patch jsonb not null")
    expect(migration).toContain(
      "status in ('pending', 'processing', 'applied', 'ignored', 'failed', 'superseded')"
    )
    expect(migration).toContain(
      "decision in ('apply', 'ignore', 'delete_local', 'keep_local')"
    )
    expect(migration).toContain("resource_type in ('profile', 'food_menus')")
  })

  it("enforces one live proposal per identity, including in-flight decisions", () => {
    expect(migration).toContain("create unique index presence_import_proposal_live_key")
    expect(migration).toContain("where status in ('pending', 'processing')")
  })

  it("pins the concurrency triple on every proposal", () => {
    expect(migration).toContain("pinned_canonical_revision text not null")
    expect(migration).toContain("pinned_canonical_hash text not null")
    expect(migration).toContain("pinned_google_hash text not null")
  })

  it("records menu item identities keyed by google path", () => {
    expect(migration).toContain("create table food_menu_item_identity")
    expect(migration).toContain("unique (organisation_id, location_id, google_path)")
  })

  it("forces tenant isolation on both new tables", () => {
    expect(migration).toContain(
      "alter table presence_import_proposal force row level security"
    )
    expect(migration).toContain(
      "alter table food_menu_item_identity force row level security"
    )
  })

  it("teaches sync attempts the import direction", () => {
    expect(migration).toContain("operation in ('publish_google', 'import_google')")
    expect(migration).toContain("direction in ('to_google', 'to_nabapresence')")
    expect(migration).toContain(
      "operation in ('validate_google', 'publish_google', 'import_nabatable', 'import_google', 'reconcile')"
    )
    expect(migration).toContain(
      "direction in ('to_google', 'to_nabatable', 'to_nabapresence')"
    )
  })
})
