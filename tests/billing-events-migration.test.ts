import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const migration = read("0225_billing_events.sql")

const ORG = "00000000-0000-4000-8000-0000000000e1"
const OTHER = "00000000-0000-4000-8000-0000000000e2"
const HASH = "a".repeat(64)

describe("0225 billing events migration", () => {
  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0225_billing_events")
  })

  it("gives the runtime no table privilege, only the functions", () => {
    expect(migration).toContain(
      "alter table billing_event force row level security"
    )
    expect(migration).not.toMatch(/grant [^;]* on billing_event to/)
    for (const fn of [
      "record_billing_event",
      "claim_billing_events",
      "settle_billing_event",
      "billing_reconcile_page",
    ]) {
      expect(migration).toMatch(
        new RegExp(`revoke all on function ${fn}\\([^)]*\\)\\s*from public`)
      )
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function ${fn}\\([^)]*\\)\\s*to naba_app_runtime`
        )
      )
    }
  })

  describe("against PGlite", () => {
    let db: PGlite

    const record = async (
      eventId: string,
      customer: string | null,
      handled = true
    ) =>
      (
        await db.query<{ id: string; inserted: boolean; status: string }>(
          `select id::text as id, inserted, status
           from record_billing_event($1, 'invoice.paid', false, null, $2, $3, now(), $4)`,
          [eventId, customer, HASH, handled]
        )
      ).rows[0]

    const claim = async (limit = 10, lease = 60, max = 3) =>
      (
        await db.query<{
          id: string
          organisation_id: string | null
          retry_count: number
        }>(
          `select id::text as id, organisation_id::text as organisation_id, retry_count
           from claim_billing_events($1, $2, $3)`,
          [limit, lease, max]
        )
      ).rows

    const settle = async (id: string, outcome: string, max = 3) =>
      (
        await db.query<{ status: string }>(
          `select settle_billing_event($1::uuid, $2, 'code', 30, $3) as status`,
          [id, outcome, max]
        )
      ).rows[0].status

    const row = async (id: string) =>
      (
        await db.query<{
          status: string
          retry_count: number
          organisation_id: string | null
          last_error_code: string | null
        }>(
          `select status, retry_count, organisation_id::text as organisation_id, last_error_code
           from billing_event where id = $1`,
          [id]
        )
      ).rows[0]

    const due = (id: string) =>
      db.query(
        `update billing_event set next_attempt_at = now() - interval '1 second' where id = $1`,
        [id]
      )

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key, workspace_mode text not null default 'business');
        create table app_user (id uuid primary key);
        create table ops_heartbeat (name text primary key, beat_at timestamptz);
        create table cron_cursor (name text primary key, organisation_cursor uuid, attempts integer not null default 0, updated_at timestamptz not null default now());
        insert into organisation (id) values ('${ORG}'), ('${OTHER}');
      `)
      await db.exec(read("0059_ai_credits.sql"))
      await db.exec(read("0220_billing_foundation.sql"))
      await db.exec(read("0221_billing_period_checks.sql"))
      await db.exec(migration)
      await db.exec(`
        update organisation_billing set stripe_customer_id = 'cus_known'
        where organisation_id = '${ORG}';
      `)
    })

    afterAll(async () => {
      await db.close()
    })

    it("seeds the tick's heartbeat and cursor rows", async () => {
      const beats = await db.query(
        `select 1 from ops_heartbeat where name = 'billing-reconcile'`
      )
      const cursors = await db.query(
        `select 1 from cron_cursor where name = 'billing'`
      )
      expect(beats.rows).toHaveLength(1)
      expect(cursors.rows).toHaveLength(1)
    })

    it("records an event once however often it is delivered", async () => {
      const first = await record("evt_dup", "cus_known")
      const again = await record("evt_dup", "cus_known")
      expect(first).toMatchObject({ inserted: true, status: "received" })
      expect(again).toEqual({
        id: first.id,
        inserted: false,
        status: "received",
      })
      const count = await db.query(
        `select 1 from billing_event where external_event_id = 'evt_dup'`
      )
      expect(count.rows).toHaveLength(1)
      await claim()
      await settle(first.id, "processed")
    })

    it("keeps unhandled event types as ignored receipts", async () => {
      const ignored = await record("evt_ignored", "cus_known", false)
      expect(ignored.status).toBe("ignored")
      expect(await claim()).toEqual([])
    })

    it("resolves the organisation from the customer when claiming", async () => {
      const known = await record("evt_known", "cus_known")
      const unknown = await record("evt_unknown", "cus_nobody")
      const claimed = await claim()
      expect(claimed.map((r) => [r.id, r.organisation_id]).sort()).toEqual(
        [
          [known.id, ORG],
          [unknown.id, null],
        ].sort()
      )
      // Claimed rows are not claimed twice while the lease holds.
      expect(await claim()).toEqual([])
      expect(await settle(known.id, "processed")).toBe("processed")
      expect(await settle(known.id, "processed")).toBe("stale")
      // An unknown customer is held, never dead, however often it recurs.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(await settle(unknown.id, "held")).toBe("held")
        await due(unknown.id)
        expect((await claim()).map((r) => r.id)).toEqual([unknown.id])
      }
      expect(await settle(unknown.id, "held")).toBe("held")
      expect((await row(unknown.id)).status).toBe("held")
    })

    it("retries a failure and dead-letters it after the last attempt", async () => {
      const event = await record("evt_fail", "cus_known")
      await claim()
      expect(await settle(event.id, "failed")).toBe("failed")
      expect(await claim()).toEqual([]) // backing off
      await due(event.id)
      await claim()
      expect(await settle(event.id, "failed")).toBe("failed")
      await due(event.id)
      await claim()
      expect(await settle(event.id, "failed")).toBe("dead")
      await due(event.id)
      expect(await claim()).toEqual([])
      expect(await row(event.id)).toMatchObject({
        status: "dead",
        retry_count: 3,
      })
    })

    it("reclaims an expired lease and dead-letters a worker that keeps dying", async () => {
      const event = await record("evt_crash", "cus_known")
      expect((await claim(10, 60)).map((r) => r.id)).toEqual([event.id])
      const expire = () =>
        db.query(
          `update billing_event set lease_expires_at = now() - interval '1 second' where id = $1`,
          [event.id]
        )
      await expire()
      const [reclaimed] = await claim(10, 60)
      expect(reclaimed).toMatchObject({ id: event.id, retry_count: 1 })
      await expire()
      expect((await claim(10, 60))[0]).toMatchObject({ retry_count: 2 })
      await expire()
      expect(await claim(10, 60)).toEqual([])
      expect(await row(event.id)).toMatchObject({
        status: "dead",
        last_error_code: "lease_expired",
      })
    })

    it("pages organisations with a Stripe customer only", async () => {
      const page = await db.query<{ organisation_id: string }>(
        `select organisation_id::text as organisation_id from billing_reconcile_page(null, 10)`
      )
      expect(page.rows).toEqual([{ organisation_id: ORG }])
      const after = await db.query(
        `select * from billing_reconcile_page($1::uuid, 10)`,
        [ORG]
      )
      expect(after.rows).toEqual([])
    })

    it("lets the runtime close a period but read no receipt", async () => {
      await db.exec(`
        grant usage on schema public to naba_app_runtime;
        set role naba_app_runtime;
      `)
      try {
        await expect(db.query(`select * from billing_event`)).rejects.toThrow(
          /permission denied/
        )
        await expect(
          db.query(`update billing_event set status = 'processed'`)
        ).rejects.toThrow(/permission denied/)
        // The definer functions still work for it.
        const receipt = await record("evt_runtime", "cus_known")
        expect(receipt.inserted).toBe(true)
        await expect(
          db.query(`update ai_credit_period set allowance = 1`)
        ).rejects.toThrow(/permission denied/)
      } finally {
        await db.exec(`reset role`)
      }
    })
  })
})
