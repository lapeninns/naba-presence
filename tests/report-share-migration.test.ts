import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0057_report_share.sql"),
  "utf8"
)

const ORG_A = "00000000-0000-4000-8000-00000000000a"
const ORG_B = "00000000-0000-4000-8000-00000000000b"
const CLIENT_A = "11111111-1111-4111-8111-111111111111"
const CLIENT_ARCHIVED = "22222222-2222-4222-8222-222222222222"
const CLIENT_B = "33333333-3333-4333-8333-333333333333"

const hash = (seed: string) => seed.repeat(64).slice(0, 64)

describe("0057 report_share migration", () => {
  it("stores a hash only, isolates tenants and grants the runtime role", () => {
    expect(migration).toContain("create table report_share")
    expect(migration).toContain("token_hash text not null unique")
    expect(migration).not.toMatch(/token_ciphertext|\btoken text\b/)
    expect(migration).toContain("expires_at timestamptz not null")
    expect(migration).toContain(
      "alter table report_share force row level security"
    )
    expect(migration).toMatch(
      /grant select, insert, update on report_share to naba_app_runtime/
    )
    expect(migration).not.toMatch(/grant[^;]*delete[^;]*on report_share/)
    expect(migration).toMatch(
      /revoke all on function lookup_report_share\(text\) from public/
    )
  })

  describe("lookup_report_share against PGlite", () => {
    let db: PGlite

    beforeAll(async () => {
      db = new PGlite()
      // The slice of the schema 0057 builds on.
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table client (
          id uuid primary key,
          organisation_id uuid not null references organisation(id),
          archived_at timestamptz
        );
        insert into organisation (id) values ('${ORG_A}'), ('${ORG_B}');
        insert into client (id, organisation_id, archived_at) values
          ('${CLIENT_A}', '${ORG_A}', null),
          ('${CLIENT_ARCHIVED}', '${ORG_A}', now()),
          ('${CLIENT_B}', '${ORG_B}', null);
      `)
      await db.exec(migration)
      await db.exec(`
        insert into report_share
          (organisation_id, client_id, token_hash, created_at, expires_at, revoked_at)
        values
          ('${ORG_A}', '${CLIENT_A}', '${hash("a")}', now(), now() + interval '90 days', null),
          ('${ORG_A}', '${CLIENT_A}', '${hash("b")}', now(), now() + interval '90 days', now()),
          ('${ORG_A}', '${CLIENT_A}', '${hash("c")}', now() - interval '91 days', now() - interval '1 day', null),
          ('${ORG_A}', '${CLIENT_ARCHIVED}', '${hash("d")}', now(), now() + interval '90 days', null),
          -- A share whose organisation disagrees with its client's: never live.
          ('${ORG_B}', '${CLIENT_A}', '${hash("e")}', now(), now() + interval '90 days', null);
      `)
    })

    afterAll(async () => {
      await db.close()
    })

    const lookup = async (tokenHash: string) =>
      (
        await db.query<{
          share_id: string
          organisation_id: string
          client_id: string
        }>("select * from lookup_report_share($1)", [tokenHash])
      ).rows

    it("resolves a live link to its organisation and client, ids only", async () => {
      const rows = await lookup(hash("a"))
      expect(rows).toHaveLength(1)
      expect(Object.keys(rows[0]).sort()).toEqual([
        "client_id",
        "organisation_id",
        "share_id",
      ])
      expect(rows[0]).toMatchObject({
        organisation_id: ORG_A,
        client_id: CLIENT_A,
      })
    })

    it.each([
      ["revoked", "b"],
      ["expired", "c"],
      ["archived client", "d"],
      ["cross-organisation", "e"],
      ["unknown", "f"],
    ])("returns nothing for a %s link", async (_label, seed) => {
      expect(await lookup(hash(seed))).toEqual([])
    })

    it("refuses a token_hash that is not a SHA-256 hex digest", async () => {
      await expect(
        db.exec(`
          insert into report_share (organisation_id, client_id, token_hash, expires_at)
          values ('${ORG_A}', '${CLIENT_A}', 'plaintext-token', now() + interval '1 day')
        `)
      ).rejects.toThrow()
    })

    it("refuses a link that expires before it was made", async () => {
      await expect(
        db.exec(`
          insert into report_share (organisation_id, client_id, token_hash, expires_at)
          values ('${ORG_A}', '${CLIENT_A}', '${hash("9")}', now() - interval '1 day')
        `)
      ).rejects.toThrow()
    })
  })
})
