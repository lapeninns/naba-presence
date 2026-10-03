import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { extractUsage } from "@/lib/server/ai"
import { recordAiUsage, recordAiUsageDetached } from "@/lib/server/ai-usage"

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0059_ai_credits.sql"),
  "utf8"
)
const ORG = "00000000-0000-4000-8000-00000000000a"

describe("extractUsage", () => {
  it("reads Responses API token counts", () => {
    expect(
      extractUsage({ usage: { input_tokens: 120, output_tokens: 33 } })
    ).toEqual({ inputTokens: 120, outputTokens: 33 })
  })
  it("returns nulls when usage is missing or malformed", () => {
    expect(extractUsage({})).toEqual({ inputTokens: null, outputTokens: null })
    expect(
      extractUsage({ usage: { input_tokens: "x", output_tokens: -1 } })
    ).toEqual({ inputTokens: null, outputTokens: null })
  })
})

describe("0059 ai_usage", () => {
  let db: PGlite
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

  it("forces tenant isolation and adds the override column", () => {
    expect(migration).toContain("alter table ai_usage force row level security")
    expect(migration).toContain("ai_monthly_draft_credits integer")
  })

  it("records a settled row for the UTC month", async () => {
    // Adapt the postgres.js tagged template to PGlite.
    const sql = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      let text = strings[0]
      values.forEach((_v, i) => {
        text += "$" + (i + 1) + strings[i + 1]
      })
      return db.query(text, values)
    }) as never
    await recordAiUsage(sql, {
      organisationId: ORG,
      kind: "draft",
      credits: 1,
      model: "m",
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    const { rows } = await db.query(`select status, credits, input_tokens,
        settled_at is not null as settled,
        period_start = date_trunc('month', now() at time zone 'utc')::date as period_ok
        from ai_usage`)
    expect(rows).toEqual([
      {
        status: "settled",
        credits: 1,
        input_tokens: 10,
        settled: true,
        period_ok: true,
      },
    ])
  })

  it("ignores a repeated request_id for the same kind", async () => {
    const sql = (async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      let text = strings[0]
      values.forEach((_v, i) => {
        text += "$" + (i + 1) + strings[i + 1]
      })
      return db.query(text, values)
    }) as never
    const input = {
      organisationId: ORG,
      kind: "verify" as const,
      credits: 0,
      model: "m",
      usage: { inputTokens: 1, outputTokens: 1 },
      requestId: "req-1",
    }
    await recordAiUsage(sql, input)
    await recordAiUsage(sql, input)
    const { rows } = await db.query(
      "select count(*)::int as n from ai_usage where request_id = 'req-1'"
    )
    expect(rows).toEqual([{ n: 1 }])
  })

  it("never throws when the ledger write fails", async () => {
    const tenant = (async () => {
      throw new Error("relation ai_usage does not exist")
    }) as never
    await expect(
      recordAiUsageDetached(tenant, [
        {
          organisationId: ORG,
          kind: "draft",
          credits: 1,
          model: "m",
          usage: { inputTokens: null, outputTokens: null },
        },
      ])
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
