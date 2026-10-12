import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  getOrganisationAccess,
  getOrganisationBilling,
  lockOrganisationBilling,
  seedPilotBilling,
} from "@/lib/server/billing/state"
import { BILLING_STATES } from "@/lib/domain/entitlements"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")

const aiCredits = read("0059_ai_credits.sql")
const migration = read("0107_billing_foundation.sql")
const periodChecks = read("0108_billing_period_checks.sql")

const ORG_A = "00000000-0000-4000-8000-00000000000a"
const ORG_B = "00000000-0000-4000-8000-00000000000b"
const ORG_NEW = "00000000-0000-4000-8000-00000000000c"

describe("0107 billing foundation migration", () => {
  it("forces tenant isolation on both tenant tables", () => {
    for (const table of ["organisation_billing", "ai_credit_period"]) {
      expect(migration).toContain(
        `alter table ${table} force row level security`
      )
      expect(migration).toMatch(
        new RegExp(`create policy tenant_isolation on ${table}`)
      )
    }
    expect(migration).toMatch(
      /grant select, insert, update on organisation_billing to naba_app_runtime/
    )
    expect(migration).toMatch(
      /grant select, insert on ai_credit_period to naba_app_runtime/
    )
    expect(migration).toMatch(
      /grant select on billing_plan to naba_app_runtime/
    )
    expect(migration).not.toMatch(/grant[^;]*delete[^;]*to naba_app_runtime/)
  })

  it("lists every billing state the domain knows", () => {
    for (const state of BILLING_STATES) {
      expect(migration).toContain(`'${state}'`)
    }
  })

  it("is listed in the required-migrations manifest", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0107_billing_foundation")
  })

  describe("against PGlite", () => {
    let db: PGlite
    // Adapt the postgres.js tagged template to PGlite (rows array result).
    const sql = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      let text = strings[0]
      values.forEach((_v, i) => {
        text += "$" + (i + 1) + strings[i + 1]
      })
      return (await db.query(text, values)).rows
    }) as never

    beforeAll(async () => {
      db = new PGlite()
      await db.exec(`
        create role naba_app_runtime;
        create table schema_migration (version text primary key);
        create table organisation (id uuid primary key);
        create table app_user (id uuid primary key);
        create table location_link (id uuid primary key default gen_random_uuid(), organisation_id uuid not null, location_id uuid not null, external_location_id uuid not null, is_active boolean not null default true);
        insert into organisation values ('${ORG_A}'), ('${ORG_B}');
      `)
      await db.exec(aiCredits)
      await db.exec(`
        insert into ai_usage (organisation_id, kind, status, credits, model, period_start)
        values ('${ORG_A}', 'draft', 'settled', 1, 'm', '2026-10-01');
      `)
      await db.exec(migration)
      await db.exec(periodChecks)
      await db.exec(read("0110_entitlement_enforcement.sql"))
      await db.exec(`insert into organisation values ('${ORG_NEW}');`)
    })

    afterAll(async () => {
      await db.close()
    })

    const count = async (query: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from ${query}`))
        .rows[0].n

    it("backfills every existing organisation as pilot and grants nothing", async () => {
      const rows = await db.query<{ id: string; state: string }>(
        "select organisation_id::text as id, state from organisation_billing order by 1"
      )
      expect(rows.rows).toEqual([
        { id: ORG_A, state: "pilot" },
        { id: ORG_B, state: "pilot" },
      ])
      expect(await count("ai_credit_period")).toBe(0)
      expect(await count("ai_usage where credit_period_id is not null")).toBe(0)
      expect(await count("billing_plan")).toBe(0)
      const [recorded] = (
        await db.query(
          "select 1 from schema_migration where version = '0107_billing_foundation'"
        )
      ).rows
      expect(recorded).toBeDefined()
    })

    it("seeds a pilot for a new organisation once", async () => {
      expect((await getOrganisationBilling(sql, ORG_NEW)).billing).toBeNull()
      expect((await getOrganisationAccess(sql, ORG_NEW)).reason).toBe(
        "billing_missing"
      )
      await seedPilotBilling(sql, ORG_NEW)
      await seedPilotBilling(sql, ORG_NEW)
      const view = await lockOrganisationBilling(sql, ORG_NEW)
      expect(view.billing).toMatchObject({
        organisationId: ORG_NEW,
        state: "pilot",
        planId: null,
        cancelAtPeriodEnd: false,
        firstPaymentSucceeded: false,
        version: 1,
      })
      expect(view.plan).toBeNull()
      expect((await getOrganisationAccess(sql, ORG_NEW)).reason).toBe("pilot")
    })

    async function insertPlan(values: Record<string, unknown>) {
      const row = {
        code: "starter",
        version: 1,
        workspace_mode: "business",
        environment: "test",
        name: "Starter",
        location_limit: 5,
        ai_draft_credits_per_period: 100,
        is_test_offer: true,
        ...values,
      }
      const keys = Object.keys(row)
      const result = await db.query<{ id: string }>(
        `insert into billing_plan (${keys.join(", ")})
         values (${keys.map((_k, i) => `$${i + 1}`).join(", ")})
         returning id::text as id`,
        Object.values(row)
      )
      return result.rows[0].id
    }

    it("enforces the catalog's fail-closed rules", async () => {
      // A test-environment plan must be marked as a test offer.
      await expect(
        insertPlan({ code: "bad_test", is_test_offer: false })
      ).rejects.toThrow()
      // An active plan must name its price.
      await expect(
        insertPlan({ code: "no_price", active: true })
      ).rejects.toThrow()
      await expect(
        insertPlan({ code: "bad_price", stripe_price_id: "prod_123" })
      ).rejects.toThrow()
      await insertPlan({ code: "dup" })
      await expect(insertPlan({ code: "dup" })).rejects.toThrow()
      await insertPlan({ code: "dup", version: 2 })
    })

    it("keeps a published plan's terms immutable apart from active", async () => {
      const id = await insertPlan({
        code: "frozen",
        stripe_price_id: "price_frozen1",
      })
      await db.query("update billing_plan set active = true where id = $1", [
        id,
      ])
      await expect(
        db.query("update billing_plan set location_limit = 50 where id = $1", [
          id,
        ])
      ).rejects.toThrow(/immutable/)
      await expect(
        db.query(
          "update billing_plan set stripe_price_id = 'price_other' where id = $1",
          [id]
        )
      ).rejects.toThrow(/immutable/)
    })

    it("reads plan limits and the scheduled plan into access", async () => {
      const current = await insertPlan({
        code: "team",
        stripe_price_id: "price_team1",
        location_limit: 10,
        member_limit: 4,
      })
      const pending = await insertPlan({
        code: "solo",
        stripe_price_id: "price_solo1",
        location_limit: 3,
      })
      await db.query(
        `update organisation_billing set
           state = 'active', plan_id = $2, pending_plan_id = $3,
           pending_effective_at = now() + interval '20 days',
           stripe_customer_id = 'cus_A1', stripe_subscription_id = 'sub_A1',
           environment = 'test', first_payment_succeeded = true,
           current_period_start = now() - interval '10 days',
           current_period_end = now() + interval '20 days'
         where organisation_id = $1`,
        [ORG_A, current, pending]
      )
      const view = await getOrganisationBilling(sql, ORG_A)
      expect(view.plan).toEqual({ locationLimit: 10, memberLimit: 4 })
      expect(view.pendingPlan).toEqual({ locationLimit: 3, memberLimit: null })
      expect(view.billing?.currentPeriodEnd).toBeInstanceOf(Date)
      expect(await getOrganisationAccess(sql, ORG_A)).toMatchObject({
        mode: "full",
        reason: "active",
        locationLimit: 10,
        pendingLocationLimit: 3,
        newLinkLimit: 3,
        memberLimit: 4,
      })
    })

    it("rejects billing states that are not internally consistent", async () => {
      const bad = [
        // A subscription state without its subscription.
        "update organisation_billing set state = 'active' where organisation_id = $1",
        // A pilot cannot hold a subscription.
        "update organisation_billing set stripe_subscription_id = 'sub_B1' where organisation_id = $1",
        // A pending plan needs its effective date.
        `update organisation_billing set pending_plan_id = (select id from billing_plan limit 1)
         where organisation_id = $1`,
        "update organisation_billing set state = 'frozen' where organisation_id = $1",
        "update organisation_billing set stripe_customer_id = 'acct_1' where organisation_id = $1",
        // An active subscription says when its period ends.
        `update organisation_billing set
           state = 'active', plan_id = (select id from billing_plan limit 1),
           stripe_customer_id = 'cus_B2', stripe_subscription_id = 'sub_B2',
           environment = 'test', current_period_end = null
         where organisation_id = $1`,
        // A failed renewal records when its grace ends.
        `update organisation_billing set
           state = 'past_due', plan_id = (select id from billing_plan limit 1),
           stripe_customer_id = 'cus_B3', stripe_subscription_id = 'sub_B3',
           environment = 'test', first_payment_succeeded = true,
           current_period_start = now(),
           current_period_end = now() + interval '30 days',
           grace_ends_at = null
         where organisation_id = $1`,
      ]
      for (const statement of bad) {
        await expect(db.query(statement, [ORG_B])).rejects.toThrow()
      }
    })

    it("accepts paid states once their period and grace ends are recorded", async () => {
      // Positive controls for the period-end and grace-end checks, so the
      // rejections above fail for those checks and not something else.
      const good = [
        `update organisation_billing set
           state = 'active', plan_id = (select id from billing_plan limit 1),
           stripe_customer_id = 'cus_B2', stripe_subscription_id = 'sub_B2',
           environment = 'test',
           current_period_end = now() + interval '30 days'
         where organisation_id = $1`,
        `update organisation_billing set
           state = 'past_due', plan_id = (select id from billing_plan limit 1),
           stripe_customer_id = 'cus_B3', stripe_subscription_id = 'sub_B3',
           environment = 'test', first_payment_succeeded = true,
           current_period_start = now(),
           current_period_end = now() + interval '30 days',
           grace_ends_at = now() + interval '7 days'
         where organisation_id = $1`,
        // A failed first payment has no grace, so it records none.
        `update organisation_billing set
           state = 'past_due', plan_id = (select id from billing_plan limit 1),
           stripe_customer_id = 'cus_B4', stripe_subscription_id = 'sub_B4',
           environment = 'test', first_payment_succeeded = false,
           grace_ends_at = null
         where organisation_id = $1`,
      ]
      for (const statement of good) {
        await db.exec("begin")
        try {
          const result = await db.query(statement, [ORG_B])
          expect(result.affectedRows).toBe(1)
        } finally {
          await db.exec("rollback")
        }
      }
    })

    it("grants each period once per source and kind", async () => {
      const insert = (org: string, kind: string, ref: string) =>
        db.query<{ id: string }>(
          `insert into ai_credit_period
             (organisation_id, kind, starts_at, ends_at, allowance, source_ref)
           values ($1, $2, '2026-10-01', '2026-11-01', null, $3)
           returning id::text as id`,
          [org, kind, ref]
        )
      const first = await insert(ORG_A, "paid_period", "in_1")
      await expect(insert(ORG_A, "paid_period", "in_1")).rejects.toThrow()
      await insert(ORG_B, "paid_period", "in_1")
      await insert(ORG_A, "adjustment", "in_1")
      await expect(
        db.query(
          `insert into ai_credit_period
             (organisation_id, kind, starts_at, ends_at, source_ref)
           values ($1, 'trial', '2026-10-02', '2026-10-01', 'x')`,
          [ORG_A]
        )
      ).rejects.toThrow()
      const allowance = await db.query<{ allowance: number | null }>(
        "select allowance from ai_credit_period where id = $1",
        [first.rows[0].id]
      )
      // Unknown stays unknown.
      expect(allowance.rows[0].allowance).toBeNull()
    })

    it("links usage only to a period of its own organisation", async () => {
      const [periodA] = (
        await db.query<{ id: string }>(
          `insert into ai_credit_period
             (organisation_id, kind, starts_at, ends_at, allowance, source_ref)
           values ($1, 'trial', '2026-10-01', '2026-10-15', 10, 'sub_link')
           returning id::text as id`,
          [ORG_A]
        )
      ).rows
      await expect(
        db.query(
          `insert into ai_usage
             (organisation_id, kind, status, model, period_start, credit_period_id)
           values ($1, 'draft', 'reserved', 'm', '2026-10-01', $2)`,
          [ORG_B, periodA.id]
        )
      ).rejects.toThrow()
      const [usage] = (
        await db.query<{ id: string }>(
          `insert into ai_usage
             (organisation_id, kind, status, model, period_start, credit_period_id)
           values ($1, 'draft', 'reserved', 'm', '2026-10-01', $2)
           returning id::text as id`,
          [ORG_A, periodA.id]
        )
      ).rows
      // Deleting the period (retention) clears the link, not the usage.
      await db.query("delete from ai_credit_period where id = $1", [periodA.id])
      const after = await db.query<{
        organisationId: string
        periodId: string | null
      }>(
        `select organisation_id::text as "organisationId",
                credit_period_id::text as "periodId"
         from ai_usage where id = $1`,
        [usage.id]
      )
      expect(after.rows).toEqual([{ organisationId: ORG_A, periodId: null }])
    })
  })
})

const integrity = read("0109_billing_integrity.sql")

describe("0109 billing integrity migration", () => {
  const ORG_OLD = "00000000-0000-4000-8000-0000000000a1"
  const ORG_GAP = "00000000-0000-4000-8000-0000000000a2"
  const ORG_LATER = "00000000-0000-4000-8000-0000000000a3"
  const ORG_AGENCY = "00000000-0000-4000-8000-0000000000a4"
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role naba_app_runtime;
      create table schema_migration (version text primary key);
      create table organisation (
        id uuid primary key,
        workspace_mode text not null default 'business'
      );
      create table app_user (id uuid primary key);
      insert into organisation (id) values ('${ORG_OLD}');
    `)
    await db.exec(aiCredits)
    await db.exec(migration)
    await db.exec(periodChecks)
    // Created by the previous app release after 0107 ran: no billing row.
    await db.exec(`insert into organisation (id) values ('${ORG_GAP}');`)
    await db.exec(integrity)
  })

  afterAll(async () => {
    await db.close()
  })

  const states = async () =>
    (
      await db.query<{ id: string; state: string }>(
        "select organisation_id::text as id, state from organisation_billing order by 1"
      )
    ).rows

  it("is listed in the manifest and fails fast on locks", () => {
    expect(REQUIRED_MIGRATIONS).toContain("0109_billing_integrity")
    expect(integrity).toMatch(/set local lock_timeout = '\d+s'/)
  })

  it("backfills an organisation created after 0107 without a row", async () => {
    expect(await states()).toEqual([
      { id: ORG_OLD, state: "pilot" },
      { id: ORG_GAP, state: "pilot" },
    ])
  })

  it("gives every new organisation a pilot row, whoever creates it", async () => {
    await db.exec(`
      insert into organisation (id, workspace_mode)
      values ('${ORG_LATER}', 'business'), ('${ORG_AGENCY}', 'agency');
    `)
    // Provisioning's own seed stays a harmless no-op.
    await db.query(
      `insert into organisation_billing (organisation_id, state)
       values ($1, 'pilot') on conflict (organisation_id) do nothing`,
      [ORG_LATER]
    )
    expect(await states()).toEqual([
      { id: ORG_OLD, state: "pilot" },
      { id: ORG_GAP, state: "pilot" },
      { id: ORG_LATER, state: "pilot" },
      { id: ORG_AGENCY, state: "pilot" },
    ])
  })

  async function plan(code: string, environment: string, mode: string) {
    const result = await db.query<{ id: string }>(
      `insert into billing_plan
         (code, version, workspace_mode, environment, name, location_limit,
          ai_draft_credits_per_period, is_test_offer, stripe_price_id)
       values ($1, 1, $3, $2, $1, 5, 100, $2 = 'test', $4)
       returning id::text as id`,
      [code, environment, mode, `price_${code.replace(/_/g, "")}`]
    )
    return result.rows[0].id
  }

  const subscribe = (
    org: string,
    planId: string,
    environment: string,
    extra = ""
  ) =>
    db.query(
      `update organisation_billing set
         state = 'active', plan_id = $2, environment = $3,
         stripe_customer_id = 'cus_' || substr(md5($1::text), 1, 8),
         stripe_subscription_id = 'sub_' || substr(md5($1::text), 1, 8),
         first_payment_succeeded = true,
         current_period_end = now() + interval '30 days'${extra}
       where organisation_id = $1`,
      [org, planId, environment]
    )

  it("ties a subscription's plans to its environment and workspace mode", async () => {
    const liveBusiness = await plan("live_business", "live", "business")
    const testBusiness = await plan("test_business", "test", "business")
    const liveAgency = await plan("live_agency", "live", "agency")

    // A live subscription cannot name a test-environment (test offer) plan.
    await expect(subscribe(ORG_OLD, testBusiness, "live")).rejects.toThrow(
      /billing_plan_environment_mismatch/
    )
    // Nor a plan for the other workspace mode.
    await expect(subscribe(ORG_OLD, liveAgency, "live")).rejects.toThrow(
      /billing_plan_workspace_mode_mismatch/
    )
    // The scheduled plan is held to the same rules.
    await expect(
      subscribe(
        ORG_OLD,
        liveBusiness,
        "live",
        `, pending_plan_id = '${testBusiness}',
           pending_effective_at = now() + interval '30 days'`
      )
    ).rejects.toThrow(/billing_plan_environment_mismatch/)

    // Positive controls.
    expect((await subscribe(ORG_OLD, liveBusiness, "live")).affectedRows).toBe(1)
    expect((await subscribe(ORG_GAP, testBusiness, "test")).affectedRows).toBe(1)
    expect((await subscribe(ORG_AGENCY, liveAgency, "live")).affectedRows).toBe(1)

    // Changing only the environment under a subscription is refused too.
    await expect(
      db.query(
        "update organisation_billing set environment = 'test' where organisation_id = $1",
        [ORG_OLD]
      )
    ).rejects.toThrow(/billing_plan_environment_mismatch/)

    // An ended subscription keeps its history after a mode switch.
    await db.query(
      "update organisation_billing set state = 'canceled' where organisation_id = $1",
      [ORG_AGENCY]
    )
    await db.query(
      "update organisation set workspace_mode = 'business' where id = $1",
      [ORG_AGENCY]
    )
    const touched = await db.query(
      "update organisation_billing set state = 'read_only' where organisation_id = $1",
      [ORG_AGENCY]
    )
    expect(touched.affectedRows).toBe(1)
  })
})
