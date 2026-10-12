/**
 * The billing lifecycle state machine (plan P07-S4). Pure: it maps the
 * provider's CURRENT subscription, as the processor just fetched it from
 * Stripe, onto the organisation's billing record. Events are only triggers,
 * so a duplicate, late or reordered event changes nothing that the provider
 * state does not already say.
 *
 * Stripe subscription status -> organisation_billing.state:
 *   trialing            trialing; one trial allowance per subscription;
 *   active              active; the first payment has succeeded; one paid
 *                       allowance per period, granted once its invoice is
 *                       paid (a renewal that later fails grants nothing);
 *   past_due            past_due. After a successful first payment: grace
 *                       until the failed boundary (current period start)
 *                       plus GRACE_PERIOD_DAYS, with no new allowance. A
 *                       failed FIRST payment (trial end) gets no grace;
 *                       deriveAccess reads it as read-only;
 *   unpaid, paused      read_only (Stripe stopped retrying, or a trial ended
 *                       with no payment method);
 *   canceled            canceled;
 *   incomplete,
 *   incomplete_expired  nothing: the subscription never started, so a pilot
 *                       stays a pilot and an ended subscription stays ended.
 *
 * Recovery (past_due, unpaid or read_only, then active with its invoice
 * paid) restores access and grants that period once: the grant's source
 * reference is the subscription and period start, unique per organisation.
 * A scheduled cancellation keeps access to the period end
 * (deriveAccess "cancel_scheduled").
 *
 * A pilot that gets a subscription has converted. Only its owner can start
 * that (a pilot has no Stripe customer until checkout creates one), and it
 * is the only thing that closes the pilot's calendar-month allowance.
 */

import { GRACE_PERIOD_DAYS, type BillingState } from "@/lib/domain/entitlements"

/** Checkout's card-required trial length (P07-S5 creates it). */
export const TRIAL_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

export const STRIPE_SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
  "canceled",
  "incomplete",
  "incomplete_expired",
] as const

/** Statuses of a subscription that is (still) running. */
export const RUNNING_SUBSCRIPTION_STATUSES: readonly string[] = [
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
]

export type ProviderInvoice = {
  id: string
  status: string | null
  amountPaid: number
  billingReason: string | null
}

/** The fields of a Stripe subscription the lifecycle depends on. */
export type ProviderSubscription = {
  id: string
  status: string
  livemode: boolean
  /** The single price the subscription bills; null when it has none. */
  priceId: string | null
  /** How many items it has: this product sells exactly one. */
  itemCount: number
  trialStart: Date | null
  trialEnd: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  latestInvoice: ProviderInvoice | null
  /** Some payment for it has succeeded (not the free trial-start invoice). */
  paymentSucceeded: boolean
  /** The next phase of its subscription schedule, if a plan change waits. */
  pending: { priceId: string; effectiveAt: Date } | null
}

/** The fields of the stored record the lifecycle reads. */
export type LifecycleRecord = {
  state: BillingState
  stripeSubscriptionId: string | null
  firstPaymentSucceeded: boolean
}

/** What the processor writes; plan ids are resolved from the price ids. */
export type LifecyclePatch = {
  state: BillingState
  stripeSubscriptionId: string
  environment: "test" | "live"
  priceId: string | null
  pendingPriceId: string | null
  pendingEffectiveAt: Date | null
  trialEndsAt: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  graceEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  firstPaymentSucceeded: boolean
}

/** One allowance grant; idempotent on (organisation, kind, sourceRef). */
export type CreditGrant = {
  kind: "trial" | "paid_period"
  startsAt: Date
  endsAt: Date
  sourceRef: string
}

export type LifecycleDecision =
  | { action: "none"; reason: "no_subscription" | "subscription_not_started" }
  | {
      action: "apply"
      patch: LifecyclePatch
      grant: CreditGrant | null
      /** A pilot converting: close its calendar-month allowance. */
      convertsPilot: boolean
    }
  | {
      action: "canceled_missing"
      /** The record named a subscription the provider no longer has. */
    }
  | {
      action: "reject"
      code:
        | "subscription_status_unknown"
        | "subscription_shape_unsupported"
        | "subscription_period_missing"
        | "subscription_trial_end_missing"
    }

const LIVE_RECORD_STATES: readonly BillingState[] = [
  "trialing",
  "active",
  "past_due",
  "grace",
]

const epochSeconds = (at: Date) => Math.floor(at.getTime() / 1000)

