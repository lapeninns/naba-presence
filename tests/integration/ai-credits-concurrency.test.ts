import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("AI credit reservation under parallel requests", () => {
  let admin: ReturnType<typeof postgres>
  let organisationId: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "ai-credits-test-session-secret-32-characters"
    process.env.TOKEN_ENCRYPTION_KEY = "ai-credits-test-token-key-32-characters"
    process.env.CRON_SECRET = "ai-credits-test-cron-secret"
    // The allowance comes from the per-organisation override set below.
    process.env.AI_MONTHLY_DRAFT_CREDITS = "100"
    const [org] = await admin<{ id: string }[]>`
      insert into organisation (slug, name, ai_monthly_draft_credits)
      values (
        ${`ai-credits-${crypto.randomUUID().slice(0, 8)}`},
        'AI credits concurrency test',
        1
      )
      returning id::text as id
    `
    organisationId = org.id
  })

  afterAll(async () => {
    if (organisationId) {
      await admin`delete from organisation where id = ${organisationId}`
    }
    await admin.end()
  })

  it("lets exactly one of N parallel reservations through an allowance of 1", async () => {
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
            requestId: `parallel-${n}-${crypto.randomUUID()}`,
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
})
