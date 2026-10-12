import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

vi.mock("server-only", () => ({}))

const env = {
  AI_MONTHLY_DRAFT_CREDITS: 2,
  AI_MONTHLY_TOKEN_BACKSTOP: 1_000_000,
  AI_MAX_OUTPUT_TOKENS: 100,
}
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))
const writeAudit = vi.fn()
vi.mock("@/lib/server/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
}))

import { aiCreditAdjustmentInputSchema } from "@/lib/contracts/ai-credits"
import {
  grantCreditAdjustment,
  listCreditAdjustments,
} from "@/lib/server/ai-credit-adjustments"
import { getAiCredits, reserveDraftCredit } from "@/lib/server/ai-credits"

/**
 * Operator AI credit adjustments (plan P07-S7, migration 0228) against the
 * real migrations in PGlite. The route itself is covered by
 * tests/integration/routes/ai-credit-adjustments.test.ts.
 */

const migration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")
const ORG = "00000000-0000-4000-8000-00000000000a"
const OTHER = "00000000-0000-4000-8000-00000000000b"

const grant = (overrides: Record<string, unknown> = {}) =>
  aiCreditAdjustmentInputSchema.parse({
    credits: 5,
    reason: "Goodwill after the 3 October outage",
    operator: "support@example.test",
    reference: "ZD-1001",
    ...overrides,
  })

