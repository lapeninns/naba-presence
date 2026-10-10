import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { OPERATION_OUTCOMES } from "@/lib/contracts/mutation-operations"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0067_mutation_operation.sql"),
  "utf8"
)

const ORG = "00000000-0000-4000-8000-00000000000a"
const INTENT = "9b2f6a3e-4c1d-4e8f-9a7b-2c3d4e5f6a7b"
const HASH = "a".repeat(64)

describe("0067 mutation_operation migration", () => {
  it("isolates tenants with forced RLS and grants no delete", () => {
    expect(migration).toContain("create table mutation_operation")
    expect(migration).toContain(
      "alter table mutation_operation enable row level security"
    )
    expect(migration).toContain(
      "alter table mutation_operation force row level security"
    )
    expect(migration).toMatch(
      /create policy tenant_isolation on mutation_operation/
    )
    expect(migration).toMatch(
      /grant select, insert, update on mutation_operation to naba_app_runtime/
    )
    expect(migration).not.toMatch(/grant[^;]*delete[^;]*on mutation_operation/)
  })

  it("keys receipts on (organisation, intent) and reserves later columns", () => {
    expect(migration).toMatch(/unique \(organisation_id, intent_id\)/)
    for (const column of [
      "approval_ref text",
      "security_version integer",
      "connection_generation integer",
      "recovery_attempts integer not null default 0",
      "next_recovery_at timestamptz",
      "lease_expires_at timestamptz",
    ]) {
      expect(migration).toContain(column)
    }
    expect(migration).toMatch(
      /on mutation_operation \(state, next_recovery_at\)\s+where state = 'uncertain'/
    )
  })

  it("allows exactly the shared outcome vocabulary", () => {
    // `awaiting_approval` arrived later, with the listing change approvals
    // of 0075 (tests/listing-change-approval-migration.test.ts).
    for (const outcome of OPERATION_OUTCOMES) {
      if (outcome === "awaiting_approval") continue
      expect(migration).toContain(`'${outcome}'`)
    }
  })

  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0067_mutation_operation")
  })

  describe("against PGlite", () => {
    let db: PGlite

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location (id uuid primary key);
        create table google_connection (id uuid primary key);
        insert into organisation values ('${ORG}');
      `)
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    const insert = (state = "sent", intent = INTENT) =>
      db.query(
        `insert into mutation_operation
           (organisation_id, intent_id, surface, action, payload_hash, state)
         values ($1, $2, 'hours', 'publish', $3, $4)`,
        [ORG, intent, HASH, state]
      )

    it("refuses a state outside the vocabulary and a reused intent", async () => {
      await insert()
      await expect(insert("sent")).rejects.toThrow(
        /mutation_operation_intent_key/
      )
      await expect(
        insert("published", "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f")
      ).rejects.toThrow(/check constraint/)
    })
  })
})
