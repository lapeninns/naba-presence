import "server-only"

import type Stripe from "stripe"
import type { TransactionSql } from "postgres"

import {
  chooseSubscription,
  reduceBillingLifecycle,
  type LifecyclePatch,
  type ProviderSubscription,
} from "@/lib/domain/billing-lifecycle"
import type { BillingState } from "@/lib/domain/entitlements"
import { writeAudit } from "@/lib/server/audit"
import {
  lockOrganisationBilling,
  type OrganisationBilling,
} from "@/lib/server/billing/state"
import {
  billingConfig,
  getStripe,
  type BillingEnvironment,
} from "@/lib/server/billing/stripe"
import { getDatabase, jsonColumn, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { log } from "@/lib/server/logger"
import {
  loadPauseSnapshot,
  scopesEnabled,
  type PauseSnapshot,
} from "@/lib/server/pause-controls"

/**
 * Stripe event processing and reconciliation (plan P07-S4).
 *
 * /api/webhooks/stripe only records a verified receipt (billing_event,
 * migration 0225). The job tick claims due receipts here, resolves each
 * one's organisation from its Stripe customer and syncs that organisation:
 * under its billing row lock (FOR UPDATE, so one organisation's events and
 * reconciliations apply one at a time) it fetches the customer's current
 * subscription from Stripe, runs the pure lifecycle reducer
 * (lib/domain/billing-lifecycle.ts), writes the record, closes a converting
 * pilot's month and grants at most one AI credit period per trial or paid
 * period. Because the provider state is fetched, the event's own payload is
 * never trusted or stored, and duplicate or reordered events converge.
 *
 * The hourly reconciliation (/api/billing/reconcile) runs the same sync for
 * every organisation with a Stripe customer, so a lost webhook is repaired
 * within the hour. Neither depends on the Google sync flags.
 *
 * Everything fails closed: billing disabled or misconfigured, or the
 * `billing` pause scope paused, processes nothing (receipts wait); an
 * unknown price, an environment mismatch or an unexpected subscription
 * shape fails the event, which retries and then dead-letters for an
 * operator, leaving the record as it was.
 */

/** Attempts before an event is dead-lettered. */
export const BILLING_EVENT_MAX_RETRIES = 8
/** Covers the slowest sync: three Stripe calls of 10s, with one retry each. */
const LEASE_SECONDS = 120
const CLAIM_BATCH = 10
/** An event for a customer no organisation has yet. */
const HELD_RETRY_SECONDS = 15 * 60
const FAILED_RETRY_BASE_SECONDS = 60
const FAILED_RETRY_CAP_SECONDS = 60 * 60

/** The event families the processor acts on; the rest are kept as ignored. */
export const HANDLED_EVENT_PREFIXES = [
  "customer.subscription.",
  "invoice.",
  "checkout.session.",
  "subscription_schedule.",
] as const

export function isHandledEventType(type: string): boolean {
  return HANDLED_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix))
}

export function failedRetrySeconds(attempt: number): number {
  return Math.min(
    FAILED_RETRY_CAP_SECONDS,
    FAILED_RETRY_BASE_SECONDS * 2 ** Math.max(0, attempt - 1)
  )
}

/** A sync that must not be applied; `code` is stored on the event. */
export class BillingSyncError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const LIVE_SUBSCRIPTION_STATES: readonly BillingState[] = [
  "trialing",
  "active",
  "past_due",
  "grace",
]

const fromEpoch = (seconds: number | null | undefined) =>
  typeof seconds === "number" ? new Date(seconds * 1000) : null

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null)

/**
 * The customer's subscription as the lifecycle needs it, fetched now. The
 * newest running subscription wins (lib/domain/billing-lifecycle.ts
 * chooseSubscription). Extra calls only when needed: the paid-invoice
 * history for a failed payment the record cannot already explain, and the
 * schedule when a plan change waits.
 */