describe("AI credit adjustments", () => {
  let db: PGlite
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0]
    values.forEach((_v, i) => {
      text += "$" + (i + 1) + strings[i + 1]
    })
    return (await db.query(text, values)).rows
  }) as never

  const reserve = (n: number) =>
    reserveDraftCredit(sql, {
      organisationId: ORG,
      model: "m",
      reviewId: "00000000-0000-4000-8000-0000000000b1",
      draftId: crypto.randomUUID(),
      generationKey: `req-${n}-${crypto.randomUUID()}`,
      userId: null,
    })

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(
      "create role naba_app_runtime;" +
        "create table schema_migration (version text primary key);" +
        "create table organisation (id uuid primary key);" +
        "create table app_user (id uuid primary key);" +
        "create table location_link (id uuid primary key default gen_random_uuid(), organisation_id uuid not null, location_id uuid not null, external_location_id uuid not null, is_active boolean not null default true);" +
        `insert into organisation (id) values ('${ORG}'), ('${OTHER}');`
    )
    await db.exec(migration("0059_ai_credits.sql"))
    await db.exec(migration("0220_billing_foundation.sql"))
    await db.exec(migration("0221_billing_period_checks.sql"))
    await db.exec(migration("0223_entitlement_enforcement.sql"))
    await db.exec(migration("0228_ai_credit_adjustments.sql"))
    await db.exec(`
      insert into billing_plan (
        code, version, workspace_mode, environment, name, stripe_price_id,
        location_limit, ai_draft_credits_per_period, is_test_offer, active
      )
      values ('starter', 1, 'business', 'test', 'Starter', 'price_test1', 3, 50, true, true);
    `)
  })
  afterAll(async () => {
    await db.close()
  })
  beforeEach(async () => {
    writeAudit.mockReset()
    await db.exec("delete from ai_usage;")
    await db.exec("delete from ai_credit_period;")
    await db.exec("update organisation set ai_monthly_draft_credits = null;")
    await db.exec(`
      delete from organisation_billing;
      insert into organisation_billing (organisation_id, state)
      values ('${ORG}', 'pilot'), ('${OTHER}', 'pilot');
    `)
    env.AI_MONTHLY_DRAFT_CREDITS = 2
  })

  const startTrial = async (allowance: number | null) => {
    await db.exec(`
      update organisation_billing
      set state = 'trialing',
          plan_id = (select id from billing_plan where code = 'starter'),
          stripe_customer_id = 'cus_test1',
          stripe_subscription_id = 'sub_test1',
          environment = 'test',
          trial_ends_at = now() + interval '14 days'
      where organisation_id = '${ORG}';
    `)
    const { rows } = await db.query<{ id: string }>(
      `insert into ai_credit_period (organisation_id, kind, starts_at, ends_at, allowance, source_ref)
       values ($1, 'trial', now() - interval '1 day', now() + interval '13 days', $2, 'sub_test1')
       returning id::text as id`,
      [ORG, allowance]
    )
    return rows[0].id
  }

  it("adds to the current period without resetting used credits", async () => {
    await reserve(1)
    await reserve(2)
    await expect(reserve(3)).rejects.toMatchObject({
      code: "ai_credits_exhausted",
    })
    const result = await grantCreditAdjustment(sql, ORG, grant(), {
      requestId: "req-1",
    })
    expect(result.replayed).toBe(false)
    const credits = await getAiCredits(sql, ORG)
    expect(credits).toMatchObject({
      used: 2,
      allowance: 7,
      remaining: 5,
      periodKind: "pilot_month",
    })
    expect(result.adjustment).toMatchObject({
      periodId: credits.periodId,
      periodKind: "pilot_month",
      credits: 5,
      reason: "Goodwill after the 3 October outage",
      operator: "support@example.test",
      reference: "ZD-1001",
      periodEnd: credits.periodEnd,
      current: true,
    })
    // The used credits are untouched and new work draws on the grant.
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from ai_usage where status = 'reserved'"
    )
    expect(rows[0].n).toBe(2)
    expect((await reserve(4)).kind).toBe("reserved")
    expect((await getAiCredits(sql, ORG)).used).toBe(3)
  })

  it("audits each grant with its operator and reason", async () => {
    const { adjustment } = await grantCreditAdjustment(sql, ORG, grant(), {
      requestId: "req-2",
    })
    expect(writeAudit).toHaveBeenCalledTimes(1)
    expect(writeAudit.mock.calls[0][1]).toEqual({
      organisationId: ORG,
      action: "ai_credits.adjustment_granted",
      subjectType: "ai_credit_period",
      subjectId: adjustment.id,
      requestId: "req-2",
      metadata: {
        periodId: adjustment.periodId,
        periodKind: "pilot_month",
        credits: 5,
        allowanceBefore: 2,
        usedBefore: 0,
        reason: "Goodwill after the 3 October outage",
        operator: "support@example.test",
        reference: "ZD-1001",
      },
    })
  })

  it("replays the same reference and refuses a different grant under it", async () => {
    const first = await grantCreditAdjustment(sql, ORG, grant(), {
      requestId: "a",
    })
    const again = await grantCreditAdjustment(sql, ORG, grant(), {
      requestId: "b",
    })
    expect(again).toEqual({ adjustment: first.adjustment, replayed: true })
    expect(writeAudit).toHaveBeenCalledTimes(1)
    await expect(
      grantCreditAdjustment(sql, ORG, grant({ credits: 50 }), {
        requestId: "c",
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "ai_credit_adjustment_conflict",
    })
    expect((await getAiCredits(sql, ORG)).allowance).toBe(7)
    // The same reference is independent per organisation.
    await grantCreditAdjustment(sql, OTHER, grant(), { requestId: "d" })
    expect((await getAiCredits(sql, OTHER)).allowance).toBe(7)
  })

  it("adds several grants and lists them newest first", async () => {
    await grantCreditAdjustment(sql, ORG, grant(), { requestId: "a" })
    await grantCreditAdjustment(
      sql,
      ORG,
      grant({ credits: 3, reference: "ZD-1002" }),
      { requestId: "b" }
    )
    const credits = await getAiCredits(sql, ORG)
    expect(credits.allowance).toBe(10)
    const history = await listCreditAdjustments(sql, ORG, credits.periodId)
    expect(history.map((h) => h.reference)).toEqual(["ZD-1002", "ZD-1001"])
    expect(history.every((h) => h.current)).toBe(true)
  })

  it("adds to a trial grant and ends with it", async () => {
    const trialId = await startTrial(50)
    await grantCreditAdjustment(sql, ORG, grant({ credits: 10 }), {
      requestId: "a",
    })
    expect(await getAiCredits(sql, ORG)).toMatchObject({
      periodId: trialId,
      allowance: 60,
    })
    // The next period starts from its own allowance.
    await db.exec(`
      update organisation_billing
      set state = 'active', current_period_end = now() + interval '30 days'
      where organisation_id = '${ORG}';
      insert into ai_credit_period (organisation_id, kind, starts_at, ends_at, allowance, source_ref)
      values ('${ORG}', 'paid_period', now() - interval '1 minute', now() + interval '30 days', 50, 'in_1');
    `)
    const paid = await getAiCredits(sql, ORG)
    expect(paid).toMatchObject({ periodKind: "paid_period", allowance: 50 })
    const history = await listCreditAdjustments(sql, ORG, paid.periodId)
    expect(history).toEqual([
      expect.objectContaining({ periodId: trialId, current: false }),
    ])
  })

  it("fails closed with an unknown allowance or no current period", async () => {
    await startTrial(null)
    await expect(
      grantCreditAdjustment(sql, ORG, grant(), { requestId: "a" })
    ).rejects.toMatchObject({ status: 409, code: "ai_allowance_unknown" })
    await db.exec("delete from ai_credit_period;")
    await expect(
      grantCreditAdjustment(sql, ORG, grant(), { requestId: "b" })
    ).rejects.toMatchObject({ status: 409, code: "ai_credit_period_missing" })
    const { rows } = await db.query(
      "select 1 from ai_credit_period where kind = 'adjustment'"
    )
    expect(rows).toEqual([])
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("keeps an adjustment's shape in the database", async () => {
    const credits = await getAiCredits(sql, ORG)
    const base = credits.periodId
    const insert = (
      columns: Record<string, unknown>,
      sourceRef = crypto.randomUUID()
    ) =>
      db.query(
        `insert into ai_credit_period (
           organisation_id, kind, starts_at, ends_at, allowance, source_ref,
           applies_to_period_id, reason, granted_by
         )
         values ($1, $2, now(), now() + interval '1 day', $3, $4, $5, $6, $7)`,
        [
          columns.organisation ?? ORG,
          columns.kind ?? "adjustment",
          columns.allowance ?? 1,
          sourceRef,
          columns.target === undefined ? base : columns.target,
          columns.reason === undefined
            ? "A long enough reason"
            : columns.reason,
          columns.operator === undefined ? "ops" : columns.operator,
        ]
      )
    // Missing target, reason or operator; no credits.
    await expect(insert({ target: null })).rejects.toThrow(/adjustment_shape/)
    await expect(insert({ reason: null })).rejects.toThrow(/adjustment_shape/)
    await expect(insert({ operator: null })).rejects.toThrow(/adjustment_shape/)
    await expect(insert({ allowance: 0 })).rejects.toThrow(/adjustment_shape/)
    // A base period never carries adjustment columns.
    await expect(insert({ kind: "trial" })).rejects.toThrow(/adjustment_shape/)
    // Another organisation's period is not a target.
    await expect(insert({ organisation: OTHER })).rejects.toThrow(
      /applies_to_fkey/
    )
    // An adjustment cannot name another adjustment.
    await insert({}, "adjustment:base")
    const { rows } = await db.query<{ id: string }>(
      "select id::text as id from ai_credit_period where source_ref = 'adjustment:base'"
    )
    await expect(insert({ target: rows[0].id })).rejects.toThrow(
      /ai_credit_adjustment_target_invalid/
    )
    // Deleting the base period removes its adjustments with it.
    await db.query("delete from ai_credit_period where id = $1", [base])
    const { rows: left } = await db.query(
      "select 1 from ai_credit_period where kind = 'adjustment'"
    )
    expect(left).toEqual([])
  })

  it("validates the operator input", () => {
    const parse = (overrides: Record<string, unknown>) =>
      aiCreditAdjustmentInputSchema.safeParse({
        credits: 5,
        reason: "Goodwill after the outage",
        operator: "support@example.test",
        reference: "ZD-1001",
        ...overrides,
      }).success
    expect(parse({})).toBe(true)
    expect(parse({ credits: 0 })).toBe(false)
    expect(parse({ credits: -5 })).toBe(false)
    expect(parse({ credits: 100_001 })).toBe(false)
    expect(parse({ reason: "short" })).toBe(false)
    expect(parse({ operator: " " })).toBe(false)
    expect(parse({ reference: "has space" })).toBe(false)
    expect(parse({ reference: undefined })).toBe(false)
  })
})
