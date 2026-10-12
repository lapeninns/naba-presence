import { describe, expect, it } from "vitest"

import {
  chooseSubscription,
  paidPeriodRef,
  reduceBillingLifecycle,
  STRIPE_SUBSCRIPTION_STATUSES,
  trialRef,
  type LifecycleRecord,
  type ProviderSubscription,
} from "@/lib/domain/billing-lifecycle"
import { deriveAccess, type BillingRecord } from "@/lib/domain/entitlements"

const DAY = 24 * 60 * 60 * 1000
const at = (iso: string) => new Date(iso)

const PERIOD_START = at("2026-11-01T00:00:00Z")
const PERIOD_END = at("2026-12-01T00:00:00Z")

function subscription(
  overrides: Partial<ProviderSubscription> = {}
): ProviderSubscription {
  return {
    id: "sub_1",
    status: "active",
    livemode: false,
    priceId: "price_basic",
    itemCount: 1,
    trialStart: null,
    trialEnd: null,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    latestInvoice: {
      id: "in_1",
      status: "paid",
      amountPaid: 2900,
      billingReason: "subscription_cycle",
    },
    paymentSucceeded: true,
    pending: null,
    ...overrides,
  }
}

const record = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  state: "active",
  stripeSubscriptionId: "sub_1",
  firstPaymentSucceeded: true,
  ...overrides,
})

function applied(decision: ReturnType<typeof reduceBillingLifecycle>) {
  if (decision.action !== "apply") {
    throw new Error(`expected apply, got ${JSON.stringify(decision)}`)
  }
  return decision
}

/** The access the written record derives, with a plan in place. */
function accessAfter(
  decision: ReturnType<typeof reduceBillingLifecycle>,
  now: Date
) {
  const { patch } = applied(decision)
  const billing: BillingRecord = {
    state: patch.state,
    trialEndsAt: patch.trialEndsAt,
    currentPeriodStart: patch.currentPeriodStart,
    currentPeriodEnd: patch.currentPeriodEnd,
    graceEndsAt: patch.graceEndsAt,
    cancelAtPeriodEnd: patch.cancelAtPeriodEnd,
    firstPaymentSucceeded: patch.firstPaymentSucceeded,
    pendingEffectiveAt: patch.pendingEffectiveAt,
  }
  return deriveAccess(
    billing,
    { current: { locationLimit: 5, memberLimit: null }, pending: null },
    now
  )
}

describe("reduceBillingLifecycle: every Stripe status", () => {
  const table: Array<{
    status: string
    expected: string
    grant: "trial" | "paid_period" | null
  }> = [
    { status: "trialing", expected: "trialing", grant: "trial" },
    { status: "active", expected: "active", grant: "paid_period" },
    { status: "past_due", expected: "past_due", grant: null },
    { status: "unpaid", expected: "read_only", grant: null },
    { status: "paused", expected: "read_only", grant: null },
    { status: "canceled", expected: "canceled", grant: null },
    { status: "incomplete", expected: "none", grant: null },
    { status: "incomplete_expired", expected: "none", grant: null },
  ]

  it("covers the SDK's whole status list", () => {
    expect(table.map((row) => row.status).sort()).toEqual(
      [...STRIPE_SUBSCRIPTION_STATUSES].sort()
    )
  })

  for (const row of table) {
    it(`${row.status} -> ${row.expected}`, () => {
      const decision = reduceBillingLifecycle(
        record(),
        subscription({
          status: row.status,
          trialStart: PERIOD_START,
          trialEnd: at("2026-11-15T00:00:00Z"),
        })
      )
      if (row.expected === "none") {
        expect(decision).toEqual({
          action: "none",
          reason: "subscription_not_started",
        })
        return
      }
      const { patch, grant } = applied(decision)
      expect(patch.state).toBe(row.expected)
      expect(grant?.kind ?? null).toBe(row.grant)
    })
  }

  it("rejects a status it does not know instead of guessing", () => {
    expect(
      reduceBillingLifecycle(record(), subscription({ status: "frozen" }))
    ).toEqual({ action: "reject", code: "subscription_status_unknown" })
  })

  it("rejects a subscription with other than one price", () => {
    expect(
      reduceBillingLifecycle(record(), subscription({ itemCount: 2 }))
    ).toEqual({ action: "reject", code: "subscription_shape_unsupported" })
    expect(
      reduceBillingLifecycle(record(), subscription({ priceId: null }))
    ).toEqual({ action: "reject", code: "subscription_shape_unsupported" })
  })

  it("rejects a running subscription with no period", () => {
    expect(
      reduceBillingLifecycle(record(), subscription({ currentPeriodEnd: null }))
    ).toEqual({ action: "reject", code: "subscription_period_missing" })
  })

  it("rejects a trial with no end", () => {
    expect(
      reduceBillingLifecycle(
        record(),
        subscription({ status: "trialing", trialEnd: null })
      )
    ).toEqual({ action: "reject", code: "subscription_trial_end_missing" })
  })
})

