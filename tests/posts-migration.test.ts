import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("Local Posts migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0015_local_posts.sql"),
    "utf8"
  )

  it("stores tenant-scoped posts and pre-provider mutation intent", () => {
    expect(migration).toContain("create table gbp_local_post")
    expect(migration).toContain("create table gbp_local_post_attempt")
    expect(migration).toContain("intended_payload jsonb not null")
    expect(migration).toContain("gbp_local_post_isolation")
    expect(migration).toContain("gbp_local_post_attempt_isolation")
    expect(migration.match(/force row level security/g)).toHaveLength(2)
  })

  it("supports drafts, approval, provider failure, ambiguity, and deletion", () => {
    for (const status of [
      "draft",
      "awaiting_approval",
      "publishing",
      "published",
      "failed",
      "ambiguous",
      "deleted",
    ]) {
      expect(migration).toContain(`'${status}'`)
    }
    expect(migration).toContain("scheduled_publish_time")
    expect(migration).toContain("google_search_url")
  })
})
