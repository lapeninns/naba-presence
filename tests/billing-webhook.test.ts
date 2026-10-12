import Stripe from "stripe"
import { describe, expect, it } from "vitest"

import {
  fetchProviderSubscription,
  isHandledEventType,
  syncErrorCode,
  BillingSyncError,
} from "@/lib/server/billing/process-events"
import {
  billingConfig,
  createStripeClient,
  STRIPE_API_VERSION,
  stripeKeyMode,
} from "@/lib/server/billing/stripe"
import { verifyStripeWebhook } from "@/lib/server/billing/webhook"
import { ApiError } from "@/lib/server/http"

const SECRET = "whsec_test_secret_value"
const config = { webhookSecret: SECRET, environment: "test" as const }

function event(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_1TestEvent",
    object: "event",
    type: "invoice.paid",
    livemode: false,
    created: 1_790_000_000,
    api_version: STRIPE_API_VERSION,
    data: { object: { id: "in_1", object: "invoice", customer: "cus_A1" } },
    ...overrides,
  })
}

const sign = (payload: string, secret = SECRET) =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret })

function refused(fn: () => unknown): ApiError {
  try {
    fn()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error("expected a refusal")
}

describe("verifyStripeWebhook", () => {
  it("accepts a correctly signed event and extracts only routing facts", () => {
    const body = event()
    const verified = verifyStripeWebhook(body, sign(body), config)
    expect(verified).toMatchObject({
      id: "evt_1TestEvent",
      type: "invoice.paid",
      livemode: false,
      accountId: null,
      customerId: "cus_A1",
      createdAt: new Date(1_790_000_000 * 1000),
    })
    expect(verified.payloadHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("routes a customer event by its own id and an expanded customer", () => {
    const customer = event({
      type: "customer.updated",
      data: { object: { id: "cus_B2", object: "customer" } },
    })
    expect(
      verifyStripeWebhook(customer, sign(customer), config).customerId
    ).toBe("cus_B2")
    const expanded = event({
      data: { object: { object: "subscription", customer: { id: "cus_C3" } } },
    })
    expect(
      verifyStripeWebhook(expanded, sign(expanded), config).customerId
    ).toBe("cus_C3")
  })

  it("refuses a tampered body", () => {
    const body = event()
    const header = sign(body)
    const tampered = body.replace("cus_A1", "cus_EVIL")
    expect(
      refused(() => verifyStripeWebhook(tampered, header, config))
    ).toMatchObject({
      status: 400,
      code: "invalid_signature",
    })
  })

  it("refuses the wrong secret and a missing signature", () => {
    const body = event()
    expect(
      refused(() =>
        verifyStripeWebhook(body, sign(body, "whsec_other"), config)
      ).code
    ).toBe("invalid_signature")
    expect(refused(() => verifyStripeWebhook(body, null, config)).code).toBe(
      "invalid_signature"
    )
  })

  it("refuses a stale signature", () => {
    const body = event()
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    })
    expect(refused(() => verifyStripeWebhook(body, header, config)).code).toBe(
      "invalid_signature"
    )
  })

  it("refuses an event from the other mode", () => {
    const live = event({ livemode: true })
    expect(
      refused(() => verifyStripeWebhook(live, sign(live), config))
    ).toMatchObject({
      status: 400,
      code: "livemode_mismatch",
    })
    const test = event()
    expect(
      refused(() =>
        verifyStripeWebhook(test, sign(test), {
          ...config,
          environment: "live",
        })
      ).code
    ).toBe("livemode_mismatch")
  })

  it("refuses a Connect event for another account", () => {
    const connect = event({ account: "acct_1Other" })
    expect(
      refused(() => verifyStripeWebhook(connect, sign(connect), config)).code
    ).toBe("unexpected_account")
  })
})

describe("billingConfig", () => {
  const on = {
    BILLING_ENABLED: true,
    BILLING_ENVIRONMENT: "test" as const,
    STRIPE_SECRET_KEY: "sk_test_unit",
    STRIPE_WEBHOOK_SECRET: SECRET,
  }

  it("is available only when enabled, complete and in the right mode", () => {
    expect(billingConfig(on)).toMatchObject({ ok: true, environment: "test" })
    expect(billingConfig({ ...on, BILLING_ENABLED: false })).toEqual({
      ok: false,
      reason: "billing_disabled",
    })
    expect(billingConfig({ ...on, STRIPE_SECRET_KEY: undefined })).toEqual({
      ok: false,
      reason: "secret_key_missing",
    })
    expect(billingConfig({ ...on, STRIPE_WEBHOOK_SECRET: undefined })).toEqual({
      ok: false,
      reason: "webhook_secret_missing",
    })
    expect(billingConfig({ ...on, STRIPE_SECRET_KEY: "pk_test_abc" })).toEqual({
      ok: false,
      reason: "secret_key_unrecognised",
    })
    expect(billingConfig({ ...on, STRIPE_SECRET_KEY: "sk_live_unit" })).toEqual(
      {
        ok: false,
        reason: "secret_key_mode_mismatch",
      }
    )
    expect(
      billingConfig({
        ...on,
        BILLING_ENVIRONMENT: "live",
        STRIPE_SECRET_KEY: "rk_live_unit",
      })
    ).toMatchObject({ ok: true, environment: "live" })
  })

  it("reads the key mode", () => {
    expect(stripeKeyMode("sk_test_x1")).toBe("test")
    expect(stripeKeyMode("rk_live_x1")).toBe("live")
    expect(stripeKeyMode("whsec_x1")).toBeNull()
  })
})

describe("event types", () => {
  it("acts on subscription, invoice, checkout and schedule events only", () => {
    expect(isHandledEventType("customer.subscription.updated")).toBe(true)
    expect(isHandledEventType("invoice.payment_failed")).toBe(true)
    expect(isHandledEventType("checkout.session.completed")).toBe(true)
    expect(isHandledEventType("subscription_schedule.updated")).toBe(true)
    expect(isHandledEventType("charge.refunded")).toBe(false)
    expect(isHandledEventType("customer.updated")).toBe(false)
  })
})

describe("syncErrorCode", () => {
  it("keeps only stable codes", () => {
    expect(syncErrorCode(new BillingSyncError("billing_plan_unknown"))).toBe(
      "billing_plan_unknown"
    )
    expect(
      syncErrorCode({
        code: "23514",
        message: "billing_plan_workspace_mode_mismatch",
      })
    ).toBe("billing_plan_workspace_mode_mismatch")
    expect(syncErrorCode({ code: "23514", message: "some_check" })).toBe(
      "billing_record_rejected"
    )
    expect(syncErrorCode({ type: "StripeConnectionError" })).toBe(
      "stripe_unavailable"
    )
    expect(syncErrorCode({ type: "StripeInvalidRequestError" })).toBe(
      "stripe_request_failed"
    )
    expect(syncErrorCode(new Error("boom with cus_secret detail"))).toBe(
      "internal_error"
    )
  })
})

describe("fetchProviderSubscription against a mocked Stripe API", () => {
  type Call = { method: string; url: URL }

  function mockedStripe(routes: Record<string, unknown>) {
    const calls: Call[] = []
    const fetchFn = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = new URL(String(input))
      calls.push({ method: init?.method ?? "GET", url })
      const body = routes[url.pathname]
      if (body === undefined) {
        return new Response(
          JSON.stringify({
            error: { type: "invalid_request_error", message: "no route" },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          }
        )
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_test",
        },
      })
    }) as typeof fetch
    const stripe = createStripeClient("sk_test_mocked", {
      httpClient: Stripe.createFetchHttpClient(fetchFn),
    })
    return { stripe, calls }
  }

  const item = (price: string) => ({
    id: "si_1",
    object: "subscription_item",
    price: { id: price, object: "price" },
    current_period_start: 1_793_491_200,
    current_period_end: 1_796_083_200,
  })

  const sub = (overrides: Record<string, unknown>) => ({
    id: "sub_1",
    object: "subscription",
    status: "active",
    created: 1_790_000_000,
    livemode: false,
    cancel_at_period_end: false,
    cancel_at: null,
    trial_start: null,
    trial_end: null,
    schedule: null,
    items: { object: "list", data: [item("price_basic")], has_more: false },
    latest_invoice: {
      id: "in_1",
      object: "invoice",
      status: "paid",
      amount_paid: 2900,
      billing_reason: "subscription_cycle",
    },
    ...overrides,
  })

  it("maps the newest running subscription with its period and invoice", async () => {
    const { stripe, calls } = mockedStripe({
      "/v1/subscriptions": {
        object: "list",
        has_more: false,
        data: [sub({ id: "sub_old", status: "canceled", created: 1 }), sub({})],
      },
    })
    const result = await fetchProviderSubscription(stripe, "cus_A1", {
      stripeSubscriptionId: "sub_old",
      firstPaymentSucceeded: true,
    })
    expect(result).toMatchObject({
      id: "sub_1",
      status: "active",
      priceId: "price_basic",
      itemCount: 1,
      currentPeriodStart: new Date(1_793_491_200_000),
      currentPeriodEnd: new Date(1_796_083_200_000),
      latestInvoice: { status: "paid", amountPaid: 2900 },
      pending: null,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url.host).toBe("api.stripe.com")
    expect(calls[0].url.searchParams.get("customer")).toBe("cus_A1")
    expect(calls[0].url.searchParams.get("status")).toBe("all")
  })

  it("checks paid history for a failure and reads a waiting plan change", async () => {
    const { stripe, calls } = mockedStripe({
      "/v1/subscriptions": {
        object: "list",
        has_more: false,
        data: [sub({ status: "past_due", schedule: "sub_sched_1" })],
      },
      "/v1/invoices": {
        object: "list",
        has_more: false,
        data: [
          {
            id: "in_0",
            object: "invoice",
            amount_paid: 2900,
            billing_reason: "subscription_cycle",
          },
        ],
      },
      "/v1/subscription_schedules/sub_sched_1": {
        id: "sub_sched_1",
        object: "subscription_schedule",
        phases: [
          {
            start_date: 1_793_491_200,
            end_date: 1_796_083_200,
            items: [{ price: "price_basic" }],
          },
          {
            start_date: 1_796_083_200,
            end_date: 1_798_761_600,
            items: [{ price: "price_small" }],
          },
        ],
      },
    })
    const result = await fetchProviderSubscription(
      stripe,
      "cus_A1",
      { stripeSubscriptionId: "sub_1", firstPaymentSucceeded: false },
      new Date(1_794_000_000_000)
    )
    expect(result).toMatchObject({
      status: "past_due",
      paymentSucceeded: true,
      pending: {
        priceId: "price_small",
        effectiveAt: new Date(1_796_083_200_000),
      },
    })
    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/v1/subscriptions",
      "/v1/invoices",
      "/v1/subscription_schedules/sub_sched_1",
    ])
  })

  it("answers null for a customer with no subscription", async () => {
    const { stripe } = mockedStripe({
      "/v1/subscriptions": { object: "list", has_more: false, data: [] },
    })
    expect(
      await fetchProviderSubscription(stripe, "cus_A1", {
        stripeSubscriptionId: null,
        firstPaymentSucceeded: false,
      })
    ).toBeNull()
  })
})
