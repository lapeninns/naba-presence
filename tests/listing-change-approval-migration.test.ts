import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { OPERATION_OUTCOMES } from "@/lib/contracts/mutation-operations"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const ledger = read("0086_mutation_operation.sql")
const migration = read("0094_listing_change_approval.sql")

const ORG_A = "00000000-0000-4000-8000-00000000000a"
const ORG_B = "00000000-0000-4000-8000-00000000000b"
const AUTHOR = "00000000-0000-4000-8000-0000000000a1"
const APPROVER = "00000000-0000-4000-8000-0000000000a2"
const HASH = "a".repeat(64)

describe("0094 listing change approval migration", () => {
  it("adds awaiting_approval to the shared outcome vocabulary", () => {
    for (const outcome of OPERATION_OUTCOMES) {
      expect(migration).toContain(`'${outcome}'`)
    }
    expect(migration).toMatch(
      /drop constraint if exists mutation_operation_state_check/
    )
  })

  it("isolates decisions with forced RLS and grants no update or delete", () => {
    expect(migration).toContain("create table mutation_approval_decision")
    expect(migration).toContain(
      "alter table mutation_approval_decision force row level security"
    )
    expect(migration).toMatch(
      /create policy tenant_isolation on mutation_approval_decision/
    )
    expect(migration).toMatch(
      /grant select, insert on mutation_approval_decision to naba_app_runtime/
    )
    expect(migration).not.toMatch(
      /grant[^;]*(update|delete)[^;]*on mutation_approval_decision/
    )
    expect(migration).toMatch(/check \(decided_by <> requested_by\)/)
  })

  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0094_listing_change_approval")
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
        insert into organisation values ('${ORG_A}'), ('${ORG_B}');
        insert into app_user values ('${AUTHOR}'), ('${APPROVER}');
      `)
      await db.exec(ledger)
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    async function insertOperation(input: {
      intent: string
      state: string
      changeRequest?: object | null
      org?: string
    }): Promise<string> {
      const result = await db.query<{ id: string }>(
        `insert into mutation_operation
           (organisation_id, intent_id, actor_user_id, surface, action,
            payload_hash, state, change_request, field_mask)
         values ($1, $2, $3, 'media', 'create', $4, $5, $6, $7)
         returning id`,
        [
          input.org ?? ORG_A,
          input.intent,
          AUTHOR,
          HASH,
          input.state,
          input.changeRequest === undefined
            ? { kind: "media_create", target: null, body: {} }
            : input.changeRequest,
          ["sourceUrl"],
        ]
      )
      return result.rows[0]!.id
    }

    it("parks a change request and refuses a parked row without one", async () => {
      await insertOperation({
        intent: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e50",
        state: "awaiting_approval",
      })
      await expect(
        insertOperation({
          intent: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e51",
          state: "awaiting_approval",
          changeRequest: null,
        })
      ).rejects.toThrow(/mutation_operation_awaiting_approval_request/)
      await expect(
        insertOperation({
          intent: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e52",
          state: "approved",
        })
      ).rejects.toThrow(/check constraint/)
    })

    it("records a decision by a second person and refuses self-approval", async () => {
      const id = await insertOperation({
        intent: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e53",
        state: "awaiting_approval",
      })
      const decide = (decidedBy: string, org = ORG_A) =>
        db.query(
          `insert into mutation_approval_decision
             (organisation_id, operation_id, payload_hash, requested_by,
              decided_by, decision)
           values ($1, $2, $3, $4, $5, 'approved')`,
          [org, id, HASH, AUTHOR, decidedBy]
        )
      await decide(APPROVER)
      await expect(decide(AUTHOR)).rejects.toThrow(/check constraint/)
      // The tenant key: a decision cannot name another organisation's receipt.
      await expect(decide(APPROVER, ORG_B)).rejects.toThrow(/foreign key/)
    })
  })
})
