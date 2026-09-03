import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

describe("Local Posts migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/0015_local_posts.sql"),
    "utf8"
  )
  const lifecycle = readFileSync(
    join(process.cwd(), "supabase/migrations/0037_local_post_lifecycle.sql"),
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
    expect(migration).toContain("google_search_url")
  })

  // The column is still in the schema, but the request/response contract no
  // longer carries it: nothing ever published a post when its time arrived,
  // so echoing a scheduled time back promised a behaviour the system does not
  // have. Asserting the column existed read as coverage for that behaviour.
  it("leaves scheduling to a due-posts claim that does not exist yet", () => {
    expect(migration).toContain("scheduled_publish_time")
    const contract = readFileSync(
      join(process.cwd(), "lib/contracts/location-posts.ts"),
      "utf8"
    )
    expect(contract).not.toContain("scheduledTime:")
    const server = readFileSync(
      join(process.cwd(), "lib/server/posts.ts"),
      "utf8"
    )
    expect(server).not.toContain("scheduled_publish_time")
  })

  it("0037 bounds the publish claim with a lease the reaper can expire", () => {
    expect(lifecycle).toContain(
      "add column publish_lease_expires_at timestamptz"
    )
    // Partial on the only status the reaper looks at, so it stays small
    // against a table that is almost entirely 'published'.
    expect(lifecycle).toContain("gbp_local_post_publish_lease_idx")
    expect(lifecycle).toMatch(
      /create index gbp_local_post_publish_lease_idx[\s\S]+where status = 'publishing'/
    )
    expect(lifecycle).toContain("'0037_local_post_lifecycle'")
  })
})
