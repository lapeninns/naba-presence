import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0063_membership_scope.sql"),
  "utf8"
)

const ORG = "00000000-0000-4000-8000-00000000000a"
const LOC_A = "10000000-0000-4000-8000-00000000000a"
const LOC_B = "10000000-0000-4000-8000-00000000000b"
const CLIENT = "20000000-0000-4000-8000-00000000000a"
const OWNER = "30000000-0000-4000-8000-000000000001"
const ADMIN_WITH_ROWS = "30000000-0000-4000-8000-000000000002"
const MEMBER_WITH_ROWS = "30000000-0000-4000-8000-000000000003"
const MEMBER_NO_ROWS = "30000000-0000-4000-8000-000000000004"
const VIEWER_WITH_ROWS = "30000000-0000-4000-8000-000000000005"
const VIEWER_NO_ROWS = "30000000-0000-4000-8000-000000000006"

describe("0063 membership scope", () => {
  it("adds the scope without a rewrite and proves NOT NULL before setting it", () => {
    expect(migration).toContain(
      "add column if not exists location_scope text default 'all'"
    )
    expect(migration).toMatch(/check \(location_scope is not null\) not valid/)
    expect(migration).toContain(
      "alter table member validate constraint member_location_scope_not_null"
    )
    expect(migration).toContain(
      "alter table member alter column location_scope set not null"
    )
    expect(migration).not.toMatch(/create table/i)
    expect(migration.trim().startsWith("begin;")).toBe(true)
    expect(migration.trim().endsWith("commit;")).toBe(true)
    expect(migration).toContain("values ('0063_membership_scope')")
  })

  describe("against PGlite", () => {
    let db: PGlite

    async function memberScopes() {
      const result = await db.query<{
        user_id: string
        location_scope: string
      }>("select user_id::text, location_scope from member order by user_id")
      return Object.fromEntries(
        result.rows.map((row) => [row.user_id, row.location_scope])
      )
    }

    async function invitationScopes() {
      const result = await db.query<{ email: string; location_scope: string }>(
        "select email, location_scope from invitation order by email"
      )
      return Object.fromEntries(
        result.rows.map((row) => [row.email, row.location_scope])
      )
    }

    async function rejects(statement: string) {
      await expect(db.exec(statement)).rejects.toThrow(/check constraint/)
    }

    beforeAll(async () => {
      db = new PGlite()
      // The slice of the schema 0001/0008/0043/0056 built.
      await db.exec(`
        create table schema_migration (version text primary key);
        create table member (
          organisation_id uuid not null,
          user_id uuid not null,
          role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
          can_publish boolean not null default false,
          primary key (organisation_id, user_id)
        );
        create table location_member (
          organisation_id uuid not null,
          location_id uuid not null,
          user_id uuid not null,
          can_publish boolean not null default false,
          primary key (location_id, user_id)
        );
        create table invitation (
          id uuid primary key default gen_random_uuid(),
          organisation_id uuid not null,
          email text not null,
          role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
          location_ids uuid[],
          client_ids uuid[],
          constraint invitation_client_ids_scope_check check (
            client_ids is null
            or (cardinality(client_ids) > 0 and role in ('member', 'viewer'))
          )
        );
        insert into member (organisation_id, user_id, role) values
          ('${ORG}', '${OWNER}', 'owner'),
          ('${ORG}', '${ADMIN_WITH_ROWS}', 'admin'),
          ('${ORG}', '${MEMBER_WITH_ROWS}', 'member'),
          ('${ORG}', '${MEMBER_NO_ROWS}', 'member'),
          ('${ORG}', '${VIEWER_WITH_ROWS}', 'viewer'),
          ('${ORG}', '${VIEWER_NO_ROWS}', 'viewer');
        insert into location_member (organisation_id, location_id, user_id) values
          ('${ORG}', '${LOC_A}', '${ADMIN_WITH_ROWS}'),
          ('${ORG}', '${LOC_A}', '${MEMBER_WITH_ROWS}'),
          ('${ORG}', '${LOC_B}', '${MEMBER_WITH_ROWS}'),
          ('${ORG}', '${LOC_B}', '${VIEWER_WITH_ROWS}');
        insert into invitation (organisation_id, email, role, client_ids) values
          ('${ORG}', 'all@example.test', 'member', null),
          ('${ORG}', 'client@example.test', 'viewer', array['${CLIENT}']::uuid[]),
          ('${ORG}', 'admin@example.test', 'admin', null);
      `)
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    it("backfills assigned only for members and viewers that hold rows", async () => {
      await expect(memberScopes()).resolves.toEqual({
        [OWNER]: "all",
        [ADMIN_WITH_ROWS]: "all",
        [MEMBER_WITH_ROWS]: "assigned",
        [MEMBER_NO_ROWS]: "all",
        [VIEWER_WITH_ROWS]: "assigned",
        [VIEWER_NO_ROWS]: "all",
      })
      // Latent grants survive: the admin's row is kept, only named 'all'.
      const rows = await db.query<{ count: number }>(
        `select count(*)::int as count from location_member where user_id = '${ADMIN_WITH_ROWS}'`
      )
      expect(rows.rows[0].count).toBe(1)
    })

    it("backfills invitations from their client or location ids", async () => {
      await expect(invitationScopes()).resolves.toEqual({
        "admin@example.test": "all",
        "all@example.test": "all",
        "client@example.test": "assigned",
      })
    })

    it("is a no-op when re-run", async () => {
      const before = [await memberScopes(), await invitationScopes()]
      await db.exec(migration)
      expect([await memberScopes(), await invitationScopes()]).toEqual(before)
      const versions = await db.query<{ count: number }>(
        "select count(*)::int as count from schema_migration where version = '0063_membership_scope'"
      )
      expect(versions.rows[0].count).toBe(1)
    })

    it("defaults a new member to all and refuses an unknown or missing scope", async () => {
      const user = "30000000-0000-4000-8000-000000000099"
      await db.exec(
        `insert into member (organisation_id, user_id, role) values ('${ORG}', '${user}', 'member')`
      )
      expect((await memberScopes())[user]).toBe("all")
      await rejects(
        `update member set location_scope = 'some' where user_id = '${user}'`
      )
      await expect(
        db.exec(
          `update member set location_scope = null where user_id = '${user}'`
        )
      ).rejects.toThrow(/not-null|null value/)
    })

    it("accepts a client-scoped invitation written the way the deployed code writes it", async () => {
      // POST /api/invitations before this release: client_ids, no scope.
      await db.exec(`
        insert into invitation (organisation_id, email, role, client_ids)
        values ('${ORG}', 'old-writer@example.test', 'viewer', array['${CLIENT}']::uuid[])
      `)
      expect((await invitationScopes())["old-writer@example.test"]).toBe(
        "assigned"
      )
    })

    it("reconciles a scope an older writer left out of step with the rows", async () => {
      const accepted = "30000000-0000-4000-8000-000000000010"
      const widened = "30000000-0000-4000-8000-000000000011"
      const demoted = "30000000-0000-4000-8000-000000000012"
      await db.exec(`
        -- Older acceptance: rows under the default 'all'.
        insert into member (organisation_id, user_id, role)
        values ('${ORG}', '${accepted}', 'member');
        insert into location_member (organisation_id, location_id, user_id)
        values ('${ORG}', '${LOC_A}', '${accepted}');
        -- Older "every client" save from an assigned member: rows gone,
        -- scope left 'assigned'.
        insert into member (organisation_id, user_id, role, location_scope)
        values ('${ORG}', '${widened}', 'viewer', 'assigned');
        -- Older demotion of an admin holding latent rows: scope left 'all'.
        insert into member (organisation_id, user_id, role)
        values ('${ORG}', '${demoted}', 'viewer');
        insert into location_member (organisation_id, location_id, user_id)
        values ('${ORG}', '${LOC_B}', '${demoted}');
      `)
      const fixed = await db.query<{ changed: number }>(
        "select reconcile_member_location_scope() as changed"
      )
      expect(fixed.rows[0].changed).toBe(3)
      const scopes = await memberScopes()
      expect(scopes[accepted]).toBe("assigned")
      expect(scopes[widened]).toBe("all")
      expect(scopes[demoted]).toBe("assigned")
      // Owners and admins stay 'all' whatever rows they hold.
      expect(scopes[ADMIN_WITH_ROWS]).toBe("all")
      const again = await db.query<{ changed: number }>(
        "select reconcile_member_location_scope() as changed"
      )
      expect(again.rows[0].changed).toBe(0)
    })

    it("ties an invitation's scope to its client or location ids", async () => {
      // A location scope for a member: accepted.
      await db.exec(`
        insert into invitation (organisation_id, email, role, location_ids, location_scope)
        values ('${ORG}', 'loc@example.test', 'member', array['${LOC_A}']::uuid[], 'assigned')
      `)
      // 'assigned' with nothing named.
      await rejects(`
        insert into invitation (organisation_id, email, role, location_scope)
        values ('${ORG}', 'empty@example.test', 'member', 'assigned')
      `)
      // Ids named with the scope explicitly 'all': the trigger names it.
      await db.exec(`
        insert into invitation (organisation_id, email, role, location_ids, location_scope)
        values ('${ORG}', 'mismatch@example.test', 'member', array['${LOC_A}']::uuid[], 'all')
      `)
      expect((await invitationScopes())["mismatch@example.test"]).toBe(
        "assigned"
      )
      // An empty list.
      await rejects(`
        insert into invitation (organisation_id, email, role, location_ids, location_scope)
        values ('${ORG}', 'none@example.test', 'member', '{}'::uuid[], 'assigned')
      `)
      // A scope on an admin.
      await rejects(`
        insert into invitation (organisation_id, email, role, location_ids, location_scope)
        values ('${ORG}', 'adm@example.test', 'admin', array['${LOC_A}']::uuid[], 'assigned')
      `)
      // Clients and locations at once.
      await rejects(`
        insert into invitation (organisation_id, email, role, client_ids, location_ids, location_scope)
        values ('${ORG}', 'both@example.test', 'member',
          array['${CLIENT}']::uuid[], array['${LOC_A}']::uuid[], 'assigned')
      `)
    })
  })
})