export async function fetchProviderSubscription(
  stripe: Stripe,
  customerId: string,
  record: Pick<
    OrganisationBilling,
    "stripeSubscriptionId" | "firstPaymentSucceeded"
  >,
  now: Date = new Date()
): Promise<ProviderSubscription | null> {
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
    expand: ["data.latest_invoice"],
  })
  const subscription = chooseSubscription(
    list.data,
    record.stripeSubscriptionId
  )
  if (!subscription) return null

  const items = subscription.items?.data ?? []
  const item = items[0]
  const latest =
    subscription.latest_invoice &&
    typeof subscription.latest_invoice === "object"
      ? subscription.latest_invoice
      : null

  let paymentSucceeded = record.firstPaymentSucceeded
  if (
    !paymentSucceeded &&
    (subscription.status === "past_due" || subscription.status === "unpaid")
  ) {
    const paid = await stripe.invoices.list({
      subscription: subscription.id,
      status: "paid",
      limit: 24,
    })
    paymentSucceeded = paid.data.some(
      (invoice) =>
        invoice.amount_paid > 0 ||
        invoice.billing_reason === "subscription_cycle"
    )
  }

  let pending: ProviderSubscription["pending"] = null
  const scheduleId = idOf(subscription.schedule)
  if (scheduleId) {
    const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
    const next = schedule.phases
      .filter((phase) => phase.start_date * 1000 > now.getTime())
      .sort((a, b) => a.start_date - b.start_date)[0]
    const nextPrice = next?.items?.[0]?.price
    const nextPriceId = idOf(nextPrice as string | { id: string } | undefined)
    if (next && nextPriceId && nextPriceId !== item?.price?.id) {
      pending = {
        priceId: nextPriceId,
        effectiveAt: new Date(next.start_date * 1000),
      }
    }
  }

  return {
    id: subscription.id,
    status: subscription.status,
    livemode: subscription.livemode,
    priceId: item?.price?.id ?? null,
    itemCount: items.length,
    trialStart: fromEpoch(subscription.trial_start),
    trialEnd: fromEpoch(subscription.trial_end),
    currentPeriodStart: fromEpoch(item?.current_period_start),
    currentPeriodEnd: fromEpoch(item?.current_period_end),
    // Newer API versions schedule a portal cancellation with `cancel_at`.
    cancelAtPeriodEnd:
      subscription.cancel_at_period_end || subscription.cancel_at !== null,
    latestInvoice: latest
      ? {
          id: latest.id ?? "",
          status: latest.status ?? null,
          amountPaid: latest.amount_paid,
          billingReason: latest.billing_reason ?? null,
        }
      : null,
    paymentSucceeded,
    pending,
  }
}

type PlanRow = { id: string; credits: number }

async function planForPrice(
  sql: TransactionSql,
  priceId: string,
  environment: BillingEnvironment
): Promise<PlanRow | null> {
  const [plan] = await sql<PlanRow[]>`
    select id::text as id, ai_draft_credits_per_period as credits
    from billing_plan
    where stripe_price_id = ${priceId}
      and environment = ${environment}
  `
  return plan ?? null
}

export type SyncTrigger =
  { kind: "event"; eventIds: string[] } | { kind: "reconcile" }

export type SyncResult = {
  outcome: "applied" | "unchanged" | "no_customer"
  from: BillingState | null
  to: BillingState | null
  grantedPeriodId: string | null
}

const INTEGRITY_CODES = new Set([
  "billing_plan_environment_mismatch",
  "billing_plan_workspace_mode_mismatch",
])

/** The stable code for a failed sync, safe to store and log. */
export function syncErrorCode(error: unknown): string {
  if (error instanceof BillingSyncError) return error.code
  if (error && typeof error === "object") {
    const record = error as {
      code?: unknown
      message?: unknown
      type?: unknown
    }
    if (record.code === "23514" && typeof record.message === "string") {
      if (INTEGRITY_CODES.has(record.message)) return record.message
      return "billing_record_rejected"
    }
    if (typeof record.type === "string" && record.type.startsWith("Stripe")) {
      return record.type === "StripeConnectionError" ||
        record.type === "StripeAPIError" ||
        record.type === "StripeRateLimitError"
        ? "stripe_unavailable"
        : "stripe_request_failed"
    }
  }
  return "internal_error"
}

function snapshotOf(subscription: ProviderSubscription | null) {
  if (!subscription) return { subscriptionId: null }
  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    priceId: subscription.priceId,
    currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    trialEnd: subscription.trialEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    latestInvoiceStatus: subscription.latestInvoice?.status ?? null,
    pendingPriceId: subscription.pending?.priceId ?? null,
  }
}

