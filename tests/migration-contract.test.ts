import { readFileSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"

import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

import {
  KNOWN_VERSION_GAPS,
  LEGACY_MIGRATION_FILES,
  MIGRATION_FILE_PATTERN,
  NO_TRANSACTION_MARKER,
  highestVersion,
  prepareMigration,
  versionNumber,
} from "../scripts/migration-rules.mjs"

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url)
const migrationFiles = async () =>
  (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort()

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
  it("names every migration NNNN_snake_case.sql, apart from the legacy allowlist", async () => {
    const files = await migrationFiles()
    for (const legacy of LEGACY_MIGRATION_FILES) {
      expect(files, `stale legacy allowlist entry ${legacy}`).toContain(legacy)
    }
    const misnamed = files.filter(
      (file) =>
        !MIGRATION_FILE_PATTERN.test(file) &&
        !LEGACY_MIGRATION_FILES.includes(file)
    )
    expect(misnamed).toEqual([])
  })

  it("numbers migrations without gaps, apart from the known-gaps allowlist", async () => {
    const files = (await migrationFiles()).filter(
      (file) => !LEGACY_MIGRATION_FILES.includes(file)
    )
    const used = new Set(files.map(versionNumber))
    const gaps: string[] = []
    for (let version = 1; version <= highestVersion(files); version += 1) {
      if (!used.has(version)) gaps.push(String(version).padStart(4, "0"))
    }
    expect(gaps).toEqual(KNOWN_VERSION_GAPS)
  })

  it("records every migration's own version in schema_migration", async () => {
    for (const file of await migrationFiles()) {
      const text = await readFile(new URL(file, migrationsDirectory), "utf8")
      const version = file.replace(/\.sql$/, "")
      expect(text, `${file} must insert '${version}'`).toMatch(
        new RegExp(`insert into schema_migration[^;]*'${version}'`)
      )
    }
  })

  it("runs every migration inside the runner's transaction", async () => {
    const noTransaction: string[] = []
    for (const file of await migrationFiles()) {
      const text = await readFile(new URL(file, migrationsDirectory), "utf8")
      if (!prepareMigration(file, text).transactional) noTransaction.push(file)
    }
    // A new `-- migrate:no-transaction` file must be added here on purpose:
    // db:migrate cannot roll it back if it fails half-way.
    expect(noTransaction).toEqual([])
  })

  it("uses unique Supabase migration versions", async () => {
    const files = await migrationFiles()
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
    expect(replyLifecycleMigration).toContain("draft_policy_version text")
    expect(replyLifecycleMigration).toContain(
      "create or replace function enforce_review_workflow_transition()"
    )
    expect(replyLifecycleMigration).toContain("publish_generation")
    expect(replyLifecycleMigration).toContain("create table approval_decision")
    expect(replyLifecycleMigration).toMatch(
      /grant[\s\S]+on approval_decision[\s\S]+to naba_app_runtime/
    )
  })

  it("0012 provisions only verified external auth identities", async () => {
    const passwordAuthMigration = await readFile(
      new URL(
        "../supabase/migrations/0012_email_password_auth.sql",
        import.meta.url
      ),
      "utf8"
    )
    expect(passwordAuthMigration).toContain(
      "create function provision_authenticated_user"
    )
    expect(passwordAuthMigration).toContain("security definer")
    expect(passwordAuthMigration).toContain("unverified_auth_email")
    expect(passwordAuthMigration).toContain(
      "create unique index app_user_auth_identity_unique"
    )
    expect(passwordAuthMigration).toMatch(
      /grant execute on function provision_authenticated_user[\s\S]+to naba_app_runtime/
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

describe("db:migrate transaction handling", () => {
  it("strips a file's outer begin/commit pair and keeps line numbers", () => {
    const text = "-- header\nbegin;\ncreate table t (id int);\ncommit;\n"
    const result = prepareMigration("0099_t.sql", text)
    expect(result.transactional).toBe(true)
    expect(result.body).toBe(
      "-- header\n      \ncreate table t (id int);\n       \n"
    )
  })

  it("runs a file without an outer pair as-is inside the transaction", () => {
    const text = "create table t (id int);\n"
    expect(prepareMigration("0099_t.sql", text)).toEqual({
      transactional: true,
      body: text,
    })
  })

  it("leaves PL/pgSQL begin/end blocks alone", () => {
    const text = [
      "begin;",
      "do $$",
      "begin",
      "  perform 1;",
      "end;",
      "$$;",
      "commit;",
    ].join("\n")
    expect(prepareMigration("0099_t.sql", text).transactional).toBe(true)
  })

  it("rejects transaction control the runner would not own", () => {
    expect(() =>
      prepareMigration("0099_t.sql", "begin;\nselect 1;\ncommit;\nselect 2;\n")
    ).toThrow(/needs a matching final commit/)
    expect(() =>
      prepareMigration("0099_t.sql", "select 1;\ncommit;\nselect 2;\n")
    ).toThrow(/0099_t.sql:2: transaction control/)
    expect(() =>
      prepareMigration(
        "0099_t.sql",
        "begin;\nselect 1;\nrollback;\nbegin;\ncommit;\n"
      )
    ).toThrow(/transaction control/)
  })

  it("ignores transaction words in comments, strings and dollar quotes", () => {
    const text = [
      "BEGIN;",
      "-- commit; here is only a comment",
      "/* rollback; /* nested */ end; */",
      "select 'commit;', E'it\\'s; end;', \"end;\";",
      "create procedure p() language plpgsql as $body$",
      "begin",
      "  commit;",
      "end;",
      "$body$;",
      "COMMIT; -- done",
    ].join("\n")
    expect(prepareMigration("0099_t.sql", text).transactional).toBe(true)
  })

  it("rejects top-level end, abort and commit and chain", () => {
    for (const statement of ["end;", "abort;", "savepoint s;"]) {
      expect(() =>
        prepareMigration("0099_t.sql", `select 1;\n${statement}\nselect 2;\n`)
      ).toThrow(/transaction control/)
    }
    expect(() =>
      prepareMigration("0099_t.sql", "begin;\nselect 1;\ncommit and chain;\n")
    ).toThrow(/needs a matching final commit/)
  })

  it("runs a marked file verbatim outside a transaction", () => {
    const text = `${NO_TRANSACTION_MARKER}\ncreate index concurrently i on t (id);\n`
    expect(prepareMigration("0099_t.sql", text)).toEqual({
      transactional: false,
      body: text,
    })
  })

  it("ignores legacy names when finding the highest version", () => {
    expect(
      highestVersion(["0001_a.sql", "0057_b.sql", ...LEGACY_MIGRATION_FILES])
    ).toBe(57)
  })
})