/** The grant reference of a subscription's paid period starting at `start`. */
export function paidPeriodRef(subscriptionId: string, start: Date): string {
  return `${subscriptionId}:${epochSeconds(start)}`
}

export function trialRef(subscriptionId: string): string {
  return `${subscriptionId}:trial`
}

/**
 * The next billing record for `record` given the provider's subscription
 * (null: the customer has none). Never reads a clock.
 */
export function reduceBillingLifecycle(
  record: LifecycleRecord,
  subscription: ProviderSubscription | null
): LifecycleDecision {
  if (!subscription) {
    // The record says a subscription is running and the provider has none
    // (deleted with its customer): it ended.
    if (
      record.stripeSubscriptionId &&
      LIVE_RECORD_STATES.includes(record.state)
    ) {
      return { action: "canceled_missing" }
    }
    return { action: "none", reason: "no_subscription" }
  }

  const status = subscription.status
  if (status === "incomplete" || status === "incomplete_expired") {
    return { action: "none", reason: "subscription_not_started" }
  }
  if (!(STRIPE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
    return { action: "reject", code: "subscription_status_unknown" }
  }
  if (subscription.itemCount !== 1 || !subscription.priceId) {
    return { action: "reject", code: "subscription_shape_unsupported" }
  }

  const start = subscription.currentPeriodStart
  const end = subscription.currentPeriodEnd
  if (status !== "canceled" && (!start || !end)) {
    return { action: "reject", code: "subscription_period_missing" }
  }

  const firstPaymentSucceeded =
    record.firstPaymentSucceeded ||
    subscription.paymentSucceeded ||
    status === "active"

  const base: LifecyclePatch = {
    state: record.state,
    stripeSubscriptionId: subscription.id,
    environment: subscription.livemode ? "live" : "test",
    priceId: subscription.priceId,
    pendingPriceId: subscription.pending?.priceId ?? null,
    pendingEffectiveAt: subscription.pending?.effectiveAt ?? null,
    trialEndsAt: subscription.trialEnd,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    graceEndsAt: null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    firstPaymentSucceeded,
  }
  const convertsPilot = record.state === "pilot"
  const apply = (
    patch: Partial<LifecyclePatch> & { state: BillingState },
    grant: CreditGrant | null = null
  ): LifecycleDecision => ({
    action: "apply",
    patch: { ...base, ...patch },
    grant,
    convertsPilot,
  })

  switch (status) {
    case "trialing": {
      const trialEnd = subscription.trialEnd
      if (!trialEnd) {
        return { action: "reject", code: "subscription_trial_end_missing" }
      }
      const trialStart = subscription.trialStart ?? start!
      return apply(
        { state: "trialing" },
        trialEnd.getTime() > trialStart.getTime()
          ? {
              kind: "trial",
              startsAt: trialStart,
              endsAt: trialEnd,
              sourceRef: trialRef(subscription.id),
            }
          : null
      )
    }
    case "active": {
      // Granted once the period's invoice is paid: an `active` subscription
      // whose renewal invoice is still a draft or open has not paid yet.
      const paid = subscription.latestInvoice?.status === "paid"
      return apply(
        { state: "active" },
        paid
          ? {
              kind: "paid_period",
              startsAt: start!,
              endsAt: end!,
              sourceRef: paidPeriodRef(subscription.id, start!),
            }
          : null
      )
    }
    case "past_due":
      return apply({
        state: "past_due",
        graceEndsAt: firstPaymentSucceeded
          ? new Date(start!.getTime() + GRACE_PERIOD_DAYS * DAY_MS)
          : null,
      })
    case "unpaid":
    case "paused":
      return apply({ state: "read_only", cancelAtPeriodEnd: false })
    case "canceled":
      return apply({
        state: "canceled",
        cancelAtPeriodEnd: false,
        pendingPriceId: null,
        pendingEffectiveAt: null,
      })
    default:
      return { action: "reject", code: "subscription_status_unknown" }
  }
}

/**
 * Of a customer's subscriptions, the one billing follows: the newest still
 * running, else the one the record already names, else the newest.
 */
export function chooseSubscription<
  S extends { id: string; status: string; created: number },
>(subscriptions: readonly S[], recordSubscriptionId: string | null): S | null {
  const newestFirst = [...subscriptions].sort((a, b) => b.created - a.created)
  return (
    newestFirst.find((s) => RUNNING_SUBSCRIPTION_STATUSES.includes(s.status)) ??
    newestFirst.find((s) => s.id === recordSubscriptionId) ??
    newestFirst[0] ??
    null
  )
}
