import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

/**
 * Stable generation ids and credit periods through the real drafts route
 * (P07-S2): the Idempotency-Key intent is the generation id, a retry under
 * it never spends a second credit or calls the provider again, and every
 * ledger row names its credit period.
 */
describeDatabase("AI generation ids and credit periods", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const tenants: string[] = []

  const DRAFT = {
    reply: "Thank you for your kind review. We hope to welcome you back soon.",
    language: "en",
  }

  async function tenantWithReview() {
    const owner = await createTestTenant(admin)
    tenants.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return { owner, review }
  }

  function aiCalls(): number {
    return stub.calls.filter(
      (call) =>
        call.method === "POST" && call.path.includes("/ai/v1/chat/completions")
    ).length
  }

  function draft(
    cookie: string,
    reviewId: string,
    body: Record<string, unknown>,
    intent?: string
  ) {
    return fetch(`${server.baseUrl}/api/reviews/${reviewId}/drafts`, {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        ...(intent ? { "idempotency-key": intent } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    stub.respond(
      { method: "POST", pathIncludes: "/ai/v1/chat/completions" },
      (call) => {
        const isVerification = JSON.stringify(call.body).includes(
          "review_reply_verification"
        )
        return {
          status: 200,
          json: {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify(
                    isVerification
                      ? {
                          unsupportedClaims: [],
                          unsafeEscalation: false,
                          toneMismatch: false,
                        }
                      : DRAFT
                  ),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          },
        }
      }
    )
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      WORKERS_AI_API_TOKEN: "route-harness-dummy-workers-ai-token",
      WORKERS_AI_ACCOUNT_ID: "a".repeat(32),
      WORKERS_AI_BASE_URL: stub.baseUrl,
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, tenants)
    await admin`delete from billing_plan where code = 'p07s2_trial_test'`
    await admin.end()
  })

  it("answers a retried generation from the first one, for one credit", async () => {
    const { owner, review } = await tenantWithReview()
    const intent = randomUUID()
    const callsBefore = aiCalls()

    const first = await draft(
      owner.cookie,
      review.reviewId,
      { tone: "warm_professional" },
      intent
    )
    expect(first.status, await first.clone().text()).toBe(201)
    const created = (await first.json()) as { draftId: string; body: string }
    expect(aiCalls()).toBe(callsBefore + 2)

    const retry = await draft(
      owner.cookie,
      review.reviewId,
      { tone: "warm_professional" },
      intent
    )
    expect(retry.status, await retry.clone().text()).toBe(200)
    const replayed = (await retry.json()) as {
      draftId: string
      body: string
      verification: { verdict: string }
    }
    expect(replayed.draftId).toBe(created.draftId)
    expect(replayed.body).toBe(DRAFT.reply)
    expect(replayed.verification.verdict).toMatch(/^(pass|warn)$/)
    // Neither the provider nor the ledger saw the retry.
    expect(aiCalls()).toBe(callsBefore + 2)

    const rows = await admin<
      {
        kind: string
        status: string
        credits: number
        request_id: string
        period: string | null
        input_tokens: number | null
      }[]
    >`
      select kind, status, credits, request_id,
        credit_period_id::text as period, input_tokens
      from ai_usage
      where organisation_id = ${owner.organisationId}
      order by kind
    `
    expect(rows).toHaveLength(2)
    const [draftRow, verifyRow] = rows
    expect(draftRow).toMatchObject({
      kind: "draft",
      status: "settled",
      credits: 1,
      request_id: `intent:${intent}`,
      input_tokens: 100,
    })
    expect(verifyRow).toMatchObject({
      kind: "verify",
      status: "settled",
      credits: 0,
    })
    const [period] = await admin<{ id: string; kind: string }[]>`
      select id::text as id, kind from ai_credit_period
      where organisation_id = ${owner.organisationId}
    `
    expect(period.kind).toBe("pilot_month")
    expect(draftRow.period).toBe(period.id)
    expect(verifyRow.period).toBe(period.id)

    const balance = await fetch(`${server.baseUrl}/api/ai/credits`, {
      headers: { cookie: owner.cookie },
    })
    expect(await balance.json()).toMatchObject({
      used: 1,
      periodId: period.id,
      periodKind: "pilot_month",
      canUseAi: true,
    })
  })

  it("refuses AI drafting with an unknown allowance but still saves a manual reply", async () => {
    const { owner, review } = await tenantWithReview()
    const [plan] = await admin<{ id: string }[]>`
      insert into billing_plan (
        code, version, workspace_mode, environment, name, stripe_price_id,
        location_limit, ai_draft_credits_per_period, is_test_offer, active
      )
      values (
        'p07s2_trial_test', 1, 'agency', 'test', 'Trial test', 'price_p07s2test',
        5, 10, true, false
      )
      on conflict (code, version, environment) do update set active = false
      returning id::text as id
    `
    // A trial whose credit period billing has not granted yet.
    await admin`
      update organisation_billing
      set state = 'trialing',
          plan_id = ${plan.id},
          stripe_customer_id = ${`cus_${randomUUID().replaceAll("-", "")}`},
          stripe_subscription_id = ${`sub_${randomUUID().replaceAll("-", "")}`},
          environment = 'test',
          trial_ends_at = now() + interval '14 days'
      where organisation_id = ${owner.organisationId}
    `
    const callsBefore = aiCalls()
    const generated = await draft(owner.cookie, review.reviewId, {
      tone: "warm_professional",
    })
    expect(generated.status, await generated.clone().text()).toBe(402)
    expect(await generated.json()).toMatchObject({
      error: "ai_allowance_unknown",
    })
    expect(aiCalls()).toBe(callsBefore)

    const manual = await draft(owner.cookie, review.reviewId, {
      tone: "warm_professional",
      body: "Thank you for visiting us.",
    })
    expect(manual.status, await manual.clone().text()).toBe(201)

    const balance = await fetch(`${server.baseUrl}/api/ai/credits`, {
      headers: { cookie: owner.cookie },
    })
    expect(await balance.json()).toMatchObject({
      allowance: null,
      remaining: null,
      periodId: null,
    })
    const [{ periods }] = await admin<{ periods: number }[]>`
      select count(*)::int as periods from ai_credit_period
      where organisation_id = ${owner.organisationId}
    `
    expect(periods).toBe(0)
  })

  it("refuses AI drafting with 402 billing_read_only when billing is read-only", async () => {
    const { owner, review } = await tenantWithReview()
    await admin`
      update organisation_billing set state = 'read_only'
      where organisation_id = ${owner.organisationId}
    `
    const callsBefore = aiCalls()
    const response = await draft(owner.cookie, review.reviewId, {
      tone: "warm_professional",
    })
    expect(response.status, await response.clone().text()).toBe(402)
    expect(await response.json()).toMatchObject({ error: "billing_read_only" })
    expect(aiCalls()).toBe(callsBefore)
  })
})
