import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// 0083 keeps "a member or viewer holding a location_member row is
// 'assigned'" now that readers trust member.location_scope, and makes
// reconcile_member_location_scope() narrowing-only: once zero rows means no
// access, moving a row-less member to 'all' would be a widening.

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")
const scope0082 = read("0082_membership_scope.sql")
const invariant0083 = read("0083_membership_scope_invariant.sql")

const ORG = "00000000-0000-4000-8000-00000000000a"
const LOC_A = "10000000-0000-4000-8000-00000000000a"
const LOC_B = "10000000-0000-4000-8000-00000000000b"
const ADMIN_WITH_ROWS = "30000000-0000-4000-8000-000000000002"
const MEMBER_EMPTIED = "30000000-0000-4000-8000-000000000003"
const MEMBER_DRIFTED = "30000000-0000-4000-8000-000000000004"
const VIEWER_ALL = "30000000-0000-4000-8000-000000000005"

describe("0083 membership scope invariant", () => {
  let db: PGlite

  async function scopeOf(userId: string) {
    const result = await db.query<{ location_scope: string }>(
      "select location_scope from member where user_id = $1",
      [userId]
    )
    return result.rows[0]?.location_scope
  }

  beforeAll(async () => {
    db = new PGlite()
    // The slice of the schema 0001/0008/0043/0056 built, as in
    // tests/membership-scope-migration.test.ts.
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
        client_ids uuid[]
      );
    `)
    await db.exec(scope0082)
    await db.exec(`
      insert into member (organisation_id, user_id, role, location_scope) values
        ('${ORG}', '${ADMIN_WITH_ROWS}', 'admin', 'all'),
        ('${ORG}', '${MEMBER_EMPTIED}', 'member', 'assigned'),
        ('${ORG}', '${MEMBER_DRIFTED}', 'member', 'all'),
        ('${ORG}', '${VIEWER_ALL}', 'viewer', 'all');
      insert into location_member (organisation_id, location_id, user_id) values
        ('${ORG}', '${LOC_A}', '${ADMIN_WITH_ROWS}'),
        ('${ORG}', '${LOC_A}', '${MEMBER_DRIFTED}');
    `)
    await db.exec(invariant0083)
  })

  afterAll(async () => {
    await db.close()
  })

  it("is one transaction, records its version, and creates no table", () => {
    expect(invariant0083.trim().startsWith("begin;")).toBe(true)
    expect(invariant0083.trim().endsWith("commit;")).toBe(true)
    expect(invariant0083).toContain(
      "values ('0083_membership_scope_invariant')"
    )
    expect(invariant0083).not.toMatch(/create table/i)
  })

  it("narrows a member left 'all' with rows, and never widens an emptied assigned member", async () => {
    await expect(scopeOf(MEMBER_DRIFTED)).resolves.toBe("assigned")
    // The case that used to widen: assigned, every row gone. Stays assigned.
    await expect(scopeOf(MEMBER_EMPTIED)).resolves.toBe("assigned")
    // Owners and admins keep 'all'; their rows stay latent.
    await expect(scopeOf(ADMIN_WITH_ROWS)).resolves.toBe("all")
    await expect(scopeOf(VIEWER_ALL)).resolves.toBe("all")
  })

  it("reconcile is narrowing-only and a no-op when re-run", async () => {
    const again = await db.query<{ changed: number }>(
      "select reconcile_member_location_scope() as changed"
    )
    expect(again.rows[0].changed).toBe(0)
    await expect(scopeOf(MEMBER_EMPTIED)).resolves.toBe("assigned")
  })

  it("a row inserted for a member or viewer on 'all' names them 'assigned'", async () => {
    // An acceptance written by code older than 0082: rows under the default.
    await db.exec(`
      insert into location_member (organisation_id, location_id, user_id)
      values ('${ORG}', '${LOC_B}', '${VIEWER_ALL}')
    `)
    await expect(scopeOf(VIEWER_ALL)).resolves.toBe("assigned")
    // An admin's row stays latent.
    await db.exec(`
      insert into location_member (organisation_id, location_id, user_id)
      values ('${ORG}', '${LOC_B}', '${ADMIN_WITH_ROWS}')
    `)
    await expect(scopeOf(ADMIN_WITH_ROWS)).resolves.toBe("all")
  })

  it("demoting an admin who holds rows names them 'assigned', whatever the writer set", async () => {
    // An older PATCH: role and can_publish only.
    await db.exec(`
      update member set role = 'member', can_publish = false
      where user_id = '${ADMIN_WITH_ROWS}'
    `)
    await expect(scopeOf(ADMIN_WITH_ROWS)).resolves.toBe("assigned")
    // Promotion is untouched: the writer names it 'all'.
    await db.exec(`
      update member set role = 'admin', location_scope = 'all'
      where user_id = '${ADMIN_WITH_ROWS}'
    `)
    await expect(scopeOf(ADMIN_WITH_ROWS)).resolves.toBe("all")
  })

  it("demoting an admin with no rows leaves 'all'", async () => {
    const admin = "30000000-0000-4000-8000-000000000020"
    await db.exec(`
      insert into member (organisation_id, user_id, role, location_scope)
      values ('${ORG}', '${admin}', 'admin', 'all');
      update member set role = 'viewer' where user_id = '${admin}';
    `)
    await expect(scopeOf(admin)).resolves.toBe("all")
  })

  it("an 'all' save that names the scope before deleting the rows keeps 'all'", async () => {
    // PUT /api/members/[userId]/client-access with allClients: the scope
    // update runs while the rows still exist; only a role change is caught.
    await db.exec(`
      update member set location_scope = 'all' where user_id = '${VIEWER_ALL}';
      delete from location_member where user_id = '${VIEWER_ALL}';
    `)
    await expect(scopeOf(VIEWER_ALL)).resolves.toBe("all")
  })
})
