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
  AI_MONTHLY_DRAFT_CREDITS: 5,
  AI_MONTHLY_TOKEN_BACKSTOP: 1_000_000,
  AI_MAX_OUTPUT_TOKENS: 100,
}
vi.mock("@/lib/server/env", () => ({ getServerEnv: () => env }))

import { extractUsage } from "@/lib/server/ai"
import { callTokenBudget, getAiCredits } from "@/lib/server/ai-credits"
import { finishVerifyUsage, reserveVerifyUsage } from "@/lib/server/ai-usage"

const read = (name: string) =>
  readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8")
const migration = read("0059_ai_credits.sql")
const ORG = "00000000-0000-4000-8000-00000000000a"

describe("extractUsage", () => {
  it("reads Responses API token counts", () => {
    expect(
      extractUsage({ usage: { input_tokens: 120, output_tokens: 33 } })
    ).toEqual({ inputTokens: 120, outputTokens: 33 })
  })
  it("reads Workers AI chat completions token counts", () => {
    expect(
      extractUsage({ usage: { prompt_tokens: 120, completion_tokens: 33 } })
    ).toEqual({ inputTokens: 120, outputTokens: 33 })
  })
  it("returns nulls when usage is missing or malformed", () => {
    expect(extractUsage({})).toEqual({ inputTokens: null, outputTokens: null })
    expect(
      extractUsage({ usage: { input_tokens: "x", output_tokens: -1 } })
    ).toEqual({ inputTokens: null, outputTokens: null })
  })
})

describe("verification usage", () => {
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
  const reserve = (requestKey = `req-${crypto.randomUUID()}:verification`) =>
    reserveVerifyUsage(sql, {
      organisationId: ORG,
      model: "m",
      reviewId: null,
      draftId: null,
      requestKey,
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
        "insert into organisation (id) values ('" +
        ORG +
        "');"
    )
    await db.exec(migration)
    await db.exec(read("0220_billing_foundation.sql"))
    await db.exec(read("0221_billing_period_checks.sql"))
    await db.exec(read("0223_entitlement_enforcement.sql"))
  })
  afterAll(async () => {
    await db.close()
  })
  beforeEach(async () => {
    await db.exec("delete from ai_usage; delete from ai_credit_period;")
    await db.exec(`
      delete from organisation_billing;
      insert into organisation_billing (organisation_id, state) values ('${ORG}', 'pilot');
    `)
    env.AI_MONTHLY_TOKEN_BACKSTOP = 1_000_000
  })

  it("forces tenant isolation and adds the override column", () => {
    expect(migration).toContain("alter table ai_usage force row level security")
    expect(migration).toContain("ai_monthly_draft_credits integer")
  })

  it("links a verify row to the current period and settles it at no credit", async () => {
    const reservation = await reserve()
    expect(reservation).not.toBeNull()
    const { periodId } = await getAiCredits(sql, ORG)
    expect(reservation?.periodId).toBe(periodId)
    await finishVerifyUsage(tenant, {
      id: reservation!.id,
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "m2",
    })
    const { rows } = await db.query(`select kind, status, credits, input_tokens,
        model, credit_period_id::text as period, settled_at is not null as settled,
        period_start = date_trunc('month', now() at time zone 'utc')::date as month_ok
        from ai_usage`)
    expect(rows).toEqual([
      {
        kind: "verify",
        status: "settled",
        credits: 0,
        input_tokens: 10,
        model: "m2",
        period: periodId,
        settled: true,
        month_ok: true,
      },
    ])
    expect((await getAiCredits(sql, ORG)).used).toBe(0)
  })

  it("releases a reservation the provider returned no usage for", async () => {
    const reservation = await reserve()
    await finishVerifyUsage(tenant, { id: reservation!.id })
    const { rows } = await db.query("select status, credits from ai_usage")
    expect(rows).toEqual([{ status: "released", credits: 0 }])
  })

  it("reserves nothing for a repeated request key", async () => {
    expect(await reserve("same")).not.toBeNull()
    expect(await reserve("same")).toBeNull()
    const { rows } = await db.query("select count(*)::int as n from ai_usage")
    expect(rows).toEqual([{ n: 1 }])
  })

  it("refuses a call that could pass the backstop", async () => {
    env.AI_MONTHLY_TOKEN_BACKSTOP = callTokenBudget()
    expect(await reserve()).not.toBeNull()
    // The first call's budget is still held, so a second would pass it.
    expect(await reserve()).toBeNull()
  })

  it("records against no period when the organisation has none", async () => {
    await db.exec("delete from organisation_billing")
    const reservation = await reserve()
    expect(reservation).toEqual({ id: expect.any(String), periodId: null })
  })

  it("never throws when the ledger write fails", async () => {
    const failing = (async () => {
      throw new Error("relation ai_usage does not exist")
    }) as never
    await expect(
      finishVerifyUsage(failing, {
        id: crypto.randomUUID(),
        usage: { inputTokens: 1, outputTokens: 1 },
        model: "m",
      })
    ).resolves.toBeUndefined()
  })

  it("rejects an unknown kind", async () => {
    await expect(
      db.exec(
        "insert into ai_usage (organisation_id, kind, status, model, period_start) values ('" +
          ORG +
          "', 'other', 'settled', 'm', current_date)"
      )
    ).rejects.toThrow()
  })
})
