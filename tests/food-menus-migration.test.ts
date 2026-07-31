import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Food Menus migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/0020_food_menus_management.sql"), "utf8")

  it("persists reconciled resources and immutable publish attempts", () => {
    expect(migration).toContain("create table food_menus_state")
    expect(migration).toContain("canonical_payload jsonb not null")
    expect(migration).toContain("create table food_menus_sync_attempt")
    expect(migration).toContain("intended_payload jsonb not null")
    expect(migration).toContain("food_menus_attempt_expiry_idx")
  })

  it("forces tenant isolation", () => {
    expect(migration).toContain("alter table food_menus_state force row level security")
    expect(migration).toContain("alter table food_menus_sync_attempt force row level security")
  })
})
