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

const env = { AI_MONTHLY_DRAFT_CREDITS: 2, AI_MONTHLY_TOKEN_BACKSTOP: 1000 }
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))

import {
  billingPeriod,
  getAiCredits,
  releaseDraftCredit,
  releaseStaleReservations,
  reserveDraftCredit,
  settleDraftCredit,
  tokenBackstopReached,
} from "@/lib/server/ai-credits"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0059_ai_credits.sql"),
  "utf8"
)
const ORG = "00000000-0000-4000-8000-00000000000a"

describe("billingPeriod", () => {
  it("is the UTC calendar month and resets on the 1st", () => {
    const p = billingPeriod(new Date("2026-10-31T23:59:59Z"))
    expect(p.periodStart).toBe("2026-10-01")
    expect(p.resetsAt.toISOString()).toBe("2026-11-01T00:00:00.000Z")
    expect(
      billingPeriod(new Date("2026-12-15T00:00:00Z")).resetsAt.toISOString()
    ).toBe("2027-01-01T00:00:00.000Z")
  })
})

describe("AI credit reservation", () => {
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
  const reserve = (n: number) =>
    reserveDraftCredit(sql, {
      organisationId: ORG,
      model: "m",
      reviewId: "00000000-0000-4000-8000-0000000000b1",
      draftId: crypto.randomUUID(),
      requestId: `req-${n}-${crypto.randomUUID()}`,
      userId: null,
    })

  beforeAll(async () => {
    db = new PGlite()
    await db.exec(
      "create role naba_app_runtime;" +
        "create table schema_migration (version text primary key);" +
        "create table organisation (id uuid primary key);" +
        "create table app_user (id uuid primary key);" +
        "insert into organisation (id) values ('" +
        ORG +
        "');"
    )
    await db.exec(migration)
  })
  afterAll(async () => {
    await db.close()
  })
  beforeEach(async () => {
    await db.exec("delete from ai_usage;")
    await db.exec("update organisation set ai_monthly_draft_credits = null;")
    env.AI_MONTHLY_DRAFT_CREDITS = 2
    env.AI_MONTHLY_TOKEN_BACKSTOP = 1000
  })

  it("reserves, settles and counts credits", async () => {
    const id = await reserve(1)
    expect((await getAiCredits(sql, ORG)).used).toBe(1)
    await settleDraftCredit(tenant, {
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

  it("answers 402 ai_credits_exhausted with details once the allowance is spent", async () => {
    await reserve(1)
    await reserve(2)
    await expect(reserve(3)).rejects.toMatchObject({
      status: 402,
      code: "ai_credits_exhausted",
      details: { used: 2, allowance: 2 },
    })
    expect(
      (await db.query("select count(*)::int as n from ai_usage")).rows
    ).toEqual([{ n: 2 }])
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
      usage: { inputTokens: 400, outputTokens: 700 },
    })
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
    expect(await tokenBackstopReached(sql, ORG)).toBe(true)
    await expect(reserve(2)).rejects.toMatchObject({
      status: 429,
      code: "ai_token_backstop",
    })
  })

  it("does not count rows from another period", async () => {
    await db.exec(
      `insert into ai_usage (organisation_id, kind, status, credits, model, period_start,
         input_tokens, output_tokens)
       values ('${ORG}', 'draft', 'settled', 1, 'm', '2020-01-01', 5000, 5000),
              ('${ORG}', 'draft', 'settled', 1, 'm', '2020-01-01', 1, 1)`
    )
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
    expect(await tokenBackstopReached(sql, ORG)).toBe(false)
    await reserve(1)
  })

  it("prefers the organisation override over the env default", async () => {
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
    await db.exec(
      `insert into ai_usage (organisation_id, kind, status, credits, model, period_start,
         input_tokens, output_tokens)
       values ('${ORG}', 'verify', 'settled', 0, 'm',
         (date_trunc('month', now() at time zone 'utc'))::date, 600, 500)`
    )
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
    expect(await tokenBackstopReached(sql, ORG)).toBe(true)
  })

  it("settles a row the reaper already released and counts it again", async () => {
    const id = await reserve(1)
    await db.exec(
      `update ai_usage set status = 'released', credits = 0 where id = '${id}'`
    )
    await settleDraftCredit(tenant, {
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

  it("the reaper releases only stale reservations", async () => {
    const stale = await reserve(1)
    const fresh = await reserve(2)
    await db.exec(
      `update ai_usage set created_at = now() - interval '11 minutes' where id = '${stale}'`
    )
    const database = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      let text = strings[0]
      values.forEach((_v, i) => {
        text += "$" + (i + 1) + strings[i + 1]
      })
      return (await db.query(text, values)).rows
    }) as never
    expect(await releaseStaleReservations(database)).toBe(1)
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