/**
 * Brings one organisation's billing record in line with Stripe. Runs in its
 * own tenant transaction holding the billing row lock for the whole fetch
 * and write, so concurrent syncs of one organisation apply in turn and the
 * last one to commit wrote the freshest provider state.
 */
export async function syncOrganisationBilling(options: {
  stripe: Stripe
  organisationId: string
  environment: BillingEnvironment
  trigger: SyncTrigger
  requestId: string
}): Promise<SyncResult> {
  const { stripe, organisationId, environment, trigger, requestId } = options
  return withTenant(organisationId, async (sql) => {
    const view = await lockOrganisationBilling(sql, organisationId)
    const record = view.billing
    if (!record) throw new BillingSyncError("billing_missing")
    if (!record.stripeCustomerId) {
      return {
        outcome: "no_customer",
        from: record.state,
        to: record.state,
        grantedPeriodId: null,
      }
    }

    const subscription = await fetchProviderSubscription(
      stripe,
      record.stripeCustomerId,
      record
    )
    if (subscription && subscription.livemode !== (environment === "live")) {
      throw new BillingSyncError("billing_environment_mismatch")
    }
    const decision = reduceBillingLifecycle(record, subscription)
    const audit = (action: string, metadata: Record<string, unknown>) =>
      writeAudit(sql, {
        organisationId,
        action,
        subjectType: "organisation_billing",
        subjectId: organisationId,
        requestId,
        metadata: {
          ...metadata,
          trigger: trigger.kind,
          eventIds: trigger.kind === "event" ? trigger.eventIds : undefined,
        },
      })

    if (decision.action === "reject") throw new BillingSyncError(decision.code)

    if (decision.action === "none") {
      await sql`
        update organisation_billing
        set provider_synced_at = now()
        where organisation_id = ${organisationId}
      `
      return {
        outcome: "unchanged",
        from: record.state,
        to: record.state,
        grantedPeriodId: null,
      }
    }

    if (decision.action === "canceled_missing") {
      await sql`
        update organisation_billing
        set
          state = 'canceled',
          cancel_at_period_end = false,
          grace_ends_at = null,
          pending_plan_id = null,
          pending_effective_at = null,
          provider_snapshot = ${jsonColumn(sql, snapshotOf(null))},
          provider_synced_at = now(),
          version = version + 1,
          updated_at = now()
        where organisation_id = ${organisationId}
      `
      await audit("billing.state_changed", {
        from: record.state,
        to: "canceled",
        reason: "subscription_missing",
      })
      return {
        outcome: "applied",
        from: record.state,
        to: "canceled",
        grantedPeriodId: null,
      }
    }

    const patch: LifecyclePatch = decision.patch
    const plan = patch.priceId
      ? await planForPrice(sql, patch.priceId, patch.environment)
      : null
    if (!plan && LIVE_SUBSCRIPTION_STATES.includes(patch.state)) {
      throw new BillingSyncError("billing_plan_unknown")
    }
    const pendingPlan = patch.pendingPriceId
      ? await planForPrice(sql, patch.pendingPriceId, patch.environment)
      : null
    if (patch.pendingPriceId && !pendingPlan) {
      throw new BillingSyncError("billing_plan_unknown")
    }

    await sql`
      update organisation_billing
      set
        state = ${patch.state},
        plan_id = ${plan?.id ?? record.planId},
        pending_plan_id = ${pendingPlan?.id ?? null},
        pending_effective_at = ${pendingPlan ? patch.pendingEffectiveAt : null},
        stripe_subscription_id = ${patch.stripeSubscriptionId},
        environment = ${patch.environment},
        trial_ends_at = ${patch.trialEndsAt},
        current_period_start = ${patch.currentPeriodStart},
        current_period_end = ${patch.currentPeriodEnd},
        grace_ends_at = ${patch.graceEndsAt},
        cancel_at_period_end = ${patch.cancelAtPeriodEnd},
        first_payment_succeeded = ${patch.firstPaymentSucceeded},
        provider_snapshot = ${jsonColumn(sql, snapshotOf(subscription))},
        provider_synced_at = now(),
        version = version + 1,
        updated_at = now()
      where organisation_id = ${organisationId}
    `

    if (decision.convertsPilot) {
      // The owner converted: the pilot's calendar month ends now. Its usage
      // stays attributed to it; new work draws on the trial or paid grant.
      const closed = await sql<{ id: string }[]>`
        update ai_credit_period
        set ends_at = greatest(now(), starts_at + interval '1 second')
        where organisation_id = ${organisationId}
          and kind = 'pilot_month'
          and ends_at > now()
        returning id::text as id
      `
      await audit("billing.pilot_converted", {
        subscriptionId: patch.stripeSubscriptionId,
        closedPeriodIds: closed.map((row) => row.id),
      })
    }

    let grantedPeriodId: string | null = null
    if (decision.grant && plan) {
      const [granted] = await sql<{ id: string }[]>`
        insert into ai_credit_period (
          organisation_id, kind, starts_at, ends_at, allowance, source_ref
        )
        values (
          ${organisationId},
          ${decision.grant.kind},
          ${decision.grant.startsAt},
          ${decision.grant.endsAt},
          ${plan.credits},
          ${decision.grant.sourceRef}
        )
        on conflict (organisation_id, kind, source_ref) do nothing
        returning id::text as id
      `
      if (granted) {
        grantedPeriodId = granted.id
        await audit("billing.credit_period_granted", {
          periodId: granted.id,
          kind: decision.grant.kind,
          allowance: plan.credits,
          startsAt: decision.grant.startsAt.toISOString(),
          endsAt: decision.grant.endsAt.toISOString(),
        })
      }
    }

    if (patch.state !== record.state) {
      await audit("billing.state_changed", {
        from: record.state,
        to: patch.state,
        subscriptionId: patch.stripeSubscriptionId,
        providerStatus: subscription?.status ?? null,
      })
    }
    return {
      outcome: "applied",
      from: record.state,
      to: patch.state,
      grantedPeriodId,
    }
  })
}

