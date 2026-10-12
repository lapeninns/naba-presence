import postgres from "postgres"
import Stripe from "stripe"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { destroyTenants } from "../helpers/tenant"

vi.mock("server-only", () => ({}))

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const WEBHOOK_SECRET = "whsec_integration_secret"
const DAY = 24 * 60 * 60

/**
 * Stripe webhook receipts and the event processor (plan P07-S4) against a
 * real database. The webhook runs in the built app server; the processor
 * runs in-process with a Stripe client whose HTTP is a mocked fetch, so
 * nothing leaves the machine and no real key is used.
 */
describeDatabase("Stripe billing events", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let stripe: Stripe
  const organisations: string[] = []
  /** customer id -> the subscriptions Stripe "has" for it right now. */
  const provider = new Map<string, Array<Record<string, unknown>>>()
  const calls: string[] = []
  /** customer id -> how long Stripe takes to answer for it. */
  const delays = new Map<string, number>()
  const nowSeconds = Math.floor(Date.now() / 1000)
  const startedAt = new Date()
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10)
  const basicPrice = `price_basic${suffix}`

  type Modules = {
    processBillingEvents: typeof import("@/lib/server/billing/process-events").processBillingEvents
    reconcileBillingPage: typeof import("@/lib/server/billing/process-events").reconcileBillingPage
    syncOrganisationBilling: typeof import("@/lib/server/billing/process-events").syncOrganisationBilling
  }
  let modules: Modules

  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url.pathname)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          "content-type": "application/json",
          "request-id": "req_mock",
        },
      })
    if (url.pathname === "/v1/subscriptions") {
      const customer = url.searchParams.get("customer") ?? ""
      const delay = delays.get(customer)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      return json({
        object: "list",
        has_more: false,
        data: provider.get(customer) ?? [],
      })
    }
    if (url.pathname === "/v1/invoices") {
      return json({ object: "list", has_more: false, data: [] })
    }
    return json(
      { error: { type: "invalid_request_error", message: "unmocked" } },
      404
    )
  }) as typeof fetch

  function subscription(
    id: string,
    status: string,
    period: { start: number; end: number },
    extra: Record<string, unknown> = {}
  ) {
    return {
      id,
      object: "subscription",
      status,
      created: nowSeconds - 10 * DAY,
      livemode: false,
      cancel_at_period_end: false,
      cancel_at: null,
      trial_start: null,
      trial_end: null,
      schedule: null,
      items: {
        object: "list",
        has_more: false,
        data: [
          {
            id: `si_${id}`,
            object: "subscription_item",
            price: { id: basicPrice, object: "price" },
            current_period_start: period.start,
            current_period_end: period.end,
          },
        ],
      },
      latest_invoice: {
        id: `in_${id}_${period.start}`,
        object: "invoice",
        status: status === "active" ? "paid" : "open",
        amount_paid: status === "active" ? 2900 : 0,
        billing_reason: "subscription_cycle",
      },
      ...extra,
    }
  }

  async function organisation(state: "pilot" | "active" = "pilot") {
    const [org] = await admin<{ id: string }[]>`
      insert into organisation (slug, name)
      values (${`billing-events-${crypto.randomUUID().slice(0, 8)}`}, 'Billing events test')
      returning id::text as id
    `
    organisations.push(org.id)
    const customer = `cus_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`
    await admin`
      update organisation_billing
      set stripe_customer_id = ${customer}
      where organisation_id = ${org.id}
    `
    if (state === "active") {
      const [plan] = await admin<{ id: string }[]>`
        select id::text as id from billing_plan where stripe_price_id = ${basicPrice}
      `
      await admin`
        update organisation_billing
        set state = 'active', plan_id = ${plan.id}, environment = 'test',
          stripe_subscription_id = ${`sub_seed${suffix}${organisations.length}`},
          current_period_start = now() - interval '40 days',
          current_period_end = now() - interval '10 days',
          first_payment_succeeded = true
        where organisation_id = ${org.id}
      `
    }
    return { id: org.id, customer }
  }

  async function receive(type: string, customer: string, eventId?: string) {
    const id = eventId ?? `evt_${crypto.randomUUID().replace(/-/g, "")}`
    await admin`
      select * from record_billing_event(
        ${id}, ${type}, false, null, ${customer}, ${"b".repeat(64)}, now(), true
      )
    `
    return id
  }

  const event = async (externalId: string) => {
    const [row] = await admin<
      {
        status: string
        retryCount: number
        lastErrorCode: string | null
        organisationId: string | null
      }[]
    >`
      select status, retry_count as "retryCount", last_error_code as "lastErrorCode",
        organisation_id::text as "organisationId"
      from billing_event where external_event_id = ${externalId}
    `
    return row
  }

  const billing = async (organisationId: string) => {
    const [row] = await admin<
      {
        state: string
        stripeSubscriptionId: string | null
        graceEndsAt: Date | null
        firstPaymentSucceeded: boolean
        currentPeriodEnd: Date | null
      }[]
    >`
      select state, stripe_subscription_id as "stripeSubscriptionId",
        grace_ends_at as "graceEndsAt",
        first_payment_succeeded as "firstPaymentSucceeded",
        current_period_end as "currentPeriodEnd"
      from organisation_billing where organisation_id = ${organisationId}
    `
    return row
  }

  const periods = (organisationId: string) =>
    admin<
      {
        kind: string
        allowance: number | null
        sourceRef: string
        endsAt: Date
      }[]
    >`
      select kind, allowance, source_ref as "sourceRef", ends_at as "endsAt"
      from ai_credit_period
      where organisation_id = ${organisationId}
      order by created_at
    `

  const tick = () =>
    modules.processBillingEvents({
      budgetMs: 20_000,
      requestId: crypto.randomUUID(),
      stripe,
    })

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    process.env.DATABASE_URL = process.env.TEST_RUNTIME_DATABASE_URL!
    process.env.NEXTAUTH_SECRET = "billing-events-test-session-secret-32-chars"
    process.env.TOKEN_ENCRYPTION_KEY = "billing-events-test-token-key-32-chars!"
    process.env.CRON_SECRET = "billing-events-test-cron-secret"
    process.env.BILLING_ENABLED = "true"
    process.env.BILLING_ENVIRONMENT = "test"
    process.env.STRIPE_SECRET_KEY = "sk_test_integration"
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET

    await admin`
      insert into billing_plan (
        code, version, workspace_mode, environment, name, stripe_price_id,
        location_limit, ai_draft_credits_per_period, is_test_offer, active
      )
      values (
        ${`basic_${suffix}`}, 1, 'agency', 'test', 'Basic (test)', ${basicPrice},
        5, 40, true, true
      )
    `
    const { createStripeClient } = await import("@/lib/server/billing/stripe")
    stripe = createStripeClient("sk_test_integration", {
      httpClient: Stripe.createFetchHttpClient(fetchFn),
    })
    const processor = await import("@/lib/server/billing/process-events")
    modules = {
      processBillingEvents: processor.processBillingEvents,
      reconcileBillingPage: processor.reconcileBillingPage,
      syncOrganisationBilling: processor.syncOrganisationBilling,
    }
    server = await startAppServer({
      BILLING_ENABLED: "true",
      BILLING_ENVIRONMENT: "test",
      STRIPE_SECRET_KEY: "sk_test_integration",
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    })
    // Events left behind by an earlier run would be claimed by these ticks.
    await admin`
      update billing_event set status = 'processed', next_attempt_at = null
      where status in ('received', 'held', 'failed')
    `
  }, 60_000)

  afterAll(async () => {
    await server?.stop()
    await admin`delete from billing_event where received_at >= ${startedAt}`
    await destroyTenants(admin, organisations)
    await admin`delete from billing_plan where stripe_price_id = ${basicPrice}`
    await admin.end()
  })

  describe("webhook receiver", () => {
    const body = (id: string, customer = "cus_webhook1") =>
      JSON.stringify({
        id,
        object: "event",
        type: "customer.subscription.updated",
        livemode: false,
        created: nowSeconds,
        data: { object: { id: "sub_x", object: "subscription", customer } },
      })

    const post = (payload: string, signature: string | null) =>
      fetch(`${server.baseUrl}/api/webhooks/stripe`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(signature ? { "stripe-signature": signature } : {}),
        },
        body: payload,
      })

    const sign = (payload: string, secret = WEBHOOK_SECRET) =>
      Stripe.webhooks.generateTestHeaderString({ payload, secret })

    it("stores the receipt before acknowledging, once per event id", async () => {
      const id = `evt_hook${suffix}`
      const payload = body(id)
      const first = await post(payload, sign(payload))
      expect(first.status).toBe(200)
      await expect(first.json()).resolves.toEqual({
        received: true,
        duplicate: false,
      })
      // Acknowledged means stored: the row exists the moment the 200 arrives.
      expect(await event(id)).toMatchObject({ status: "received" })

      const again = await post(payload, sign(payload))
      expect(again.status).toBe(200)
      await expect(again.json()).resolves.toEqual({
        received: true,
        duplicate: true,
      })
      const rows =
        await admin`select 1 from billing_event where external_event_id = ${id}`
      expect(rows).toHaveLength(1)
    })

    it("refuses a tampered body, a wrong secret and the other mode, storing nothing", async () => {
      const id = `evt_bad${suffix}`
      const payload = body(id)
      const tampered = payload.replace("cus_webhook1", "cus_attacker")
      const responses = [
        await post(tampered, sign(payload)),
        await post(payload, sign(payload, "whsec_wrong")),
        await post(payload, null),
      ]
      for (const response of responses) {
        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toMatchObject({
          error: "invalid_signature",
        })
      }
      const live = JSON.stringify({ ...JSON.parse(payload), livemode: true })
      const liveResponse = await post(live, sign(live))
      expect(liveResponse.status).toBe(400)
      await expect(liveResponse.json()).resolves.toMatchObject({
        error: "livemode_mismatch",
      })
      expect(await event(id)).toBeUndefined()
    })
  })

  it("holds an event for an unknown customer, then processes it once linked", async () => {
    const customer = `cus_unknown${suffix}`
    const eventId = await receive("invoice.paid", customer)
    const summary = await tick()
    expect(summary.held).toBeGreaterThanOrEqual(1)
    expect(await event(eventId)).toMatchObject({
      status: "held",
      lastErrorCode: "customer_unknown",
      organisationId: null,
    })

    // Checkout links the customer; the held event is retried and applied.
    const org = await organisation()
    await admin`
      update organisation_billing set stripe_customer_id = ${customer}
      where organisation_id = ${org.id}
    `
    provider.set(customer, [
      subscription(
        `sub_held${suffix}`,
        "trialing",
        { start: nowSeconds - DAY, end: nowSeconds + 13 * DAY },
        {
          trial_start: nowSeconds - DAY,
          trial_end: nowSeconds + 13 * DAY,
        }
      ),
    ])
    await admin`
      update billing_event set next_attempt_at = now() - interval '1 second'
      where external_event_id = ${eventId}
    `
    await tick()
    expect(await event(eventId)).toMatchObject({
      status: "processed",
      organisationId: org.id,
    })
    expect((await billing(org.id)).state).toBe("trialing")
  })

  it("converts a pilot on its trial: one trial allowance, the pilot month closed", async () => {
    const org = await organisation()
    await admin`
      insert into ai_credit_period (organisation_id, kind, starts_at, ends_at, allowance, source_ref)
      values (${org.id}, 'pilot_month', date_trunc('month', now()),
        date_trunc('month', now()) + interval '1 month', 10, ${`pilot:${suffix}`})
    `
    const subId = `sub_trial${suffix}`
    provider.set(org.customer, [
      subscription(
        subId,
        "trialing",
        { start: nowSeconds - 60, end: nowSeconds + 14 * DAY },
        {
          trial_start: nowSeconds - 60,
          trial_end: nowSeconds + 14 * DAY,
        }
      ),
    ])
    await receive("checkout.session.completed", org.customer)
    await receive("customer.subscription.created", org.customer)
    await tick()

    expect(await billing(org.id)).toMatchObject({
      state: "trialing",
      stripeSubscriptionId: subId,
    })
    const rows = await periods(org.id)
    expect(rows.filter((row) => row.kind === "trial")).toEqual([
      expect.objectContaining({ allowance: 40, sourceRef: `${subId}:trial` }),
    ])
    const pilot = rows.find((row) => row.kind === "pilot_month")!
    expect(pilot.endsAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    const audits = await admin`
      select action from audit_log
      where organisation_id = ${org.id} and action like 'billing.%'
      order by created_at
    `
    expect(audits.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "billing.pilot_converted",
        "billing.credit_period_granted",
        "billing.state_changed",
      ])
    )
  })

  it("converges reordered events to provider state and grants a period once", async () => {
    const org = await organisation("active")
    const subId = `sub_paid${suffix}`
    const period = { start: nowSeconds - DAY, end: nowSeconds + 29 * DAY }
    provider.set(org.customer, [subscription(subId, "active", period)])
    // invoice.paid arrives before the subscription.updated that preceded it.
    await receive("invoice.paid", org.customer)
    await receive("customer.subscription.updated", org.customer)
    await tick()
    // A redelivered pair for the same period in a later tick.
    await receive("invoice.payment_succeeded", org.customer)
    await receive("customer.subscription.updated", org.customer)
    await tick()

    expect(await billing(org.id)).toMatchObject({
      state: "active",
      stripeSubscriptionId: subId,
    })
    expect(
      (await periods(org.id)).filter((row) => row.kind === "paid_period")
    ).toEqual([
      expect.objectContaining({
        allowance: 40,
        sourceRef: `${subId}:${period.start}`,
      }),
    ])
  })

  it("puts a failed renewal in grace without a grant, and grants once on recovery", async () => {
    const org = await organisation("active")
    const subId = `sub_grace${suffix}`
    const renewal = { start: nowSeconds - 2 * DAY, end: nowSeconds + 28 * DAY }
    provider.set(org.customer, [subscription(subId, "past_due", renewal)])
    await receive("invoice.payment_failed", org.customer)
    await tick()
    const grace = await billing(org.id)
    expect(grace.state).toBe("past_due")
    expect(grace.graceEndsAt?.getTime()).toBe((renewal.start + 7 * DAY) * 1000)
    expect(await periods(org.id)).toEqual([])

    provider.set(org.customer, [subscription(subId, "active", renewal)])
    await receive("invoice.paid", org.customer)
    await receive("customer.subscription.updated", org.customer)
    await tick()
    expect(await billing(org.id)).toMatchObject({
      state: "active",
      graceEndsAt: null,
    })
    expect(await periods(org.id)).toHaveLength(1)
  })

  it("reclaims an event whose worker died mid-process", async () => {
    const org = await organisation("active")
    provider.set(org.customer, [
      subscription(`sub_crash${suffix}`, "active", {
        start: nowSeconds - DAY,
        end: nowSeconds + 29 * DAY,
      }),
    ])
    const eventId = await receive("invoice.paid", org.customer)
    // A worker claimed it and died: the lease is all that is left.
    await admin`select * from claim_billing_events(100, 60, 8)`
    expect((await event(eventId)).status).toBe("processing")
    await admin`
      update billing_event set lease_expires_at = now() - interval '1 second'
      where external_event_id = ${eventId}
    `
    await tick()
    expect(await event(eventId)).toMatchObject({
      status: "processed",
      retryCount: 1,
    })
    expect((await billing(org.id)).state).toBe("active")
  })

  it("fails an unknown price without touching the record", async () => {
    const org = await organisation("active")
    const before = await billing(org.id)
    const unknown = subscription(`sub_unknown${suffix}`, "active", {
      start: nowSeconds - DAY,
      end: nowSeconds + 29 * DAY,
    })
    ;(unknown.items.data[0].price as { id: string }).id =
      `price_missing${suffix}`
    provider.set(org.customer, [unknown])
    const eventId = await receive("customer.subscription.updated", org.customer)
    await tick()
    expect(await event(eventId)).toMatchObject({
      status: "failed",
      lastErrorCode: "billing_plan_unknown",
      retryCount: 1,
    })
    expect(await billing(org.id)).toEqual(before)
    expect(await periods(org.id)).toEqual([])
  })

  it("releases the events it did not reach when its budget runs out", async () => {
    const orgs = [await organisation("active"), await organisation("active")]
    const eventIds: string[] = []
    for (const [index, org] of orgs.entries()) {
      provider.set(org.customer, [
        subscription(`sub_slow${index}${suffix}`, "active", {
          start: nowSeconds - DAY,
          end: nowSeconds + 29 * DAY,
        }),
      ])
      delays.set(org.customer, 500)
      eventIds.push(await receive("invoice.paid", org.customer))
    }
    try {
      // One slow sync outlasts the budget, so the other organisation's sync
      // never starts: its event goes back unattempted instead of waiting
      // out its lease in 'processing'.
      const summary = await modules.processBillingEvents({
        budgetMs: 100,
        requestId: crypto.randomUUID(),
        stripe,
      })
      expect(summary.released).toBeGreaterThanOrEqual(1)
      expect(summary.failed).toBe(0)
      const rows = await Promise.all(eventIds.map((id) => event(id)))
      expect(rows.map((row) => row.status).sort()).toEqual([
        "processed",
        "received",
      ])
      expect(rows.map((row) => row.retryCount)).toEqual([0, 0])
    } finally {
      for (const org of orgs) delays.delete(org.customer)
    }
    await tick()
    for (const id of eventIds) {
      expect(await event(id)).toMatchObject({
        status: "processed",
        retryCount: 0,
      })
    }
  })

  it("serialises concurrent syncs of one organisation", async () => {
    const org = await organisation("active")
    provider.set(org.customer, [
      subscription(`sub_race${suffix}`, "active", {
        start: nowSeconds - DAY,
        end: nowSeconds + 29 * DAY,
      }),
    ])
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        modules.syncOrganisationBilling({
          stripe,
          organisationId: org.id,
          environment: "test",
          trigger: { kind: "reconcile" },
          requestId: `race-${index}-${crypto.randomUUID()}`,
        })
      )
    )
    expect(results.filter((result) => result.grantedPeriodId)).toHaveLength(1)
    expect(await periods(org.id)).toHaveLength(1)
  })

  it("reconciles organisations whose webhook never arrived", async () => {
    const org = await organisation("active")
    provider.set(org.customer, [
      subscription(`sub_lost${suffix}`, "canceled", {
        start: nowSeconds - 30 * DAY,
        end: nowSeconds - DAY,
      }),
    ])
    let cursor: string | undefined
    let seen = false
    for (let page = 0; page < 1000; page += 1) {
      const result = await modules.reconcileBillingPage({
        input: { maxOrganisations: 50, organisationCursor: cursor },
        requestId: crypto.randomUUID(),
        budgetMs: 30_000,
        environment: "test",
        stripe,
      })
      if ((await billing(org.id)).state === "canceled") seen = true
      if (!result.nextCursor) break
      cursor = result.nextCursor
    }
    expect(seen).toBe(true)
  }, 120_000)

  it("walks past one page within a fire while its budget lasts", async () => {
    const orgs = [await organisation("active"), await organisation("active")]
    for (const [index, org] of orgs.entries()) {
      provider.set(org.customer, [
        subscription(`sub_walk${index}${suffix}`, "active", {
          start: nowSeconds - DAY,
          end: nowSeconds + 29 * DAY,
        }),
      ])
    }
    const fire = await modules.reconcileBillingPage({
      input: { maxOrganisations: 1 },
      requestId: crypto.randomUUID(),
      budgetMs: 30_000,
      environment: "test",
      stripe,
    })
    // Pages of one, yet the fire did not stop after the first.
    expect(fire.processed).toBeGreaterThanOrEqual(2)

    // With no budget it still makes progress: one organisation, then the
    // cursor to resume from.
    const starved = await modules.reconcileBillingPage({
      input: { maxOrganisations: 50 },
      requestId: crypto.randomUUID(),
      budgetMs: 0,
      environment: "test",
      stripe,
    })
    expect(starved.processed).toBe(1)
    expect(starved.nextCursor).not.toBeNull()
  }, 120_000)
})
