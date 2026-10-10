import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const read = (file: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8")

const migration = read("0081_post_approval_binding.sql")

const ORG_A = "00000000-0000-4000-8000-00000000000a"
const ORG_B = "00000000-0000-4000-8000-00000000000b"
const LOC_A = "10000000-0000-4000-8000-00000000000a"
const LOC_B = "10000000-0000-4000-8000-00000000000b"
const EXT_A = "20000000-0000-4000-8000-00000000000a"
const EXT_B = "20000000-0000-4000-8000-00000000000b"
const USER_1 = "30000000-0000-4000-8000-000000000001"
const USER_2 = "30000000-0000-4000-8000-000000000002"
const PARKED = "40000000-0000-4000-8000-000000000001"
const DRAFT = "40000000-0000-4000-8000-000000000002"
const OTHER_ORG_POST = "40000000-0000-4000-8000-000000000003"
const HASH = "a".repeat(64)

describe("0081 post approval binding", () => {
  it("adds the revision, the request revision and an append-only decision table", () => {
    expect(migration).toContain(
      "add column content_revision bigint not null default 1"
    )
    expect(migration).toContain("add column approval_requested_revision bigint")
    expect(migration).toContain("create table post_approval_decision")
    expect(migration).toContain(
      "alter table post_approval_decision force row level security"
    )
    expect(migration).toMatch(
      /grant select, insert on post_approval_decision to naba_app_runtime/
    )
    expect(migration).not.toMatch(
      /grant[^;]*(update|delete)[^;]*on post_approval_decision/
    )
    // Not SECURITY DEFINER: it only touches NEW.
    expect(migration.replace(/--.*$/gm, "")).not.toMatch(/security definer/i)
    expect(migration.trim().startsWith("begin;")).toBe(true)
    expect(migration.trim().endsWith("commit;")).toBe(true)
    expect(migration).toContain("values ('0081_post_approval_binding')")
  })

  describe("against PGlite", () => {
    let db: PGlite

    beforeAll(async () => {
      db = new PGlite()
      // The slice of the schema 0015/0037 build on.
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location (id uuid primary key);
        create table external_location (id uuid primary key);
        create or replace function set_updated_at() returns trigger
          language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
        insert into organisation (id) values ('${ORG_A}'), ('${ORG_B}');
        insert into app_user (id) values ('${USER_1}'), ('${USER_2}');
        insert into location (id) values ('${LOC_A}'), ('${LOC_B}');
        insert into external_location (id) values ('${EXT_A}'), ('${EXT_B}');
      `)
      await db.exec(read("0015_local_posts.sql"))
      await db.exec(read("0037_local_post_lifecycle.sql"))
      // A request parked before 0081 has no revision yet.
      await db.exec(`
        insert into gbp_local_post
          (id, organisation_id, location_id, external_location_id, topic_type,
           summary, status, approval_requested_by)
        values
          ('${PARKED}', '${ORG_A}', '${LOC_A}', '${EXT_A}', 'STANDARD',
           'Parked', 'awaiting_approval', '${USER_1}'),
          ('${DRAFT}', '${ORG_A}', '${LOC_A}', '${EXT_A}', 'STANDARD',
           'Draft', 'draft', null),
          ('${OTHER_ORG_POST}', '${ORG_B}', '${LOC_B}', '${EXT_B}', 'STANDARD',
           'Other', 'draft', null);
      `)
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    const row = async (id: string) =>
      (
        await db.query<{
          content_revision: number
          approval_requested_revision: number | null
          approval_requested_by: string | null
          status: string
        }>(
          `select content_revision::integer as content_revision,
             approval_requested_revision::integer as approval_requested_revision,
             approval_requested_by::text as approval_requested_by, status
           from gbp_local_post where id = $1`,
          [id]
        )
      ).rows[0]

    it("backfills the revision of a request parked before it", async () => {
      expect(await row(PARKED)).toMatchObject({
        content_revision: 1,
        approval_requested_revision: 1,
        status: "awaiting_approval",
      })
      expect((await row(DRAFT)).approval_requested_revision).toBeNull()
    })

    it("bumps the revision only when content sent to Google changes", async () => {
      await db.query(
        `update gbp_local_post set google_state = 'LIVE', last_error_code = null where id = $1`,
        [DRAFT]
      )
      expect((await row(DRAFT)).content_revision).toBe(1)
      await db.query(
        `update gbp_local_post set summary = 'Draft, edited' where id = $1`,
        [DRAFT]
      )
      expect((await row(DRAFT)).content_revision).toBe(2)
      await db.query(
        `update gbp_local_post set media = '[{"sourceUrl":"https://example.test/a.jpg"}]' where id = $1`,
        [DRAFT]
      )
      expect((await row(DRAFT)).content_revision).toBe(3)
    })

    it("records the requested revision on a park and withdraws it on an edit", async () => {
      await db.query(
        `update gbp_local_post
         set status = 'awaiting_approval', approval_requested_by = $2
         where id = $1`,
        [DRAFT, USER_2]
      )
      expect(await row(DRAFT)).toMatchObject({
        status: "awaiting_approval",
        approval_requested_revision: 3,
        approval_requested_by: USER_2,
      })
      // An edit without a new request: the request was for other text.
      await db.query(
        `update gbp_local_post set summary = 'Changed under the approver' where id = $1`,
        [DRAFT]
      )
      expect(await row(DRAFT)).toMatchObject({
        content_revision: 4,
        status: "draft",
        approval_requested_revision: null,
        approval_requested_by: null,
      })
    })

    it("refuses self-approval and a decision naming another tenant's post", async () => {
      await expect(
        db.query(
          `insert into post_approval_decision
             (organisation_id, post_id, content_revision, content_hash,
              requested_by, decided_by, decision)
           values ($1, $2, 1, $3, $4, $4, 'approved')`,
          [ORG_A, PARKED, HASH, USER_1]
        )
      ).rejects.toThrow(/check/i)
      await expect(
        db.query(
          `insert into post_approval_decision
             (organisation_id, post_id, content_revision, content_hash,
              requested_by, decided_by, decision)
           values ($1, $2, 1, $3, $4, $5, 'approved')`,
          [ORG_A, OTHER_ORG_POST, HASH, USER_1, USER_2]
        )
      ).rejects.toThrow(/foreign key/i)
      await db.query(
        `insert into post_approval_decision
           (organisation_id, post_id, content_revision, content_hash,
            requested_by, decided_by, decision)
         values ($1, $2, 1, $3, $4, $5, 'approved')`,
        [ORG_A, PARKED, HASH, USER_1, USER_2]
      )
      const decisions = await db.query<{ count: number }>(
        `select count(*)::integer as count from post_approval_decision`
      )
      expect(decisions.rows[0].count).toBe(1)
    })
  })
})