type ClaimedEvent = {
  id: string
  externalEventId: string
  eventType: string
  stripeCustomerId: string | null
  organisationId: string | null
  retryCount: number
}

export type BillingTickSummary = {
  status: "ran" | "disabled" | "paused"
  reason?: string
  processed: number
  held: number
  failed: number
  dead: number
}

async function settle(
  eventId: string,
  outcome: "processed" | "held" | "failed",
  errorCode: string | null,
  retrySeconds: number
): Promise<string> {
  const [row] = await getDatabase()<{ status: string }[]>`
    select settle_billing_event(
      ${eventId}::uuid,
      ${outcome},
      ${errorCode},
      ${retrySeconds},
      ${BILLING_EVENT_MAX_RETRIES}
    ) as status
  `
  return row?.status ?? "stale"
}

/**
 * Whether billing work may run now: enabled and configured
 * (lib/server/billing/stripe.ts) and not paused by an operator.
 */
export function billingWorkGate(
  snapshot: PauseSnapshot
):
  | { ok: true; environment: BillingEnvironment }
  | { ok: false; status: "disabled" | "paused"; reason: string } {
  const config = billingConfig()
  if (!config.ok)
    return { ok: false, status: "disabled", reason: config.reason }
  if (!scopesEnabled(getServerEnv(), snapshot, ["billing"])) {
    return { ok: false, status: "paused", reason: "billing_paused" }
  }
  return { ok: true, environment: config.environment }
}

/**
 * Processes due Stripe events within `budgetMs`. One sync per organisation
 * per claimed batch however many of its events were claimed; an event with
 * no organisation yet is held, never dropped.
 */