describe("trial", () => {
  const trialEnd = at("2026-11-15T00:00:00Z")
  const trial = subscription({
    status: "trialing",
    trialStart: PERIOD_START,
    trialEnd,
    currentPeriodEnd: trialEnd,
    latestInvoice: {
      id: "in_0",
      status: "paid",
      amountPaid: 0,
      billingReason: "subscription_create",
    },
    paymentSucceeded: false,
  })

  it("converts a pilot and grants one trial allowance", () => {
    const decision = applied(
      reduceBillingLifecycle(
        record({
          state: "pilot",
          stripeSubscriptionId: null,
          firstPaymentSucceeded: false,
        }),
        trial
      )
    )
    expect(decision.convertsPilot).toBe(true)
    expect(decision.patch).toMatchObject({
      state: "trialing",
      trialEndsAt: trialEnd,
      stripeSubscriptionId: "sub_1",
      environment: "test",
      firstPaymentSucceeded: false,
    })
    expect(decision.grant).toEqual({
      kind: "trial",
      startsAt: PERIOD_START,
      endsAt: trialEnd,
      sourceRef: trialRef("sub_1"),
    })
  })

  it("keeps the same grant reference on every replay", () => {
    const first = applied(
      reduceBillingLifecycle(record({ state: "trialing" }), trial)
    )
    const second = applied(
      reduceBillingLifecycle(record({ state: "trialing" }), trial)
    )
    expect(first.grant).toEqual(second.grant)
    expect(first.convertsPilot).toBe(false)
  })

  it("does not convert a pilot whose checkout never started a subscription", () => {
    const pilot = record({ state: "pilot", stripeSubscriptionId: null })
    expect(
      reduceBillingLifecycle(pilot, subscription({ status: "incomplete" }))
    ).toMatchObject({ action: "none" })
    expect(reduceBillingLifecycle(pilot, null)).toEqual({
      action: "none",
      reason: "no_subscription",
    })
  })

  it("fails the first payment at trial end without grace", () => {
    const decision = reduceBillingLifecycle(
      record({ state: "trialing", firstPaymentSucceeded: false }),
      subscription({
        status: "past_due",
        trialEnd,
        currentPeriodStart: trialEnd,
        currentPeriodEnd: at("2026-12-15T00:00:00Z"),
        latestInvoice: {
          id: "in_2",
          status: "open",
          amountPaid: 0,
          billingReason: "subscription_cycle",
        },
        paymentSucceeded: false,
      })
    )
    const { patch, grant } = applied(decision)
    expect(patch).toMatchObject({
      state: "past_due",
      firstPaymentSucceeded: false,
      graceEndsAt: null,
    })
    expect(grant).toBeNull()
    expect(accessAfter(decision, at("2026-11-15T02:00:00Z"))).toMatchObject({
      mode: "read_only",
      reason: "first_payment_failed",
    })
  })

  it("ends a trial with no payment method in read-only", () => {
    const decision = reduceBillingLifecycle(
      record({ state: "trialing", firstPaymentSucceeded: false }),
      subscription({ status: "paused", paymentSucceeded: false })
    )
    expect(applied(decision).patch.state).toBe("read_only")
    expect(accessAfter(decision, PERIOD_START).mode).toBe("read_only")
  })
})

describe("paid periods", () => {
  it("grants a paid period only once its invoice is paid", () => {
    const open = applied(
      reduceBillingLifecycle(
        record(),
        subscription({
          latestInvoice: {
            id: "in_3",
            status: "open",
            amountPaid: 0,
            billingReason: "subscription_cycle",
          },
        })
      )
    )
    expect(open.patch.state).toBe("active")
    expect(open.grant).toBeNull()

    const paid = applied(reduceBillingLifecycle(record(), subscription()))
    expect(paid.grant).toEqual({
      kind: "paid_period",
      startsAt: PERIOD_START,
      endsAt: PERIOD_END,
      sourceRef: paidPeriodRef("sub_1", PERIOD_START),
    })
  })

  it("gives the same period the same reference, a new period a new one", () => {
    const next = subscription({
      currentPeriodStart: PERIOD_END,
      currentPeriodEnd: at("2027-01-01T00:00:00Z"),
    })
    const a = applied(reduceBillingLifecycle(record(), subscription())).grant
    const b = applied(reduceBillingLifecycle(record(), subscription())).grant
    const c = applied(reduceBillingLifecycle(record(), next)).grant
    expect(a?.sourceRef).toBe(b?.sourceRef)
    expect(c?.sourceRef).not.toBe(a?.sourceRef)
  })

  it("keeps access to the period end when cancellation is scheduled", () => {
    const decision = reduceBillingLifecycle(
      record(),
      subscription({ cancelAtPeriodEnd: true })
    )
    expect(applied(decision).patch.cancelAtPeriodEnd).toBe(true)
    expect(accessAfter(decision, at("2026-11-20T00:00:00Z"))).toMatchObject({
      mode: "full",
      reason: "cancel_scheduled",
    })
    expect(accessAfter(decision, PERIOD_END).mode).toBe("read_only")
  })

  it("records a waiting plan change", () => {
    const decision = applied(
      reduceBillingLifecycle(
        record(),
        subscription({
          pending: { priceId: "price_small", effectiveAt: PERIOD_END },
        })
      )
    )
    expect(decision.patch).toMatchObject({
      pendingPriceId: "price_small",
      pendingEffectiveAt: PERIOD_END,
    })
  })
})

