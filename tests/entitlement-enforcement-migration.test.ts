import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

/**
 * 0110 location limit trigger (plan P07-S3) against PGlite: new active links
 * stop at the effective limit, existing links are never touched, and both
 * the per-organisation flag and the env override (as withTenant records it
 * in app.billing_enforcement) turn it off.
 */

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const migration = read("0110_entitlement_enforcement.sql")
const hardening = read("0111_location_limit_hardening.sql")

const ORG = "00000000-0000-4000-8000-0000000000a1"
const OTHER = "00000000-0000-4000-8000-0000000000b2"

describe("0110 entitlement enforcement migration", () => {
  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0110_entitlement_enforcement")
    expect(REQUIRED_MIGRATIONS).toContain("0111_location_limit_hardening")
  })

  it("adds the per-organisation flag off by default and never deletes links", () => {
    expect(migration).toMatch(
      /add column enforcement_enabled boolean not null default false/
    )
    expect(migration).not.toMatch(/delete from location_link/)
    expect(migration).not.toMatch(/update location_link/)
  })

  describe("against PGlite", () => {
    let db: PGlite
    let plan3: string
    let plan2: string
    let plan1: string

    const link = (external: string, active = true) =>
      db.query(
        `insert into location_link (organisation_id, location_id, external_location_id, is_active)
         values ($1, gen_random_uuid(), $2, $3)
         on conflict (organisation_id, external_location_id) do update
         set is_active = excluded.is_active`,
        [ORG, external, active]
      )
    const active = async () =>
      (
        await db.query<{ n: number }>(
          "select billable_location_count($1) as n",
          [ORG]
        )
      ).rows[0].n
    const ext = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
    const billing = (sets: string) =>
      db.exec(
        `update organisation_billing set ${sets} where organisation_id = '${ORG}'`
      )
    const subscribed = (planId: string) =>
      billing(`
        state = 'active', plan_id = '${planId}', environment = 'test',
        stripe_customer_id = 'cus_A1', stripe_subscription_id = 'sub_A1',
        current_period_start = now() - interval '1 day',
        current_period_end = now() + interval '29 days',
        first_payment_succeeded = true, enforcement_enabled = true
      `)

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location_link (
          id uuid primary key default gen_random_uuid(),
          organisation_id uuid not null,
          location_id uuid not null,
          external_location_id uuid not null,
          is_active boolean not null default true,
          unique (organisation_id, external_location_id)
        );
        insert into organisation values ('${ORG}'), ('${OTHER}');
      `)
      await db.exec(read("0059_ai_credits.sql"))
      await db.exec(read("0107_billing_foundation.sql"))
      await db.exec(read("0108_billing_period_checks.sql"))
      await db.exec(migration)
      await db.exec(hardening)
      const plan = async (code: string, limit: number) =>
        (
          await db.query<{ id: string }>(
            `insert into billing_plan (code, version, workspace_mode, environment, name,
               stripe_price_id, location_limit, ai_draft_credits_per_period, is_test_offer)
             values ($1, 1, 'business', 'test', $1, $2, $3, 10, true)
             returning id::text as id`,
            [code, `price_${code}`, limit]
          )
        ).rows[0].id
      plan3 = await plan("three", 3)
      plan2 = await plan("two", 2)
      plan1 = await plan("one", 1)
    })

    afterAll(async () => {
      await db.close()
    })

    beforeEach(async () => {
      await db.exec(`
        delete from location_link;
        delete from organisation_billing;
        insert into organisation_billing (organisation_id, state)
        values ('${ORG}', 'pilot'), ('${OTHER}', 'pilot');
      `)
    })

    it("backfills existing organisations with enforcement off", async () => {
      const rows = await db.query<{ enforced: boolean }>(
        "select enforcement_enabled as enforced from organisation_billing"
      )
      expect(rows.rows.every((row) => !row.enforced)).toBe(true)
    })

    it("gives a pilot no limit, even when enforced", async () => {
      await billing("enforcement_enabled = true")
      for (let n = 1; n <= 5; n += 1) await link(ext(n))
      expect(await active()).toBe(5)
    })

    it("stops the link past the plan limit with location_limit_reached", async () => {
      await subscribed(plan2)
      await link(ext(1))
      await link(ext(2))
      const refused = await link(ext(3)).catch((error: unknown) => error)
      expect(refused).toMatchObject({
        message: "location_limit_reached",
        code: "23514",
        detail: "2",
      })
      expect(await active()).toBe(2)
    })

    it("lets an already active Google location be linked again", async () => {
      await subscribed(plan2)
      await link(ext(1))
      await link(ext(2))
      await expect(link(ext(2))).resolves.toBeDefined()
      expect(await active()).toBe(2)
    })

    it("checks reactivating an inactive link, and lets unlinking free a seat", async () => {
      await subscribed(plan2)
      await link(ext(1))
      await link(ext(2))
      await link(ext(3), false)
      await expect(
        db.query(
          "update location_link set is_active = true where external_location_id = $1",
          [ext(3)]
        )
      ).rejects.toMatchObject({ message: "location_limit_reached" })
      await db.query(
        "update location_link set is_active = false where external_location_id = $1",
        [ext(1)]
      )
      await db.query(
        "update location_link set is_active = true where external_location_id = $1",
        [ext(3)]
      )
      expect(await active()).toBe(2)
    })

    it("binds a scheduled lower limit on new links only, never unlinking", async () => {
      await subscribed(plan3)
      await link(ext(1))
      await link(ext(2))
      await billing(
        `pending_plan_id = '${plan1}', pending_effective_at = now() + interval '29 days'`
      )
      await expect(link(ext(3))).rejects.toMatchObject({
        message: "location_limit_reached",
        detail: "1",
      })
      // Both existing links stay, above the scheduled limit.
      expect(await active()).toBe(2)
      // Updating another column of an active link is not a new seat.
      await db.query(
        "update location_link set location_id = gen_random_uuid() where external_location_id = $1",
        [ext(1)]
      )
    })

    it("fails closed for a subscription state with no plan", async () => {
      await billing("state = 'read_only', enforcement_enabled = true")
      await expect(link(ext(1))).rejects.toMatchObject({
        message: "location_limit_reached",
        detail: "0",
      })
    })

    it("does nothing while the organisation's flag is off", async () => {
      await subscribed(plan1)
      await billing("enforcement_enabled = false")
      await link(ext(1))
      await link(ext(2))
      expect(await active()).toBe(2)
    })

    it("does nothing while the env override is off in the transaction", async () => {
      await subscribed(plan1)
      await link(ext(1))
      await db.transaction(async (tx) => {
        await tx.query(
          "select set_config('app.billing_enforcement', 'off', true)"
        )
        await tx.query(
          `insert into location_link (organisation_id, location_id, external_location_id)
           values ($1, gen_random_uuid(), $2)`,
          [ORG, ext(2)]
        )
      })
      expect(await active()).toBe(2)
      // 'on' (and no setting at all, as above) enforces.
      await db.transaction(async (tx) => {
        await tx.query(
          "select set_config('app.billing_enforcement', 'on', true)"
        )
        await expect(
          tx.query(
            `insert into location_link (organisation_id, location_id, external_location_id)
             values ($1, gen_random_uuid(), $2)`,
            [ORG, ext(3)]
          )
        ).rejects.toMatchObject({ message: "location_limit_reached" })
      })
    })

    it("refuses billable_location_count to the runtime role", async () => {
      await db.query(
        `insert into location_link (organisation_id, location_id, external_location_id)
         values ($1, gen_random_uuid(), $2)`,
        [OTHER, ext(9)]
      )
      await db.transaction(async (tx) => {
        await tx.query("set local role naba_app_runtime")
        await expect(
          tx.query("select billable_location_count($1) as n", [OTHER])
        ).rejects.toMatchObject({ code: "42501" })
      })
    })

    it("treats a missing billing row as the app does", async () => {
      await db.exec(
        `delete from organisation_billing where organisation_id = '${ORG}'`
      )
      // No setting (an operator connection): no flag to read, so it passes.
      await link(ext(1))
      expect(await active()).toBe(1)
      // The app's tenant transaction with enforcement on: limit 0.
      await db.transaction(async (tx) => {
        await tx.query(
          "select set_config('app.billing_enforcement', 'on', true)"
        )
        await expect(
          tx.query(
            `insert into location_link (organisation_id, location_id, external_location_id)
             values ($1, gen_random_uuid(), $2)`,
            [ORG, ext(2)]
          )
        ).rejects.toMatchObject({
          message: "location_limit_reached",
          detail: "0",
        })
      })
      // ... and 'off' passes.
      await db.transaction(async (tx) => {
        await tx.query(
          "select set_config('app.billing_enforcement', 'off', true)"
        )
        await tx.query(
          `insert into location_link (organisation_id, location_id, external_location_id)
           values ($1, gen_random_uuid(), $2)`,
          [ORG, ext(2)]
        )
      })
      expect(await active()).toBe(2)
    })

    it("counts only the organisation's own links", async () => {
      await subscribed(plan1)
      await db.query(
        `insert into location_link (organisation_id, location_id, external_location_id)
         values ($1, gen_random_uuid(), $2)`,
        [OTHER, ext(9)]
      )
      await link(ext(1))
      expect(await active()).toBe(1)
    })
  })
})
