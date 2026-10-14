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

import {
  callTokenBudget,
  getAiCredits,
  getAiCreditsDaily,
  releaseDraftCredit,
  releaseStaleReservations,
  reserveDraftCredit,
  settleDraftCredit,
  type DraftReservation,
} from "@/lib/server/ai-credits"

const migration = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")
const ORG = "00000000-0000-4000-8000-00000000000a"
const REVIEW = "00000000-0000-4000-8000-0000000000b1"

const reservedId = (reservation: DraftReservation): string => {
  if (reservation.kind !== "reserved") throw new Error("not reserved")
  return reservation.id
}

describe("AI credit periods and reservations", () => {
  let db: PGlite
  // Adapt the postgres.js tagged template to PGlite (rows array result).
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0]
    values.forEach((_v, i) => {
      text += "$" + (i + 1) + strings[i + 1]
    })
    return (await db.query(text, values)).rows
  }) as never
  const tenant = (async (fn: (s: never) => unknown) => fn(sql)) as never
  const reserveWith = (generationKey: string) =>
    reserveDraftCredit(sql, {
      organisationId: ORG,
      model: "m",
      reviewId: REVIEW,
      draftId: crypto.randomUUID(),
      generationKey,
      userId: null,
    })
  const reserve = async (n: number) =>
    reservedId(await reserveWith(`req-${n}-${crypto.randomUUID()}`))
  const periods = async () =>
    (
      await db.query<{ id: string; kind: string; source_ref: string }>(
        "select id::text as id, kind, source_ref from ai_credit_period order by created_at"
      )
    ).rows

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(
      "create role naba_app_runtime;" +
        "create table schema_migration (version text primary key);" +
        "create table organisation (id uuid primary key);" +
        "create table app_user (id uuid primary key);" +
        "create table location_link (id uuid primary key default gen_random_uuid(), organisation_id uuid not null, location_id uuid not null, external_location_id uuid not null, is_active boolean not null default true);" +
        "insert into organisation (id) values ('" +
        ORG +
        "');"
    )
    await db.exec(migration("0059_ai_credits.sql"))
    await db.exec(migration("0107_billing_foundation.sql"))
    await db.exec(migration("0108_billing_period_checks.sql"))
    await db.exec(migration("0110_entitlement_enforcement.sql"))
    await db.exec(migration("0115_ai_credit_adjustments.sql"))
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
    await db.exec("delete from ai_usage;")
    await db.exec("delete from ai_credit_period;")
    await db.exec("update organisation set ai_monthly_draft_credits = null;")
    await db.exec(`
      delete from organisation_billing;
      insert into organisation_billing (organisation_id, state) values ('${ORG}', 'pilot');
    `)
    env.AI_MONTHLY_DRAFT_CREDITS = 2
    env.AI_MONTHLY_TOKEN_BACKSTOP = 1_000_000
    env.AI_MAX_OUTPUT_TOKENS = 100
  })

  const startTrial = async (allowance: number | null | "none") => {
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
    if (allowance !== "none") {
      await db.query(
        `insert into ai_credit_period (organisation_id, kind, starts_at, ends_at, allowance, source_ref)
         values ($1, 'trial', now() - interval '1 day', now() + interval '13 days', $2, 'sub_test1')`,
        [ORG, allowance]
      )
    }
  }

  it("creates one pilot month lazily and stamps reservations with it", async () => {
    const first = await reserve(1)
    const second = await reserve(2)
    const rows = await periods()
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe("pilot_month")
    expect(rows[0].source_ref).toMatch(/^pilot:\d{4}-\d{2}$/)
    const { rows: usage } = await db.query<{ id: string; period: string }>(
      "select id::text as id, credit_period_id::text as period from ai_usage"
    )
    expect(usage.map((u) => u.id).sort()).toEqual([first, second].sort())
    expect(usage.every((u) => u.period === rows[0].id)).toBe(true)
    const credits = await getAiCredits(sql, ORG)
    expect(credits).toMatchObject({
      used: 2,
      allowance: 2,
      remaining: 0,
      periodId: rows[0].id,
      periodKind: "pilot_month",
      canUseAi: true,
      accessReason: "pilot",
    })
  })

  it("reserves, settles and counts credits", async () => {
    const id = await reserve(1)
    expect((await getAiCredits(sql, ORG)).used).toBe(1)
    await settleDraftCredit(sql, {
      id,
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "gpt",
      draftId: "00000000-0000-4000-8000-0000000000d1",
    })
    const { rows } = await db.query(
      "select status, credits, input_tokens, output_tokens, model from ai_usage"
    )
    expect(rows).toEqual([
      {
        status: "settled",
        credits: 1,
        input_tokens: 10,
        output_tokens: 5,
        model: "gpt",
      },
    ])
    const credits = await getAiCredits(sql, ORG)
    expect(credits).toMatchObject({ used: 1, allowance: 2, remaining: 1 })
  })

  it("charges one credit for the same generation id sent twice", async () => {
    const first = await reserveWith("intent:same")
    const again = await reserveWith("intent:same")
    expect(first.kind).toBe("reserved")
    expect(again).toEqual({
      kind: "existing",
      generation: {
        id: reservedId(first),
        status: "reserved",
        reviewId: REVIEW,
        draftId: expect.any(String),
      },
    })
    expect((await getAiCredits(sql, ORG)).used).toBe(1)
    // Even with the allowance spent, the retry finds its generation.
    await reserve(2)
    const settled = await reserveWith("intent:same")
    expect(settled.kind).toBe("existing")
  })

  it("answers 402 ai_credits_exhausted with the period end once the allowance is spent", async () => {
    await reserve(1)
    await reserve(2)
    const { endsAt } = (
      await db.query<{ endsAt: Date }>(
        `select ends_at as "endsAt" from ai_credit_period`
      )
    ).rows[0]
    await expect(reserve(3)).rejects.toMatchObject({
      status: 402,
      code: "ai_credits_exhausted",
      details: {
        used: 2,
        allowance: 2,
        resetsAt: new Date(endsAt).toISOString(),
      },
    })
    expect(
      (await db.query("select count(*)::int as n from ai_usage")).rows
    ).toEqual([{ n: 2 }])
  })

  it("takes the period end from the row, not the application clock", async () => {
    // A pilot month whose row ends three hours from the database's now:
    // whatever the app server's clock says, this is the period and its end.
    const { rows } = await db.query<{ id: string; endsAt: Date }>(
      `insert into ai_credit_period (organisation_id, kind, starts_at, ends_at, allowance, source_ref)
       values ($1, 'pilot_month', now() - interval '1 hour', now() + interval '3 hours', 5, 'pilot:clock')
       returning id::text as id, ends_at as "endsAt"`,
      [ORG]
    )
    const credits = await getAiCredits(sql, ORG)
    expect(credits.periodId).toBe(rows[0].id)
    expect(credits.periodEnd).toBe(new Date(rows[0].endsAt).toISOString())
    expect(await periods()).toHaveLength(1)
  })

  it("settles a reservation in its original period after the period rolls over", async () => {
    const id = await reserve(1)
    const [original] = await periods()
    // Roll over: the reserved period now lies in the past, so the next read
    // opens a new pilot month.
    await db.exec(`
      update ai_credit_period
      set starts_at = starts_at - interval '2 months',
          ends_at = starts_at - interval '1 month',
          source_ref = 'pilot:past'
    `)
    const next = await getAiCredits(sql, ORG)
    expect(next.periodId).not.toBe(original.id)
    await settleDraftCredit(sql, {
      id,
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "gpt",
      draftId: "00000000-0000-4000-8000-0000000000d1",
    })
    const { rows } = await db.query<{ period: string; status: string }>(
      "select credit_period_id::text as period, status from ai_usage"
    )
    expect(rows).toEqual([{ period: original.id, status: "settled" }])
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
  })

  it("refuses AI work with 402 billing_read_only when billing is read-only", async () => {
    await db.exec(
      `update organisation_billing set state = 'read_only' where organisation_id = '${ORG}'`
    )
    await expect(reserve(1)).rejects.toMatchObject({
      status: 402,
      code: "billing_read_only",
      details: { reason: "read_only" },
    })
    const credits = await getAiCredits(sql, ORG)
    expect(credits).toMatchObject({
      canUseAi: false,
      accessReason: "read_only",
    })
  })

  it("treats a missing billing record as read-only", async () => {
    await db.exec("delete from organisation_billing")
    await expect(reserve(1)).rejects.toMatchObject({
      status: 402,
      code: "billing_read_only",
    })
    expect(await getAiCredits(sql, ORG)).toMatchObject({
      allowance: null,
      remaining: null,
      periodId: null,
      canUseAi: false,
      accessReason: "billing_missing",
    })
  })

  it("reports a trial with no granted period as unknown and refuses AI drafting", async () => {
    await startTrial("none")
    expect(await getAiCredits(sql, ORG)).toMatchObject({
      allowance: null,
      remaining: null,
      periodId: null,
      periodEnd: null,
      canUseAi: true,
    })
    await expect(reserve(1)).rejects.toMatchObject({
      status: 402,
      code: "ai_allowance_unknown",
    })
    // No pilot month is invented for a trial.
    expect(await periods()).toEqual([])
  })

  it("keeps a null trial allowance unknown, and spends a known one", async () => {
    await startTrial(null)
    expect((await getAiCredits(sql, ORG)).allowance).toBeNull()
    await expect(reserve(1)).rejects.toMatchObject({
      code: "ai_allowance_unknown",
    })
    await db.exec("update ai_credit_period set allowance = 1")
    // The ledger only ever inserts periods; the update above stands in for a
    // second grant row the billing processor would write.
    await reserve(2)
    await expect(reserve(3)).rejects.toMatchObject({
      code: "ai_credits_exhausted",
    })
    expect(await getAiCredits(sql, ORG)).toMatchObject({
      used: 1,
      allowance: 1,
      remaining: 0,
      periodKind: "trial",
    })
  })

  it("does not count pilot-era rows toward a trial", async () => {
    await db.exec(
      `insert into ai_usage (organisation_id, kind, status, credits, model, period_start)
       values ('${ORG}', 'draft', 'settled', 1, 'm',
         (date_trunc('month', now() at time zone 'utc'))::date)`
    )
    expect((await getAiCredits(sql, ORG)).used).toBe(1)
    await startTrial(5)
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
  })

  it("gives the credit back when the provider call fails", async () => {
    const id = await reserve(1)
    await releaseDraftCredit(tenant, { id })
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
    await reserve(2)
    await reserve(3)
  })

  it("keeps tokens of a billed but unreadable response on the released row", async () => {
    const id = await reserve(1)
    await releaseDraftCredit(tenant, {
      id,
      usage: { inputTokens: 400_000, outputTokens: 600_000 },
    })
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
    await expect(reserve(2)).rejects.toMatchObject({
      status: 429,
      code: "ai_token_backstop",
    })
  })

  it("holds each in-flight call's token budget against the backstop", async () => {
    env.AI_MONTHLY_DRAFT_CREDITS = 10
    env.AI_MONTHLY_TOKEN_BACKSTOP = callTokenBudget() * 2
    await reserve(1)
    await reserve(2)
    // Nothing is settled yet, but two calls already hold the whole budget.
    await expect(reserve(3)).rejects.toMatchObject({
      status: 429,
      code: "ai_token_backstop",
    })
  })

  it("counts legacy rows of this pilot month but not of another month", async () => {
    await db.exec(
      `insert into ai_usage (organisation_id, kind, status, credits, model, period_start,
         input_tokens, output_tokens)
       values ('${ORG}', 'draft', 'settled', 1, 'm', '2020-01-01', 500000, 500000),
              ('${ORG}', 'draft', 'settled', 1, 'm', '2020-01-01', 1, 1),
              ('${ORG}', 'draft', 'settled', 1, 'm',
                (date_trunc('month', now() at time zone 'utc'))::date, 1, 1)`
    )
    expect((await getAiCredits(sql, ORG)).used).toBe(1)
    await reserve(1)
    await expect(reserve(2)).rejects.toMatchObject({ status: 402 })
  })

  it("prefers the organisation override over the env default, live", async () => {
    await db.exec(
      `update organisation set ai_monthly_draft_credits = 1 where id = '${ORG}'`
    )
    expect((await getAiCredits(sql, ORG)).allowance).toBe(1)
    await reserve(1)
    await expect(reserve(2)).rejects.toMatchObject({ status: 402 })
    await db.exec(
      `update organisation set ai_monthly_draft_credits = 0 where id = '${ORG}'`
    )
    expect((await getAiCredits(sql, ORG)).allowance).toBe(0)
  })

  it("verify rows cost no credits but count toward the backstop", async () => {
    await reserve(1)
    const [period] = await periods()
    await db.query(
      `insert into ai_usage (organisation_id, kind, status, credits, model, period_start,
         input_tokens, output_tokens, credit_period_id)
       values ($1, 'verify', 'settled', 0, 'm',
         (date_trunc('month', now() at time zone 'utc'))::date, 600000, 400000, $2)`,
      [ORG, period.id]
    )
    expect((await getAiCredits(sql, ORG)).used).toBe(1)
    await expect(reserve(2)).rejects.toMatchObject({
      code: "ai_token_backstop",
    })
  })

  it("settles a row the reaper already released and counts it again", async () => {
    const id = await reserve(1)
    await db.exec(
      `update ai_usage set status = 'released', credits = 0 where id = '${id}'`
    )
    await settleDraftCredit(sql, {
      id,
      usage: { inputTokens: 3, outputTokens: 4 },
      model: "gpt",
      draftId: "00000000-0000-4000-8000-0000000000d1",
    })
    const { rows } = await db.query(
      "select status, credits, input_tokens from ai_usage"
    )
    expect(rows).toEqual([{ status: "settled", credits: 1, input_tokens: 3 }])
  })

  it("keeps tokens when releasing a row the reaper already released", async () => {
    const id = await reserve(1)
    await db.exec(
      `update ai_usage set status = 'released', credits = 0 where id = '${id}'`
    )
    await releaseDraftCredit(tenant, {
      id,
      usage: { inputTokens: 7, outputTokens: 8 },
    })
    const { rows } = await db.query(
      "select status, credits, input_tokens, output_tokens from ai_usage"
    )
    expect(rows).toEqual([
      { status: "released", credits: 0, input_tokens: 7, output_tokens: 8 },
    ])
  })

  it("retries a transient ledger failure", async () => {
    const id = await reserve(1)
    let calls = 0
    const flaky = (async (fn: (s: never) => unknown) => {
      calls += 1
      if (calls === 1) throw new Error("connection reset")
      return fn(sql)
    }) as never
    await releaseDraftCredit(flaky, { id })
    expect(calls).toBe(2)
    const { rows } = await db.query("select status, credits from ai_usage")
    expect(rows).toEqual([{ status: "released", credits: 0 }])
  })

  it("lists the period's days for the chart", async () => {
    await reserve(1)
    const { days } = await getAiCreditsDaily(sql, ORG)
    expect(days[0].date).toMatch(/-01$/)
    expect(days.reduce((sum, day) => sum + day.credits, 0)).toBe(1)
  })

  it("the reaper releases only stale reservations", async () => {
    const stale = await reserve(1)
    const fresh = await reserve(2)
    await db.exec(
      `update ai_usage set created_at = now() - interval '11 minutes' where id = '${stale}'`
    )
    expect(await releaseStaleReservations(sql)).toBe(1)
    const { rows } = await db.query(
      "select id::text as id, status, credits from ai_usage order by created_at"
    )
    const byId = rows as { id: string; status: string; credits: number }[]
    expect(byId.find((r) => r.id === stale)).toMatchObject({
      status: "released",
      credits: 0,
    })
    expect(byId.find((r) => r.id === fresh)).toMatchObject({
      status: "reserved",
      credits: 1,
    })
  })
})
