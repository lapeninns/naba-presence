import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

// Default AI_MAX_OUTPUT_TOKENS (4096) + CALL_INPUT_TOKEN_ESTIMATE (8192).
const CALL_BUDGET = 4096 + 8192

describeDatabase("AI credit reservation under parallel requests", () => {
  let admin: ReturnType<typeof postgres>
  const organisations: string[] = []

  const createOrganisation = async (allowance: number) => {
    const [org] = await admin<{ id: string }[]>`
      insert into organisation (slug, name, ai_monthly_draft_credits)
      values (
        ${`ai-credits-${crypto.randomUUID().slice(0, 8)}`},
        'AI credits concurrency test',
        ${allowance}
      )
      returning id::text as id
    `
    // Provisioning gives every organisation its pilot billing record.
    await admin`
      insert into organisation_billing (organisation_id, state)
      values (${org.id}, 'pilot')
    `
    organisations.push(org.id)
    return org.id
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "ai-credits-test-session-secret-32-characters"
    process.env.TOKEN_ENCRYPTION_KEY = "ai-credits-test-token-key-32-characters"
    process.env.CRON_SECRET = "ai-credits-test-cron-secret"
    // The allowance comes from the per-organisation override set below.
    process.env.AI_MONTHLY_DRAFT_CREDITS = "100"
    // Room for exactly two calls in flight at once.
    process.env.AI_MONTHLY_TOKEN_BACKSTOP = String(CALL_BUDGET * 2)
    delete process.env.AI_MAX_OUTPUT_TOKENS
  })

  afterAll(async () => {
    for (const id of organisations) {
      await admin`delete from organisation where id = ${id}`
    }
    await admin.end()
  })

  it("lets exactly one of N parallel reservations through an allowance of 1", async () => {
    const organisationId = await createOrganisation(1)
    const { withTenant } = await import("@/lib/server/db")
    const { reserveDraftCredit } = await import("@/lib/server/ai-credits")
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, n) =>
        withTenant(organisationId, (sql) =>
          reserveDraftCredit(sql, {
            organisationId,
            model: "test-model",
            reviewId: crypto.randomUUID(),
            draftId: crypto.randomUUID(),
            generationKey: `parallel-${n}-${crypto.randomUUID()}`,
            userId: null,
          })
        )
      )
    )
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1)
    const rejected = attempts.filter(
      (a): a is PromiseRejectedResult => a.status === "rejected"
    )
    expect(rejected).toHaveLength(7)
    for (const r of rejected) {
      expect(r.reason).toMatchObject({
        status: 402,
        code: "ai_credits_exhausted",
      })
    }
    const rows = await admin`
      select status from ai_usage where organisation_id = ${organisationId}
    `
    expect(rows).toEqual([{ status: "reserved" }])
  })

  it("creates exactly one pilot period when parallel first requests open a new month", async () => {
    const organisationId = await createOrganisation(10)
    // Last month's pilot period is over: the next request must open this
    // month's, and parallel first requests must not open it twice.
    await admin`
      insert into ai_credit_period (
        organisation_id, kind, starts_at, ends_at, allowance, source_ref
      )
      select ${organisationId}, 'pilot_month',
        (m - interval '1 month') at time zone 'utc',
        m at time zone 'utc',
        10,
        'pilot:' || to_char(m - interval '1 month', 'YYYY-MM')
      from (select date_trunc('month', now() at time zone 'utc') as m) s
    `
    const { withTenant } = await import("@/lib/server/db")
    const { getAiCredits } = await import("@/lib/server/ai-credits")
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        withTenant(organisationId, (sql) => getAiCredits(sql, organisationId))
      )
    )
    const periods = await admin<{ id: string; source_ref: string }[]>`
      select id::text as id, source_ref from ai_credit_period
      where organisation_id = ${organisationId}
        and starts_at <= now() and ends_at > now()
    `
    expect(periods).toHaveLength(1)
    expect(new Set(results.map((r) => r.periodId))).toEqual(
      new Set([periods[0].id])
    )
    const [{ total }] = await admin<{ total: number }[]>`
      select count(*)::int as total from ai_credit_period
      where organisation_id = ${organisationId}
    `
    expect(total).toBe(2)
  })

  it("never lets parallel draft and verify calls hold more than the backstop", async () => {
    const organisationId = await createOrganisation(100)
    const { withTenant } = await import("@/lib/server/db")
    const { reserveDraftCredit } = await import("@/lib/server/ai-credits")
    const { reserveVerifyUsage } = await import("@/lib/server/ai-usage")
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, n) =>
        withTenant(organisationId, async (sql) =>
          n % 2 === 0
            ? reserveDraftCredit(sql, {
                organisationId,
                model: "test-model",
                reviewId: crypto.randomUUID(),
                draftId: crypto.randomUUID(),
                generationKey: `draft-${n}-${crypto.randomUUID()}`,
                userId: null,
              })
            : reserveVerifyUsage(sql, {
                organisationId,
                model: "test-model",
                reviewId: null,
                draftId: null,
                requestKey: `verify-${n}-${crypto.randomUUID()}`,
                userId: null,
              })
        )
      )
    )
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(attempt.reason).toMatchObject({
          status: 429,
          code: "ai_token_backstop",
        })
      }
    }
    const rows = await admin<{ kind: string }[]>`
      select kind from ai_usage
      where organisation_id = ${organisationId} and status = 'reserved'
    `
    // Two in-flight budgets fill the backstop; nothing else got through.
    expect(rows).toHaveLength(2)
  })
})