export async function processBillingEvents(options: {
  budgetMs: number
  requestId: string
  stripe?: Stripe
  pauses?: PauseSnapshot
}): Promise<BillingTickSummary> {
  const summary: BillingTickSummary = {
    status: "ran",
    processed: 0,
    held: 0,
    failed: 0,
    dead: 0,
  }
  const gate = billingWorkGate(options.pauses ?? (await loadPauseSnapshot()))
  if (!gate.ok) return { ...summary, status: gate.status, reason: gate.reason }
  const stripe = options.stripe ?? getStripe()
  const deadline = Date.now() + Math.max(0, options.budgetMs)

  while (Date.now() < deadline) {
    const claimed = await getDatabase()<ClaimedEvent[]>`
      select
        id::text as id,
        external_event_id as "externalEventId",
        event_type as "eventType",
        stripe_customer_id as "stripeCustomerId",
        organisation_id::text as "organisationId",
        retry_count as "retryCount"
      from claim_billing_events(
        ${CLAIM_BATCH}, ${LEASE_SECONDS}, ${BILLING_EVENT_MAX_RETRIES}
      )
    `
    if (claimed.length === 0) break

    const byOrganisation = new Map<string, ClaimedEvent[]>()
    for (const event of claimed) {
      if (!event.organisationId) {
        // No organisation has this customer (yet): checkout records the
        // customer before Stripe can send anything about it, so this is a
        // foreign or early event. Kept and retried; reconciliation covers
        // the organisation once it is linked.
        await settle(event.id, "held", "customer_unknown", HELD_RETRY_SECONDS)
        summary.held += 1
        log.warn("billing.event_held", {
          eventId: event.externalEventId,
          eventType: event.eventType,
        })
        continue
      }
      const group = byOrganisation.get(event.organisationId) ?? []
      group.push(event)
      byOrganisation.set(event.organisationId, group)
    }

    for (const [organisationId, events] of byOrganisation) {
      try {
        await syncOrganisationBilling({
          stripe,
          organisationId,
          environment: gate.environment,
          trigger: {
            kind: "event",
            eventIds: events.map((event) => event.externalEventId),
          },
          requestId: `billing:${events[0].externalEventId}`,
        })
        for (const event of events) {
          await settle(event.id, "processed", null, 0)
          summary.processed += 1
        }
      } catch (error) {
        const code = syncErrorCode(error)
        log.error("billing.event_failed", {
          organisationId,
          eventIds: events.map((event) => event.externalEventId),
          code,
          error: error instanceof Error ? error.message : String(error),
        })
        for (const event of events) {
          const status = await settle(
            event.id,
            "failed",
            code,
            failedRetrySeconds(event.retryCount + 1)
          )
          if (status === "dead") {
            summary.dead += 1
            await withTenant(organisationId, (sql) =>
              writeAudit(sql, {
                organisationId,
                action: "billing.event_dead",
                subjectType: "billing_event",
                subjectId: event.id,
                requestId: `billing:${event.externalEventId}:dead`,
                metadata: { eventType: event.eventType, code },
              })
            ).catch(() => undefined)
          } else {
            summary.failed += 1
          }
        }
      }
    }
  }
  return summary
}

export type ReconcilePageResult = {
  enabled: boolean
  reason?: string
  processed: number
  nextCursor: string | null
  failures: Array<{ organisationId: string; errorCode: string }>
}

/**
 * One page of the hourly reconciliation walk over every organisation with a
 * Stripe customer, from `organisationCursor`. A page that runs out of budget
 * or fills `maxOrganisations` returns the cursor to resume from.
 */
export async function reconcileBillingPage(options: {
  input: { maxOrganisations: number; organisationCursor?: string }
  requestId: string
  budgetMs: number
  environment: BillingEnvironment
  stripe?: Stripe
}): Promise<ReconcilePageResult> {
  const { input, requestId, environment } = options
  const stripe = options.stripe ?? getStripe()
  const deadline = Date.now() + Math.max(0, options.budgetMs)
  const rows = await getDatabase()<{ id: string }[]>`
    select organisation_id::text as id
    from billing_reconcile_page(
      ${input.organisationCursor ?? null}::uuid,
      ${input.maxOrganisations}
    )
  `
  const failures: ReconcilePageResult["failures"] = []
  let processed = 0
  let budgetExhausted = false
  let last: string | null = input.organisationCursor ?? null
  for (const { id } of rows) {
    if (processed > 0 && Date.now() >= deadline) {
      budgetExhausted = true
      break
    }
    try {
      await syncOrganisationBilling({
        stripe,
        organisationId: id,
        environment,
        trigger: { kind: "reconcile" },
        requestId: `${requestId}:${id}`,
      })
    } catch (error) {
      const errorCode = syncErrorCode(error)
      failures.push({ organisationId: id, errorCode })
      log.error("billing.reconcile_failed", {
        organisationId: id,
        errorCode,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    processed += 1
    last = id
  }
  const nextCursor =
    budgetExhausted || rows.length === input.maxOrganisations ? last : null
  return { enabled: true, processed, nextCursor, failures }
}
