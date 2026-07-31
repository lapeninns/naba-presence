import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("Place Action migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0018_place_action_links.sql"),
    "utf8"
  )

  it("persists reconciled links and durable mutation attempts", () => {
    expect(migration).toContain("create table place_action_link")
    expect(migration).toContain("create table place_action_mutation")
    expect(migration).toContain("expected_google_hash text")
    expect(migration).toContain("unique (organisation_id, idempotency_key)")
    expect(migration).toContain("place_action_mutation_expiry_idx")
  })

  it("forces tenant RLS for links and mutations", () => {
    expect(migration).toContain(
      "alter table place_action_link force row level security"
    )
    expect(migration).toContain("place_action_link_isolation")
    expect(migration).toContain(
      "alter table place_action_mutation force row level security"
    )
    expect(migration).toContain("place_action_mutation_isolation")
  })
})
