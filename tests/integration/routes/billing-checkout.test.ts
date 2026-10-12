import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, type Server } from "node:http"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const DAY = 24 * 60 * 60

type StubCall = {
  method: string
  path: string
  form: Record<string, string>
  idempotencyKey: string | null
}

/**
 * A minimal Stripe API on 127.0.0.1. The built app server reaches it through
 * STRIPE_API_PROXY_BASE (honoured for test-mode keys only), so no request
 * leaves the machine and no real key exists.
 */
async function startStripeStub() {
  const calls: StubCall[] = []
  const customers = new Set<string>()
  const sessions = new Map<string, Record<string, unknown>>()
  /** customer id -> subscriptions Stripe "has" for it. */
  const subscriptions = new Map<string, Record<string, unknown>[]>()
  const byId = new Map<string, Record<string, unknown>>()
  const schedules = new Map<string, Record<string, unknown>>()
  /** key -> the first request's form and the response Stripe replays. */
  const idempotent = new Map<string, { form: string; body: unknown }>()
  const idempotencyErrors: StubCall[] = []
  const id = (prefix: string) =>
    `${prefix}${randomUUID().replace(/-/g, "").slice(0, 20)}`

  const server: Server = createServer(async (request, response) => {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const url = new URL(request.url ?? "/", "http://stub")
    const form = Object.fromEntries(new URLSearchParams(raw))
    const key = (request.headers["idempotency-key"] as string) ?? null
    const call: StubCall = {
      method: request.method ?? "GET",
      path: url.pathname,
      form,
      idempotencyKey: key,
    }
    calls.push(call)
    const send = (status: number, body: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "request-id": "req_stub",
      })
      response.end(JSON.stringify(body))
    }
    const replay = key ? idempotent.get(key) : undefined
    if (replay) {
      // Stripe refuses a key reused with different parameters.
      if (replay.form !== raw) {
        idempotencyErrors.push(call)
        return send(400, {
          error: {
            type: "idempotency_error",
            message:
              "Keys for idempotent requests can only be used with the same parameters they were first used with.",
          },
        })
      }
      return send(200, replay.body)
    }
    const remember = (body: unknown) => {
      if (key) idempotent.set(key, { form: raw, body })
      send(200, body)
    }
    const path = call.path
    let match: RegExpMatchArray | null
    if (call.method === "POST" && path === "/v1/customers") {
      const customer = { id: id("cus_"), object: "customer" }
      customers.add(customer.id)
      return remember(customer)
    }
    if (call.method === "GET" && path === "/v1/subscriptions") {
      const customer = url.searchParams.get("customer") ?? ""
      return send(200, {
        object: "list",
        has_more: false,
        data: subscriptions.get(customer) ?? [],
      })
    }
    if (call.method === "POST" && path === "/v1/checkout/sessions") {
      const sessionId = id("cs_test_")
      const session = {
        id: sessionId,
        object: "checkout.session",
        status: "open",
        url: `https://checkout.stripe.test/c/pay/${sessionId}`,
        expires_at: Number(form.expires_at),
      }
      sessions.set(sessionId, session)
      return remember(session)
    }
    if ((match = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) {
      const session = sessions.get(match[1])
      return session
        ? send(200, session)
        : send(404, { error: { type: "invalid_request_error" } })
    }
    if ((match = path.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
      const session = sessions.get(match[1])!
      session.status = "expired"
      session.url = null
      return send(200, session)
    }
    if (call.method === "POST" && path === "/v1/billing_portal/sessions") {
      return send(200, {
        id: id("bps_"),
        object: "billing_portal.session",
        url: `https://billing.stripe.test/p/session/${form.customer}`,
      })
    }
    if (call.method === "POST" && path === "/v1/subscription_schedules") {
      const subscription = byId.get(form.from_subscription)!
      const item = (subscription.items as { data: Record<string, number>[] })
        .data[0]
      const schedule = {
        id: id("sub_sched_"),
        object: "subscription_schedule",
        subscription: subscription.id,
        current_phase: {
          start_date: item.current_period_start,
          end_date: item.current_period_end,
        },
        phases: [{ start_date: item.current_period_start, items: [] }],
      }
      schedules.set(schedule.id, schedule)
      subscription.schedule = schedule.id
      return remember(schedule)
    }
    if (
      (match = path.match(/^\/v1\/subscription_schedules\/([^/]+)\/release$/))
    ) {
      const schedule = schedules.get(match[1])!
      const subscription = byId.get(schedule.subscription as string)
      if (subscription) subscription.schedule = null
      schedule.status = "released"
      return remember(schedule)
    }
    if ((match = path.match(/^\/v1\/subscription_schedules\/([^/]+)$/))) {
      const schedule = schedules.get(match[1])!
      if (call.method === "POST") {
        schedule.lastUpdate = form
        return remember(schedule)
      }
      return send(200, schedule)
    }
    if ((match = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
      const subscription = byId.get(match[1])
      if (!subscription)
        return send(404, { error: { type: "invalid_request_error" } })
      if (call.method === "POST") {
        if (form.cancel_at_period_end !== undefined) {
          subscription.cancel_at_period_end =
            form.cancel_at_period_end === "true"
        }
        if (form.cancel_at === "") subscription.cancel_at = null
        return remember(subscription)
      }
      return send(200, subscription)
    }
    send(404, { error: { type: "invalid_request_error", message: "unmocked" } })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as { port: number }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    customers,
    sessions,
    subscriptions,
    schedules,
    idempotencyErrors,
    subscriptionById: (subscriptionId: string) => byId.get(subscriptionId),
    addSubscription(customer: string, subscription: Record<string, unknown>) {
      subscriptions.set(customer, [
        ...(subscriptions.get(customer) ?? []),
        subscription,
      ])
      byId.set(subscription.id as string, subscription)
    },
    callsTo(method: string, pattern: RegExp) {
      return calls.filter(
        (call) => call.method === method && pattern.test(call.path)
      )
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * Checkout, Customer Portal, plan change and cancellation through the real
 * routes (plan P07-S5), against a real database and a stubbed Stripe.
 */
describeDatabase("billing checkout, portal, plan change and cancel", () => {
  let admin: ReturnType<typeof postgres>
  let stripe: Awaited<ReturnType<typeof startStripeStub>>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let disabled: Awaited<ReturnType<typeof startAppServer>>
  const tenants: string[] = []
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10)
  const prices = {
    basic: `price_cobasic${suffix}`,
    small: `price_cosmall${suffix}`,
    large: `price_colarge${suffix}`,
    legacy: `price_colegacy${suffix}`,
    retired: `price_coretired${suffix}`,
  }
  const plans: Record<keyof typeof prices, string> = {
    basic: "",
    small: "",
    large: "",
    legacy: "",
    retired: "",
  }
  const nowSeconds = Math.floor(Date.now() / 1000)

  async function plan(
    key: keyof typeof prices,
    limit: number,
    active: boolean
  ): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into billing_plan (
        code, version, workspace_mode, environment, name, stripe_price_id,
        location_limit, ai_draft_credits_per_period, is_test_offer, active
      )
      values (
        ${`co_${key}_${suffix}`}, 1, 'agency', 'test', ${`Checkout ${key} (test)`},
        ${prices[key]}, ${limit}, 40, true, ${active}
      )
      returning id::text as id
    `
    return row.id
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    stripe = await startStripeStub()
    plans.basic = await plan("basic", 5, true)
    plans.small = await plan("small", 2, true)
    plans.large = await plan("large", 20, true)
    plans.legacy = await plan("legacy", 5, true)
    plans.retired = await plan("retired", 10, false)
    const billingEnv = {
      BILLING_ENVIRONMENT: "test",
      STRIPE_SECRET_KEY: "sk_test_checkout",
      STRIPE_WEBHOOK_SECRET: "whsec_checkout_integration",
      STRIPE_API_PROXY_BASE: stripe.baseUrl,
      BILLING_ENFORCEMENT_ENABLED: "true",
    }
    server = await startAppServer({ ...billingEnv, BILLING_ENABLED: "true" })
    disabled = await startAppServer({ ...billingEnv, BILLING_ENABLED: "false" })
  }, 90_000)

  afterAll(async () => {
    await server?.stop()
    await disabled?.stop()
    await stripe?.stop()
    await admin`drop trigger if exists co_fail_checkout_audit on audit_log`
    await admin`drop function if exists co_fail_checkout_audit()`
    await destroyTenants(admin, tenants)
    await admin`
      delete from billing_plan where stripe_price_id in ${admin(Object.values(prices))}
    `
    await admin.end()
  })

  async function owner(
    options: { workspaceMode?: "business" | "agency" } = {}
  ) {
    const tenant = await createTestTenant(admin, options)
    tenants.push(tenant.organisationId)
    return tenant
  }

  function post(
    base: string,
    cookie: string,
    path: string,
    body: unknown = {}
  ) {
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  const billing = async (organisationId: string) => {
    const [row] = await admin<
      {
        state: string
        stripeCustomerId: string | null
        checkoutSessionId: string | null
        checkoutPlanId: string | null
        pendingPlanId: string | null
        pendingEffectiveAt: Date | null
        cancelAtPeriodEnd: boolean
      }[]
    >`
      select state, stripe_customer_id as "stripeCustomerId",
        checkout_session_id as "checkoutSessionId",
        checkout_plan_id::text as "checkoutPlanId",
        pending_plan_id::text as "pendingPlanId",
        pending_effective_at as "pendingEffectiveAt",
        cancel_at_period_end as "cancelAtPeriodEnd"
      from organisation_billing where organisation_id = ${organisationId}
    `
    return row
  }

  /**
   * Makes the `billing.checkout_started` audit fail for one organisation, so
   * its checkout transaction rolls back after Stripe made the session.
   */
  async function failCheckoutAudit(organisationId: string) {
    await admin.unsafe(`
      create or replace function co_fail_checkout_audit()
      returns trigger language plpgsql as $$
      begin
        if new.action = 'billing.checkout_started'
          and new.organisation_id = '${organisationId}' then
          raise exception 'injected audit failure';
        end if;
        return new;
      end;
      $$
    `)
    await admin`drop trigger if exists co_fail_checkout_audit on audit_log`
    await admin.unsafe(`
      create trigger co_fail_checkout_audit before insert on audit_log
      for each row execute function co_fail_checkout_audit()
    `)
  }
  const healCheckoutAudit = () =>
    admin`drop trigger if exists co_fail_checkout_audit on audit_log`

  const sessionCreates = (organisationId: string) =>
    stripe
      .callsTo("POST", /^\/v1\/checkout\/sessions$/)
      .filter((call) => call.form.client_reference_id === organisationId)

  /** An organisation with a paid subscription (on `basic` by default). */
  async function subscribed(
    options: { locations?: number; plan?: keyof typeof prices } = {}
  ) {
    const planKey = options.plan ?? "basic"
    const tenant = await owner()
    const customer = `cus_co${randomUUID().replace(/-/g, "").slice(0, 16)}`
    const subscriptionId = `sub_co${randomUUID().replace(/-/g, "").slice(0, 16)}`
    const periodStart = nowSeconds - 5 * DAY
    const periodEnd = nowSeconds + 25 * DAY
    for (let index = 0; index < (options.locations ?? 0); index += 1) {
      const connection = await seedGoogleConnection(admin, {
        organisationId: tenant.organisationId,
      })
      await seedLinkedLocation(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
    }
    await admin`
      update organisation_billing
      set state = 'active', plan_id = ${plans[planKey]}, environment = 'test',
        stripe_customer_id = ${customer},
        stripe_subscription_id = ${subscriptionId},
        current_period_start = to_timestamp(${periodStart}),
        current_period_end = to_timestamp(${periodEnd}),
        first_payment_succeeded = true
      where organisation_id = ${tenant.organisationId}
    `
    stripe.addSubscription(customer, {
      id: subscriptionId,
      object: "subscription",
      customer,
      status: "active",
      livemode: false,
      cancel_at_period_end: false,
      cancel_at: null,
      trial_end: null,
      schedule: null,
      items: {
        object: "list",
        data: [
          {
            id: `si_${subscriptionId}`,
            price: { id: prices[planKey], object: "price" },
            current_period_start: periodStart,
            current_period_end: periodEnd,
          },
        ],
      },
    })
    return { ...tenant, customer, subscriptionId, periodEnd }
  }

  describe("checkout", () => {
    it("fails closed with 503 billing_unavailable while billing is off", async () => {
      const tenant = await owner()
      const response = await post(
        disabled.baseUrl,
        tenant.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: "billing_unavailable",
        details: { reason: "billing_disabled" },
      })
      expect((await billing(tenant.organisationId)).stripeCustomerId).toBeNull()
    })

    it("fails closed with 503 when no plan is on offer for the workspace", async () => {
      const tenant = await owner({ workspaceMode: "business" })
      const response = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({
        error: "billing_unavailable",
        details: { reason: "catalog_empty" },
      })
    })

    it("refuses non-owners with 403", async () => {
      const tenant = await owner()
      const admin2 = await createTestTenant(admin, { role: "admin" })
      tenants.push(admin2.organisationId)
      const member = await seedMemberUser(admin, {
        organisationId: tenant.organisationId,
      })
      for (const cookie of [admin2.cookie, member.cookie]) {
        const response = await post(
          server.baseUrl,
          cookie,
          "/api/billing/checkout",
          { planId: plans.basic }
        )
        expect(response.status).toBe(403)
      }
    })

    it("refuses a tampered price, a foreign customer and plans off the allowlist", async () => {
      const tenant = await owner()
      const before = stripe.calls.length
      for (const body of [
        { planId: plans.basic, priceId: "price_cheaper" },
        { planId: plans.basic, customerId: "cus_someoneelse" },
        { planId: prices.basic },
      ]) {
        const response = await post(
          server.baseUrl,
          tenant.cookie,
          "/api/billing/checkout",
          body
        )
        expect(response.status, JSON.stringify(body)).toBe(400)
      }
      for (const planId of [plans.retired, randomUUID()]) {
        const response = await post(
          server.baseUrl,
          tenant.cookie,
          "/api/billing/checkout",
          { planId }
        )
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({
          error: "plan_unavailable",
        })
      }
      expect(stripe.calls.length).toBe(before)
    })

    it("starts a trial checkout on the organisation's own customer and grants nothing", async () => {
      const tenant = await owner()
      const response = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const result = await response.json()
      expect(result).toMatchObject({ reused: false, trialDays: 14 })
      expect(result.url).toMatch(/^https:\/\/checkout\.stripe\.test\//)

      const record = await billing(tenant.organisationId)
      // A pilot stays a pilot until the webhook confirms the subscription.
      expect(record.state).toBe("pilot")
      expect(record.stripeCustomerId).toMatch(/^cus_/)
      expect(record.checkoutPlanId).toBe(plans.basic)

      const create = stripe
        .callsTo("POST", /^\/v1\/checkout\/sessions$/)
        .find((call) => call.form.client_reference_id === tenant.organisationId)
      expect(create?.form).toMatchObject({
        mode: "subscription",
        customer: record.stripeCustomerId,
        "line_items[0][price]": prices.basic,
        "line_items[0][quantity]": "1",
        payment_method_collection: "always",
        "subscription_data[trial_period_days]": "14",
        "subscription_data[metadata][organisation_id]": tenant.organisationId,
      })
      expect(create?.idempotencyKey).toMatch(/^naba:checkout:/)
      expect(record.checkoutSessionId).toBe(result.url.split("/").pop())

      const periods = await admin<{ n: number }[]>`
        select count(*)::int as n from ai_credit_period
        where organisation_id = ${tenant.organisationId}
          and kind in ('trial', 'paid_period')
      `
      expect(periods[0].n).toBe(0)
      const audits = await admin<{ action: string }[]>`
        select action from audit_log
        where organisation_id = ${tenant.organisationId}
          and action like 'billing.%'
        order by created_at
      `
      expect(audits.map((row) => row.action)).toEqual([
        "billing.customer_created",
        "billing.checkout_started",
      ])
    })

    it("makes one customer and one session for concurrent duplicate requests", async () => {
      const tenant = await owner()
      const responses = await Promise.all(
        [0, 1, 2].map(() =>
          post(server.baseUrl, tenant.cookie, "/api/billing/checkout", {
            planId: plans.basic,
          })
        )
      )
      const bodies = await Promise.all(responses.map((r) => r.json()))
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200])
      expect(new Set(bodies.map((body) => body.url)).size).toBe(1)
      expect(bodies.filter((body) => body.reused)).toHaveLength(2)
      const record = await billing(tenant.organisationId)
      const created = stripe
        .callsTo("POST", /^\/v1\/checkout\/sessions$/)
        .filter(
          (call) => call.form.client_reference_id === tenant.organisationId
        )
      expect(created).toHaveLength(1)
      const customers = stripe
        .callsTo("POST", /^\/v1\/customers$/)
        .filter(
          (call) =>
            call.form["metadata[organisation_id]"] === tenant.organisationId
        )
      expect(customers).toHaveLength(1)
      expect(record.stripeCustomerId).toBeTruthy()
    })

    it("expires the open session when the owner picks another plan", async () => {
      const tenant = await owner()
      const first = await (
        await post(server.baseUrl, tenant.cookie, "/api/billing/checkout", {
          planId: plans.basic,
        })
      ).json()
      const second = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/checkout",
        { planId: plans.small }
      )
      expect(second.status).toBe(200)
      const firstId = first.url.split("/").pop()
      expect(stripe.sessions.get(firstId)?.status).toBe("expired")
      const record = await billing(tenant.organisationId)
      expect(record.checkoutPlanId).toBe(plans.small)
      expect(record.checkoutSessionId).not.toBe(firstId)
    })

    it("refuses a second subscription, here or already at Stripe", async () => {
      const active = await subscribed()
      const refused = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(refused.status).toBe(409)
      expect(await refused.json()).toMatchObject({
        error: "subscription_exists",
      })

      // Checkout completed, webhook not processed yet: the record still says
      // pilot, Stripe already runs the subscription.
      const pilot = await owner()
      await post(server.baseUrl, pilot.cookie, "/api/billing/checkout", {
        planId: plans.basic,
      })
      const { stripeCustomerId } = await billing(pilot.organisationId)
      stripe.addSubscription(stripeCustomerId!, {
        id: `sub_co${suffix}pending`,
        object: "subscription",
        customer: stripeCustomerId,
        status: "trialing",
        items: { object: "list", data: [] },
      })
      const again = await post(
        server.baseUrl,
        pilot.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(again.status).toBe(409)
      expect(await again.json()).toMatchObject({ error: "subscription_exists" })
      expect((await billing(pilot.organisationId)).state).toBe("pilot")
    })

    it("retries a checkout whose transaction rolled back after Stripe made the session", async () => {
      const tenant = await owner()
      const sessionsBefore = stripe.sessions.size
      await failCheckoutAudit(tenant.organisationId)
      try {
        const failed = await post(
          server.baseUrl,
          tenant.cookie,
          "/api/billing/checkout",
          { planId: plans.basic }
        )
        expect(failed.status).toBeGreaterThanOrEqual(500)
      } finally {
        await healCheckoutAudit()
      }
      const before = await billing(tenant.organisationId)
      expect(before.checkoutSessionId).toBeNull()
      expect(sessionCreates(tenant.organisationId)).toHaveLength(1)

      const retry = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(retry.status, await retry.clone().text()).toBe(200)
      const result = await retry.json()
      const record = await billing(tenant.organisationId)
      expect(record.checkoutSessionId).toBe(result.url.split("/").pop())

      const [first, second] = sessionCreates(tenant.organisationId)
      expect(stripe.idempotencyErrors).not.toContainEqual(second)
      // In one expiry window the retry sends the same body, so Stripe
      // replays the session it made instead of opening a second one.
      if (first.form.expires_at === second.form.expires_at) {
        expect(second.idempotencyKey).toBe(first.idempotencyKey)
        expect(stripe.sessions.size).toBe(sessionsBefore + 1)
      }
    })

    it("gives a retry whose request differs its own idempotency key", async () => {
      const tenant = await owner()
      await failCheckoutAudit(tenant.organisationId)
      try {
        const failed = await post(
          server.baseUrl,
          tenant.cookie,
          "/api/billing/checkout",
          { planId: plans.basic }
        )
        expect(failed.status).toBeGreaterThanOrEqual(500)
      } finally {
        await healCheckoutAudit()
      }
      // Same record version, but the trial is no longer offered: the body
      // differs, which Stripe would refuse under the earlier key.
      await admin`
        update organisation_billing set first_payment_succeeded = true
        where organisation_id = ${tenant.organisationId}
      `
      const retry = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(retry.status, await retry.clone().text()).toBe(200)
      expect(await retry.json()).toMatchObject({ trialDays: 0, reused: false })
      const [first, second] = sessionCreates(tenant.organisationId)
      expect(first.form["subscription_data[trial_period_days]"]).toBe("14")
      expect(
        second.form["subscription_data[trial_period_days]"]
      ).toBeUndefined()
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
      expect(stripe.idempotencyErrors).toHaveLength(0)
    })

    it("stays available to an enforced read-only organisation, without a trial after a past subscription", async () => {
      const tenant = await owner()
      await admin`
        update organisation_billing
        set state = 'canceled', enforcement_enabled = true,
          stripe_subscription_id = ${`sub_co${suffix}old`}
        where organisation_id = ${tenant.organisationId}
      `
      const write = await fetch(`${server.baseUrl}/api/settings`, {
        method: "PATCH",
        headers: { cookie: tenant.cookie, "content-type": "application/json" },
        body: "{}",
      })
      expect(write.status).toBe(402)
      // The overview tells the shell banner that changes are refused, and
      // the Billing screen that no trial is on offer.
      const overview = await (
        await fetch(`${server.baseUrl}/api/billing`, {
          headers: { cookie: tenant.cookie },
        })
      ).json()
      expect(overview).toMatchObject({
        state: "canceled",
        access: { mode: "read_only", reason: "subscription_ended" },
        writesBlocked: true,
        trialDays: 0,
      })
      const response = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/checkout",
        { planId: plans.basic }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toMatchObject({ trialDays: 0 })
    })
  })

  describe("portal", () => {
    it("needs the organisation's own customer and the owner", async () => {
      const tenant = await owner()
      const none = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/portal"
      )
      expect(none.status).toBe(409)
      expect(await none.json()).toMatchObject({
        error: "billing_customer_missing",
      })

      const active = await subscribed()
      const response = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/portal"
      )
      expect(response.status).toBe(200)
      expect((await response.json()).url).toContain(active.customer)
      const call = stripe
        .callsTo("POST", /^\/v1\/billing_portal\/sessions$/)
        .at(-1)
      expect(call?.form.customer).toBe(active.customer)
      expect(call?.form.return_url).toMatch(/\/settings\/billing$/)

      const member = await seedMemberUser(admin, {
        organisationId: active.organisationId,
      })
      expect(
        (await post(server.baseUrl, member.cookie, "/api/billing/portal"))
          .status
      ).toBe(403)
    })
  })

  describe("plan change", () => {
    it("refuses a downgrade below the linked locations with 409", async () => {
      const active = await subscribed({ locations: 3 })
      const response = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.small }
      )
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: "location_limit_exceeded",
        details: { billableLocations: 3, limit: 2 },
      })
      expect((await billing(active.organisationId)).pendingPlanId).toBeNull()
      expect(
        stripe
          .callsTo("POST", /^\/v1\/subscription_schedules$/)
          .filter(
            (call) => call.form.from_subscription === active.subscriptionId
          )
      ).toHaveLength(0)
    })

    it("schedules a downgrade at the period end without proration and binds the lower limit", async () => {
      const active = await subscribed({ locations: 1 })
      const response = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.small }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toMatchObject({
        outcome: "scheduled",
        pendingPlanId: plans.small,
        pendingEffectiveAt: new Date(active.periodEnd * 1000).toISOString(),
      })
      const record = await billing(active.organisationId)
      expect(record.state).toBe("active")
      expect(record.pendingPlanId).toBe(plans.small)

      const created = stripe
        .callsTo("POST", /^\/v1\/subscription_schedules$/)
        .find((call) => call.form.from_subscription === active.subscriptionId)
      expect(created).toBeDefined()
      const update = stripe
        .callsTo("POST", /^\/v1\/subscription_schedules\/[^/]+$/)
        .find(
          (call) =>
            call.form["metadata[organisation_id]"] === active.organisationId
        )
      expect(update?.form).toMatchObject({
        end_behavior: "release",
        proration_behavior: "none",
        "phases[0][items][0][price]": prices.basic,
        "phases[0][end_date]": String(active.periodEnd),
        "phases[1][items][0][price]": prices.small,
        "phases[1][proration_behavior]": "none",
      })

      const overview = await (
        await fetch(`${server.baseUrl}/api/billing`, {
          headers: { cookie: active.cookie },
        })
      ).json()
      expect(overview).toMatchObject({
        state: "active",
        pendingPlan: { id: plans.small, locationLimit: 2 },
        access: { locationLimit: 5, newLinkLimit: 2 },
        billableLocations: 1,
        canManage: true,
      })
      expect(JSON.stringify(overview)).not.toContain(prices.basic)

      // Repeating it changes nothing; choosing the current plan clears it.
      const repeat = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.small }
      )
      expect(await repeat.json()).toMatchObject({ outcome: "unchanged" })
      const cleared = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.basic }
      )
      expect(await cleared.json()).toMatchObject({
        outcome: "cleared",
        pendingPlanId: null,
      })
      expect((await billing(active.organisationId)).pendingPlanId).toBeNull()
      const schedule = [...stripe.schedules.values()].find(
        (entry) => entry.subscription === active.subscriptionId
      )
      expect(schedule?.status).toBe("released")
    })

    it("re-points an existing schedule to another plan rather than making a second", async () => {
      const active = await subscribed()
      const toSmall = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.small }
      )
      expect(toSmall.status, await toSmall.clone().text()).toBe(200)
      const scheduleId = stripe.subscriptionById(active.subscriptionId)
        ?.schedule as string
      expect(scheduleId).toMatch(/^sub_sched_/)

      const toLarge = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.large }
      )
      expect(toLarge.status, await toLarge.clone().text()).toBe(200)
      expect(await toLarge.json()).toMatchObject({
        outcome: "scheduled",
        pendingPlanId: plans.large,
      })
      expect(
        stripe
          .callsTo("POST", /^\/v1\/subscription_schedules$/)
          .filter(
            (call) => call.form.from_subscription === active.subscriptionId
          )
      ).toHaveLength(1)
      const updates = stripe.callsTo(
        "POST",
        new RegExp(`^/v1/subscription_schedules/${scheduleId}$`)
      )
      expect(updates).toHaveLength(2)
      expect(updates[1].form).toMatchObject({
        "phases[0][items][0][price]": prices.basic,
        "phases[0][end_date]": String(active.periodEnd),
        "phases[1][items][0][price]": prices.large,
      })
      expect((await billing(active.organisationId)).pendingPlanId).toBe(
        plans.large
      )
    })

    it("clears a scheduled change even after the current plan was retired", async () => {
      const active = await subscribed({ plan: "legacy" })
      const scheduled = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.small }
      )
      expect(scheduled.status, await scheduled.clone().text()).toBe(200)
      const scheduleId = stripe.subscriptionById(active.subscriptionId)
        ?.schedule as string
      await admin`update billing_plan set active = false where id = ${plans.legacy}`

      // The retired plan is no longer offered for a new change...
      const other = await subscribed()
      const refused = await post(
        server.baseUrl,
        other.cookie,
        "/api/billing/plan-change",
        { planId: plans.legacy }
      )
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error: "plan_unavailable" })

      // ...but its own subscriber can still go back to it.
      const cleared = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/plan-change",
        { planId: plans.legacy.toUpperCase() }
      )
      expect(cleared.status, await cleared.clone().text()).toBe(200)
      expect(await cleared.json()).toMatchObject({
        outcome: "cleared",
        pendingPlanId: null,
        pendingEffectiveAt: null,
      })
      expect(
        stripe.callsTo(
          "POST",
          new RegExp(`^/v1/subscription_schedules/${scheduleId}/release$`)
        )
      ).toHaveLength(1)
      expect(await billing(active.organisationId)).toMatchObject({
        pendingPlanId: null,
        pendingEffectiveAt: null,
      })
      const audits = await admin<{ action: string }[]>`
        select action from audit_log
        where organisation_id = ${active.organisationId}
          and action like 'billing.plan_change%'
        order by created_at
      `
      expect(audits.map((row) => row.action)).toEqual([
        "billing.plan_change_scheduled",
        "billing.plan_change_cleared",
      ])
    })

    it("refuses an organisation without a subscription", async () => {
      const tenant = await owner()
      const response = await post(
        server.baseUrl,
        tenant.cookie,
        "/api/billing/plan-change",
        { planId: plans.small }
      )
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        error: "subscription_not_changeable",
      })
    })
  })

  describe("cancel", () => {
    it("sets the end-of-period flag only, and resumes", async () => {
      const active = await subscribed()
      const response = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/cancel",
        { cancelAtPeriodEnd: true }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toMatchObject({
        outcome: "updated",
        cancelAtPeriodEnd: true,
      })
      const record = await billing(active.organisationId)
      expect(record).toMatchObject({ state: "active", cancelAtPeriodEnd: true })
      const update = stripe
        .callsTo(
          "POST",
          new RegExp(`^/v1/subscriptions/${active.subscriptionId}$`)
        )
        .at(-1)
      expect(update?.form).toEqual({ cancel_at_period_end: "true" })

      const resumed = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/cancel",
        { cancelAtPeriodEnd: false }
      )
      expect(await resumed.json()).toMatchObject({
        outcome: "updated",
        cancelAtPeriodEnd: false,
      })
      expect((await billing(active.organisationId)).cancelAtPeriodEnd).toBe(
        false
      )

      const member = await seedMemberUser(admin, {
        organisationId: active.organisationId,
      })
      expect(
        (
          await post(server.baseUrl, member.cookie, "/api/billing/cancel", {
            cancelAtPeriodEnd: true,
          })
        ).status
      ).toBe(403)
    })
  })

  describe("cancel with a scheduled change or a portal cancellation", () => {
    it("releases the schedule before cancelling and drops the pending plan", async () => {
      const active = await subscribed()
      await post(server.baseUrl, active.cookie, "/api/billing/plan-change", {
        planId: plans.small,
      })
      const scheduleId = stripe.subscriptionById(active.subscriptionId)
        ?.schedule as string
      expect(scheduleId).toMatch(/^sub_sched_/)

      const response = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/cancel",
        { cancelAtPeriodEnd: true }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toEqual({
        outcome: "updated",
        cancelAtPeriodEnd: true,
        clearedPendingPlan: true,
      })
      const release = stripe.calls.findIndex(
        (call) =>
          call.method === "POST" &&
          call.path === `/v1/subscription_schedules/${scheduleId}/release`
      )
      const update = stripe.calls.findIndex(
        (call) =>
          call.method === "POST" &&
          call.path === `/v1/subscriptions/${active.subscriptionId}`
      )
      expect(release).toBeGreaterThanOrEqual(0)
      expect(update).toBeGreaterThan(release)
      expect(stripe.calls[update].form).toEqual({
        cancel_at_period_end: "true",
      })
      expect(await billing(active.organisationId)).toMatchObject({
        cancelAtPeriodEnd: true,
        pendingPlanId: null,
        pendingEffectiveAt: null,
      })
    })

    it("resumes a portal cancellation that set cancel_at", async () => {
      const active = await subscribed()
      await admin`
        update organisation_billing set cancel_at_period_end = true
        where organisation_id = ${active.organisationId}
      `
      const subscription = stripe.subscriptionById(active.subscriptionId)!
      subscription.cancel_at = active.periodEnd
      subscription.cancel_at_period_end = false

      const response = await post(
        server.baseUrl,
        active.cookie,
        "/api/billing/cancel",
        { cancelAtPeriodEnd: false }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toMatchObject({
        outcome: "updated",
        cancelAtPeriodEnd: false,
        clearedPendingPlan: false,
      })
      const update = stripe
        .callsTo(
          "POST",
          new RegExp(`^/v1/subscriptions/${active.subscriptionId}$`)
        )
        .at(-1)
      expect(update?.form).toEqual({ cancel_at: "" })
      expect(subscription.cancel_at).toBeNull()
      expect((await billing(active.organisationId)).cancelAtPeriodEnd).toBe(
        false
      )
    })
  })

  describe("overview", () => {
    it("shows any member the catalog without price ids, managing for the owner only", async () => {
      const tenant = await owner()
      const member = await seedMemberUser(admin, {
        organisationId: tenant.organisationId,
      })
      const response = await fetch(`${server.baseUrl}/api/billing`, {
        headers: { cookie: member.cookie },
      })
      expect(response.status).toBe(200)
      const overview = await response.json()
      expect(overview).toMatchObject({
        state: "pilot",
        canManage: false,
        checkout: { available: true, reason: null },
        providerSyncedAt: null,
        trialDays: 14,
        writesBlocked: false,
      })

      // The "Confirming subscription" screen waits for the provider sync.
      await admin`
        update organisation_billing
        set provider_synced_at = '2026-10-12T10:00:00Z'
        where organisation_id = ${tenant.organisationId}
      `
      const synced = await (
        await fetch(`${server.baseUrl}/api/billing`, {
          headers: { cookie: member.cookie },
        })
      ).json()
      expect(synced.providerSyncedAt).toBe("2026-10-12T10:00:00.000Z")
      const ids = overview.catalog.map((plan: { id: string }) => plan.id)
      expect(ids).toEqual(expect.arrayContaining([plans.basic, plans.small]))
      expect(ids).not.toContain(plans.retired)
      expect(JSON.stringify(overview)).not.toMatch(/price_/)
    })
  })
})