describe("failed renewal grace", () => {
  const failed = subscription({
    status: "past_due",
    latestInvoice: {
      id: "in_4",
      status: "open",
      amountPaid: 0,
      billingReason: "subscription_cycle",
    },
    paymentSucceeded: false,
  })

  it("gives seven days from the failed boundary and no new allowance", () => {
    const decision = reduceBillingLifecycle(record(), failed)
    const { patch, grant } = applied(decision)
    expect(patch.graceEndsAt).toEqual(
      new Date(PERIOD_START.getTime() + 7 * DAY)
    )
    expect(patch.firstPaymentSucceeded).toBe(true)
    expect(grant).toBeNull()
    const justBefore = new Date(PERIOD_START.getTime() + 7 * DAY - 1)
    expect(accessAfter(decision, justBefore)).toMatchObject({
      mode: "grace",
      reason: "payment_grace",
    })
    expect(
      accessAfter(decision, new Date(PERIOD_START.getTime() + 7 * DAY))
    ).toMatchObject({ mode: "read_only", reason: "grace_expired" })
  })

  it("knows the first payment succeeded from Stripe when the record does not", () => {
    const decision = reduceBillingLifecycle(
      record({ firstPaymentSucceeded: false }),
      subscription({ ...failed, paymentSucceeded: true })
    )
    expect(applied(decision).patch.graceEndsAt).not.toBeNull()
  })

  it("ends in read-only when Stripe stops retrying", () => {
    const decision = reduceBillingLifecycle(
      record({ state: "past_due" }),
      subscription({ ...failed, status: "unpaid" })
    )
    expect(applied(decision).patch).toMatchObject({
      state: "read_only",
      graceEndsAt: null,
    })
  })

  it("restores access and grants the recovered period once", () => {
    for (const from of ["past_due", "read_only"] as const) {
      const decision = applied(
        reduceBillingLifecycle(record({ state: from }), subscription())
      )
      expect(decision.patch.state).toBe("active")
      expect(decision.patch.graceEndsAt).toBeNull()
      expect(decision.grant?.sourceRef).toBe(
        paidPeriodRef("sub_1", PERIOD_START)
      )
    }
  })
})

describe("ended subscriptions", () => {
  it("cancels a record whose subscription the provider no longer has", () => {
    expect(reduceBillingLifecycle(record(), null)).toEqual({
      action: "canceled_missing",
    })
    expect(reduceBillingLifecycle(record({ state: "canceled" }), null)).toEqual(
      { action: "none", reason: "no_subscription" }
    )
  })

  it("clears a scheduled change and cancellation flag when canceled", () => {
    const decision = applied(
      reduceBillingLifecycle(
        record(),
        subscription({
          status: "canceled",
          cancelAtPeriodEnd: true,
          pending: { priceId: "price_small", effectiveAt: PERIOD_END },
        })
      )
    )
    expect(decision.patch).toMatchObject({
      state: "canceled",
      cancelAtPeriodEnd: false,
      pendingPriceId: null,
      pendingEffectiveAt: null,
    })
  })

  it("records the environment from the subscription's mode", () => {
    expect(
      applied(
        reduceBillingLifecycle(record(), subscription({ livemode: true }))
      ).patch.environment
    ).toBe("live")
  })
})

describe("chooseSubscription", () => {
  const sub = (id: string, status: string, created: number) => ({
    id,
    status,
    created,
  })

  it("prefers the newest running subscription", () => {
    expect(
      chooseSubscription(
        [
          sub("sub_old", "canceled", 1),
          sub("sub_live", "active", 2),
          sub("sub_new", "incomplete", 3),
        ],
        "sub_old"
      )?.id
    ).toBe("sub_live")
  })

  it("falls back to the recorded one, then the newest", () => {
    expect(
      chooseSubscription(
        [sub("sub_a", "canceled", 1), sub("sub_b", "canceled", 2)],
        "sub_a"
      )?.id
    ).toBe("sub_a")
    expect(
      chooseSubscription(
        [sub("sub_a", "canceled", 1), sub("sub_b", "incomplete_expired", 2)],
        null
      )?.id
    ).toBe("sub_b")
    expect(chooseSubscription([], null)).toBeNull()
  })
})
