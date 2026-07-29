import { readFileSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL("../supabase/migrations/0001_initial.sql", import.meta.url),
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
  "connection_task",
]

describe("database migration contract", () => {
  it("uses unique Supabase migration versions", async () => {
    const directory = new URL("../supabase/migrations/", import.meta.url)
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort()
    const versions = files.map((file) => file.split("_", 1)[0])

    expect(
      new Set(versions).size,
      `Duplicate migration versions: ${versions.join(", ")}`
    ).toBe(versions.length)
  })

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

  it("0004 creates the runtime grants role and protects schema_migration", async () => {
    const runtimeRoleMigration = await readFile(
      new URL("../supabase/migrations/0004_runtime_role.sql", import.meta.url),
      "utf8"
    )
    expect(runtimeRoleMigration).toContain("create role naba_app_runtime")
    expect(runtimeRoleMigration).toContain("nologin nosuperuser nobypassrls")
    expect(runtimeRoleMigration).toContain(
      "revoke insert, update, delete on schema_migration from naba_app_runtime"
    )
  })

  it("0005 hardens app_user and content-free routing tables", async () => {
    const tenantHardeningMigration = await readFile(
      new URL(
        "../supabase/migrations/0005_tenant_hardening.sql",
        import.meta.url
      ),
      "utf8"
    )
    expect(tenantHardeningMigration).toContain(
      "alter table app_user enable row level security"
    )
    expect(
      tenantHardeningMigration.match(/language plpgsql security definer/g)
    ).toHaveLength(3)
    expect(tenantHardeningMigration).toContain("webhook_route_claim")
  })

  it("0006 establishes the reply lifecycle schema", async () => {
    const replyLifecycleMigration = await readFile(
      new URL(
        "../supabase/migrations/0006_reply_lifecycle.sql",
        import.meta.url
      ),
      "utf8"
    )
    expect(replyLifecycleMigration).toContain("operation text")
    expect(replyLifecycleMigration).toContain("intended_body text")
    expect(replyLifecycleMigration).toContain("publish_generation")
    expect(replyLifecycleMigration).toContain("create table approval_decision")
    expect(replyLifecycleMigration).toMatch(
      /grant[\s\S]+on approval_decision[\s\S]+to naba_app_runtime/
    )
  })

  it("every migration after 0003 grants new tables to naba_app_runtime", async () => {
    const directory = new URL("../supabase/migrations/", import.meta.url)
    const files = (await readdir(directory)).filter(
      (file) => file.endsWith(".sql") && file > "0004"
    )
    for (const file of files) {
      const text = await readFile(new URL(file, directory), "utf8")
      const created = [
        ...text.matchAll(/create table (?:if not exists )?(\w+)/g),
      ]
      for (const [, table] of created) {
        expect(text, `${file} must grant ${table} to naba_app_runtime`).toMatch(
          new RegExp(`grant[^;]+on ${table}[^;]+to naba_app_runtime`)
        )
      }
    }
  })
})
