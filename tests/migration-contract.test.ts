import { readFileSync } from "node:fs"

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL("../db/migrations/0001_initial.sql", import.meta.url),
  "utf8"
)

const tenantTables = [
  "member",
  "google_connection",
  "google_account",
  "location",
  "external_location",
  "location_link",
  "location_member",
  "review",
  "review_media_item",
  "draft",
  "verification_result",
  "review_reply",
  "publish_attempt",
  "publish_attempt_event",
  "legal_hold",
  "privacy_request",
  "sync_checkpoint",
  "processed_webhook_event",
  "audit_log",
]

describe("database migration contract", () => {
  it("applies cleanly to a fresh PostgreSQL-compatible database", async () => {
    const database = new PGlite()
    try {
      await database.exec(
        migration.replace("create extension if not exists pgcrypto;", "")
      )
      const result = await database.query<{ version: string }>(
        "select version from schema_migration"
      )
      expect(result.rows).toEqual([{ version: "0001_initial" }])
    } finally {
      await database.close()
    }
  })

  it.each(tenantTables)("enables RLS routing for %s", (table) => {
    expect(migration).toContain(`'${table}'`)
  })

  it("uses default-deny tenant context in the generated policy", () => {
    expect(migration).toContain(
      "current_setting(''app.organisation_id'', true)"
    )
    expect(migration).toContain("alter table %I force row level security")
    expect(migration).toContain("create policy organisation_isolation")
  })

  it("database-constrains raw Google content retention to 30 days", () => {
    expect(migration).toMatch(
      /raw_content_retention_days[\s\S]+check \(raw_content_retention_days between 1 and 30\)/
    )
  })

  it("stores Google review identifiers as ciphertext plus lookup hashes", () => {
    expect(migration).toContain("google_review_name_ciphertext bytea not null")
    expect(migration).toContain("google_review_name_hash text not null")
    expect(migration).toContain("google_review_id_ciphertext bytea not null")
    expect(migration).not.toMatch(/\n  google_review_id text/)
  })

  it("makes audit and publish-attempt events append-only", () => {
    expect(migration).toContain("create trigger audit_log_no_update")
    expect(migration).toContain(
      "create trigger publish_attempt_event_no_update"
    )
  })

  it("enforces workflow transitions in PostgreSQL", () => {
    expect(migration).toContain("enforce_review_workflow_transition")
    expect(migration).toContain("invalid review workflow transition")
  })
})
