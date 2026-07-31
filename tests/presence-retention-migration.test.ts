import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Presence retention hardening migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/0022_presence_retention_hardening.sql"), "utf8")

  it("adds bounded Local Post and Media payload retention", () => {
    expect(migration).toContain("gbp_local_post_attempt_expiry_idx")
    expect(migration).toContain("payload_expires_at timestamptz not null default now() + interval '30 days'")
  })
})
