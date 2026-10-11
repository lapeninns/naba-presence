import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0200_mfa_assurance.sql"),
  "utf8"
)

const USER = "00000000-0000-4000-8000-0000000000b1"
const OTHER = "00000000-0000-4000-8000-0000000000b2"
const ORG = "00000000-0000-4000-8000-0000000000c1"
const hash = (seed: string) => seed.repeat(64).slice(0, 64)

describe("0200 MFA assurance migration", () => {
  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0200_mfa_assurance")
  })

  it("keeps the ticket table behind forced RLS and definer functions", () => {
    expect(migration).toContain(
      "alter table mfa_pending_login force row level security"
    )
    expect(migration).not.toMatch(/create policy[^;]*mfa_pending_login/)
    expect(migration).toMatch(
      /grant select on mfa_pending_login to naba_app_runtime/
    )
    expect(migration).not.toMatch(
      /grant[^;]*(insert|update|delete)[^;]*on mfa_pending_login/
    )
    for (const fn of [
      "create_mfa_pending_login",
      "read_mfa_pending_login",
      "take_mfa_pending_attempt",
      "consume_mfa_pending_login",
      "discard_mfa_pending_login",
      "purge_mfa_pending_logins",
    ]) {
      expect(migration).toMatch(new RegExp(`revoke all on function ${fn}\\(`))
      expect(migration).toMatch(
        new RegExp(`grant execute on function ${fn}\\(`)
      )
    }
  })

  it("locks app_session before app_user, with a lock timeout, before altering either", () => {
    const lock = migration.indexOf(
      "lock table app_session, app_user in access exclusive mode"
    )
    const timeout = migration.indexOf("set local lock_timeout")
    expect(timeout).toBeGreaterThan(-1)
    expect(lock).toBeGreaterThan(timeout)
    const alterSession = migration.indexOf("alter table app_session")
    const alterUser = migration.indexOf("alter table app_user")
    expect(alterSession).toBeGreaterThan(lock)
    expect(alterUser).toBeGreaterThan(alterSession)
  })

  describe("against PGlite", () => {
    let db: PGlite

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table app_user (
          id uuid primary key,
          auth_provider text,
          auth_subject text
        );
        create table app_session (
          id uuid primary key default gen_random_uuid(),
          token_hash text not null unique,
          user_id uuid not null references app_user(id) on delete cascade,
          organisation_id uuid not null,
          support_actor text,
          expires_at timestamptz not null default now() + interval '1 day'
        );
        insert into app_user values
          ('${USER}', 'supabase', 'subject-1'),
          ('${OTHER}', 'supabase', 'subject-2');
      `)
      await db.exec(migration)
    })

    afterAll(async () => {
      await db.close()
    })

    async function open(
      ticketHash: string,
      subject = "subject-1",
      purpose = "sign_in"
    ) {
      await db.query(
        `select create_mfa_pending_login(
           $1, $2, 'supabase', $3, null, null, null,
           '[{"id":"f1","friendlyName":null}]'::jsonb,
           '{"passwordReset":false}'::jsonb,
           '\\x01'::bytea
         )`,
        [ticketHash, purpose, subject]
      )
    }

    async function attempt(ticketHash: string) {
      const result = await db.query<{ attempts: number }>(
        "select attempts from take_mfa_pending_attempt($1, 5)",
        [ticketHash]
      )
      return result.rows[0]?.attempts ?? null
    }

    it("counts attempts and refuses the sixth", async () => {
      await open(hash("a"))
      const counts = []
      for (let index = 0; index < 6; index += 1) {
        counts.push(await attempt(hash("a")))
      }
      expect(counts).toEqual([1, 2, 3, 4, 5, null])
    })

    it("lets exactly one caller consume a ticket", async () => {
      await open(hash("b"), "subject-2")
      const first = await db.query<{ ok: boolean }>(
        "select consume_mfa_pending_login($1) as ok",
        [hash("b")]
      )
      const second = await db.query<{ ok: boolean }>(
        "select consume_mfa_pending_login($1) as ok",
        [hash("b")]
      )
      expect([first.rows[0]?.ok, second.rows[0]?.ok]).toEqual([true, false])
    })

    it("refuses an expired ticket and purges it", async () => {
      await open(hash("c"), "subject-3")
      await db.query(
        "update mfa_pending_login set expires_at = now() - interval '1 second' where ticket_hash = $1",
        [hash("c")]
      )
      expect(await attempt(hash("c"))).toBeNull()
      const read = await db.query("select * from read_mfa_pending_login($1)", [
        hash("c"),
      ])
      expect(read.rows).toHaveLength(0)
      const purged = await db.query<{ count: number }>(
        "select purge_mfa_pending_logins(100) as count"
      )
      expect(purged.rows[0]?.count).toBeGreaterThanOrEqual(1)
    })

    it("replaces an earlier ticket for the same identity and purpose", async () => {
      await open(hash("d"), "subject-4")
      await open(hash("e"), "subject-4")
      expect(await attempt(hash("d"))).toBeNull()
      expect(await attempt(hash("e"))).toBe(1)
    })

    it("requires an enroll ticket to name its person, session and factor", async () => {
      await expect(open(hash("f"), "subject-5", "enroll")).rejects.toThrow(
        /check constraint/
      )
    })

    it("only ever raises security_version", async () => {
      await db.query("update app_user set security_version = 2 where id = $1", [
        USER,
      ])
      await expect(
        db.query("update app_user set security_version = 1 where id = $1", [
          USER,
        ])
      ).rejects.toThrow(/security_version_decrease/)
    })

    it("refuses an aal2 session without its proof", async () => {
      await expect(
        db.query(
          `insert into app_session (token_hash, user_id, organisation_id, aal)
           values ('aal2-no-proof', $1, $2, 'aal2')`,
          [USER, ORG]
        )
      ).rejects.toThrow(/app_session_aal2_verified/)
      const existing = await db.query<{ aal: string; securityVersion: number }>(
        `insert into app_session (token_hash, user_id, organisation_id)
         values ('legacy', $1, $2)
         returning aal, security_version as "securityVersion"`,
        [OTHER, ORG]
      )
      expect(existing.rows[0]).toEqual({ aal: "aal1", securityVersion: 1 })
    })
  })
})
