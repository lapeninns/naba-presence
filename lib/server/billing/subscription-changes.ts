import "server-only"

import type Stripe from "stripe"
import type { TransactionSql } from "postgres"

import type { CancelResult, PlanChangeResult } from "@/lib/contracts/billing"
import type { BillingState } from "@/lib/domain/entitlements"
import { writeAudit } from "@/lib/server/audit"
import {
  getPlan,
  planUnavailable,
  requireOfferedPlan,
} from "@/lib/server/billing/catalog"
import {
  requestFingerprint,
  requireBillingReady,
  workspaceModeOf,
} from "@/lib/server/billing/checkout"
import {
  lockOrganisationBilling,
  type OrganisationBilling,
} from "@/lib/server/billing/state"
import { getStripe } from "@/lib/server/billing/stripe"
import { countBillableLocations } from "@/lib/server/entitlement-policy"
import { ApiError } from "@/lib/server/http"
import type { TenantRunner } from "@/lib/server/route"

/**
 * App-controlled plan changes and cancellation (plan P07-S5).
 *
 * Plan change: the new plan bills from the next period boundary (the trial
 * end while trialing), with no proration, through a Stripe subscription
 * schedule: phase one keeps the current price to the boundary, phase two
 * runs the new one, and the schedule then releases the subscription. The
 * record stores the pending plan and its effective time at once, so a
 * downgrade's lower location limit binds new links immediately (0223 and
 * deriveAccess newLinkLimit) while existing links are never removed. A
 * downgrade below the organisation's billable locations is refused (409
 * `location_limit_exceeded`): unlink first. Choosing the current plan drops
 * a scheduled change, even when that plan has since been retired.
 *
 * Cancellation: cancel at period end, or resume. Access continues to the
 * period end (deriveAccess "cancel_scheduled"). Cancelling releases any
 * schedule first, because Stripe refuses cancellation changes on a
 * subscription a schedule manages, and so drops a scheduled plan change.
 *
 * Both run under the billing row lock, check the provider's subscription is
 * the one on record before changing it, and write only the fields they own;
 * the webhook processor (P07-S4) later reads the same state back from
 * Stripe and converges if anything differs.
 */

/** States whose subscription may change plan. */
const CHANGEABLE_STATES: readonly BillingState[] = ["trialing", "active"]
/** States whose subscription may be cancelled or resumed. */
const CANCELLABLE_STATES: readonly BillingState[] = [
  "trialing",
  "active",
  "past_due",
  "grace",
]

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null)

function notChangeable(state: BillingState | null): ApiError {
  return new ApiError(
    409,
    "subscription_not_changeable",
    "This workspace has no subscription that can be changed right now.",
    { details: { state } }
  )
}

function outOfSync(): ApiError {
  return new ApiError(
    409,
    "billing_out_of_sync",
    "The subscription is being updated. Try again in a minute.",
    { retryable: true }
  )
}

function cancelScheduled(): ApiError {
  return new ApiError(
    409,
    "cancel_scheduled",
    "The subscription is set to end. Resume it before changing plan."
  )
}

/** The provider subscription on record, checked against the record. */
async function providerSubscription(
  stripe: Stripe,
  billing: OrganisationBilling
): Promise<Stripe.Subscription> {
  if (!billing.stripeSubscriptionId) throw notChangeable(billing.state)
  const subscription = await stripe.subscriptions.retrieve(
    billing.stripeSubscriptionId
  )
  if (idOf(subscription.customer) !== billing.stripeCustomerId) {
    throw outOfSync()
  }
  return subscription
}

/** Maps the 0222 plan-integrity trigger to the request's plan refusal. */
async function guardPlanWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    const { code, message } = (error ?? {}) as {
      code?: unknown
      message?: unknown
    }
    if (
      code === "23514" &&
      (message === "billing_plan_environment_mismatch" ||
        message === "billing_plan_workspace_mode_mismatch")
    ) {
      throw new ApiError(
        409,
        "plan_unavailable",
        "That plan does not match this workspace's subscription."
      )
    }
    throw error
  }
}

export async function changePlan(options: {
  tenant: TenantRunner
  organisationId: string
  userId: string
  planId: string
  requestId: string
  stripe?: Stripe
}): Promise<PlanChangeResult> {
  const { tenant, organisationId, userId, planId, requestId } = options
  const ready = await requireBillingReady(false)
  const { environment } = ready.config
  const stripe = options.stripe ?? getStripe()

  return tenant(async (sql) => {
    const view = await lockOrganisationBilling(sql, organisationId)
    const billing = view.billing
    if (
      !billing ||
      !CHANGEABLE_STATES.includes(billing.state) ||
      !billing.stripeSubscriptionId ||
      !billing.planId
    ) {
      throw notChangeable(billing?.state ?? null)
    }
    if (billing.cancelAtPeriodEnd) throw cancelScheduled()
    const workspaceMode = await workspaceModeOf(sql, organisationId)
    const audit = (action: string, metadata: Record<string, unknown>) =>
      writeAudit(sql, {
        organisationId,
        actorUserId: userId,
        action,
        subjectType: "organisation_billing",
        subjectId: organisationId,
        requestId,
        metadata,
      })
    const unchanged = (): PlanChangeResult => ({
      outcome: "unchanged",
      pendingPlanId: billing.pendingPlanId,
      pendingEffectiveAt: billing.pendingEffectiveAt?.toISOString() ?? null,
    })

    // Back to the current plan: drop a scheduled change, if any. The
    // current plan may since have been retired or lost its price, so it is
    // checked against the workspace only, not the allowlist.
    // (Postgres prints uuids in lower case; the input may not be.)
    if (planId.toLowerCase() === billing.planId) {
      const current = await getPlan(sql, billing.planId)
      if (
        !current ||
        current.workspaceMode !== workspaceMode ||
        current.environment !== environment
      ) {
        throw planUnavailable()
      }
      if (!billing.pendingPlanId) return unchanged()
      const subscription = await providerSubscription(stripe, billing)
      const scheduleId = idOf(subscription.schedule)
      if (scheduleId) {
        await stripe.subscriptionSchedules.release(
          scheduleId,
          {},
          {
            idempotencyKey: `naba:plan-change-clear:${organisationId}:v${billing.version}`,
          }
        )
      }
      await clearPending(sql, organisationId)
      await audit("billing.plan_change_cleared", {
        planId: billing.planId,
        clearedPlanId: billing.pendingPlanId,
      })
      return {
        outcome: "cleared",
        pendingPlanId: null,
        pendingEffectiveAt: null,
      }
    }
    const target = await requireOfferedPlan(sql, planId, {
      workspaceMode,
      environment,
    })
    if (target.id === billing.pendingPlanId) return unchanged()

    // A downgrade must fit the locations already linked; nothing is ever
    // unlinked for the customer.
    const billableLocations = await countBillableLocations(sql, organisationId)
    if (billableLocations > target.locationLimit) {
      throw new ApiError(
        409,
        "location_limit_exceeded",
        `This plan allows ${target.locationLimit} locations and ${billableLocations} are linked. Unlink locations first.`,
        { details: { billableLocations, limit: target.locationLimit } }
      )
    }

    const current = await getPlan(sql, billing.planId)
    if (!current?.stripePriceId) throw outOfSync()
    const subscription = await providerSubscription(stripe, billing)
    if (!CHANGEABLE_STATES.includes(subscription.status as BillingState)) {
      throw outOfSync()
    }
    if (subscription.cancel_at_period_end || subscription.cancel_at !== null) {
      throw cancelScheduled()
    }
    const items = subscription.items?.data ?? []
    const item = items[0]
    if (items.length !== 1 || item?.price?.id !== current.stripePriceId) {
      throw outOfSync()
    }
    const boundary = item.current_period_end
    if (!boundary || boundary * 1000 <= Date.now()) throw outOfSync()

    const keyBase = `${organisationId}:${target.id}:v${billing.version}`
    let scheduleId = idOf(subscription.schedule)
    let phaseStart: number
    if (scheduleId) {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
      phaseStart =
        schedule.current_phase?.start_date ??
        schedule.phases[0]?.start_date ??
        item.current_period_start
    } else {
      const schedule = await stripe.subscriptionSchedules.create(
        { from_subscription: subscription.id },
        { idempotencyKey: `naba:schedule:${keyBase}` }
      )
      scheduleId = schedule.id
      phaseStart =
        schedule.current_phase?.start_date ??
        schedule.phases[0]?.start_date ??
        item.current_period_start
    }
    const trialEnd =
      subscription.status === "trialing" && subscription.trial_end
        ? subscription.trial_end
        : null
    // The body comes from Stripe's state, which may move between a rolled
    // back attempt and its retry: its fingerprint keeps the key unique.
    const scheduleParams: Stripe.SubscriptionScheduleUpdateParams = {
      end_behavior: "release",
      proration_behavior: "none",
      metadata: {
        organisation_id: organisationId,
        pending_plan_id: target.id,
      },
      phases: [
        {
          items: [{ price: current.stripePriceId, quantity: 1 }],
          start_date: phaseStart,
          end_date: boundary,
          proration_behavior: "none",
          ...(trialEnd ? { trial_end: trialEnd } : {}),
        },
        {
          items: [{ price: target.stripePriceId, quantity: 1 }],
          duration: { interval: "month", interval_count: 1 },
          proration_behavior: "none",
        },
      ],
    }
    await stripe.subscriptionSchedules.update(scheduleId, scheduleParams, {
      idempotencyKey: `naba:plan-change:${keyBase}:${requestFingerprint(scheduleParams)}`,
    })

    const effectiveAt = new Date(boundary * 1000)
    await guardPlanWrite(
      () => sql`
        update organisation_billing
        set pending_plan_id = ${target.id},
          pending_effective_at = ${effectiveAt},
          version = version + 1,
          updated_at = now()
        where organisation_id = ${organisationId}
      `
    )
    const fromLimit = view.plan?.locationLimit ?? null
    await audit("billing.plan_change_scheduled", {
      fromPlanId: billing.planId,
      toPlanId: target.id,
      effectiveAt: effectiveAt.toISOString(),
      direction:
        fromLimit !== null && target.locationLimit < fromLimit
          ? "downgrade"
          : "upgrade_or_same",
      billableLocations,
    })
    return {
      outcome: "scheduled",
      pendingPlanId: target.id,
      pendingEffectiveAt: effectiveAt.toISOString(),
    }
  })
}

async function clearPending(sql: TransactionSql, organisationId: string) {
  await sql`
    update organisation_billing
    set pending_plan_id = null,
      pending_effective_at = null,
      version = version + 1,
      updated_at = now()
    where organisation_id = ${organisationId}
  `
}

export async function setCancelAtPeriodEnd(options: {
  tenant: TenantRunner
  organisationId: string
  userId: string
  cancelAtPeriodEnd: boolean
  requestId: string
  stripe?: Stripe
}): Promise<CancelResult> {
  const { tenant, organisationId, userId, cancelAtPeriodEnd, requestId } =
    options
  await requireBillingReady(false)
  const stripe = options.stripe ?? getStripe()

  return tenant(async (sql) => {
    const view = await lockOrganisationBilling(sql, organisationId)
    const billing = view.billing
    if (
      !billing ||
      !CANCELLABLE_STATES.includes(billing.state) ||
      !billing.stripeSubscriptionId
    ) {
      throw notChangeable(billing?.state ?? null)
    }
    if (billing.cancelAtPeriodEnd === cancelAtPeriodEnd) {
      return {
        outcome: "unchanged",
        cancelAtPeriodEnd,
        clearedPendingPlan: false,
      }
    }
    const subscription = await providerSubscription(stripe, billing)
    const keyBase = `${organisationId}:${cancelAtPeriodEnd ? "cancel" : "resume"}:v${billing.version}`

    let clearedPendingPlan = false
    const scheduleId = idOf(subscription.schedule)
    if (cancelAtPeriodEnd && scheduleId) {
      await stripe.subscriptionSchedules.release(
        scheduleId,
        {},
        { idempotencyKey: `naba:cancel-release:${keyBase}` }
      )
      clearedPendingPlan = billing.pendingPlanId !== null
    }
    // A portal cancellation may have set `cancel_at` instead of the flag;
    // resuming clears whichever one is set.
    const params: Stripe.SubscriptionUpdateParams = cancelAtPeriodEnd
      ? { cancel_at_period_end: true }
      : subscription.cancel_at !== null && !subscription.cancel_at_period_end
        ? { cancel_at: "" }
        : { cancel_at_period_end: false }
    await stripe.subscriptions.update(subscription.id, params, {
      idempotencyKey: `naba:${keyBase}:${requestFingerprint(params)}`,
    })

    await sql`
      update organisation_billing
      set cancel_at_period_end = ${cancelAtPeriodEnd},
        pending_plan_id = case when ${clearedPendingPlan} then null else pending_plan_id end,
        pending_effective_at = case when ${clearedPendingPlan} then null else pending_effective_at end,
        version = version + 1,
        updated_at = now()
      where organisation_id = ${organisationId}
    `
    await writeAudit(sql, {
      organisationId,
      actorUserId: userId,
      action: cancelAtPeriodEnd
        ? "billing.cancel_scheduled"
        : "billing.cancel_withdrawn",
      subjectType: "organisation_billing",
      subjectId: organisationId,
      requestId,
      metadata: {
        state: billing.state,
        currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
        clearedPendingPlanId: clearedPendingPlan ? billing.pendingPlanId : null,
      },
    })
    return { outcome: "updated", cancelAtPeriodEnd, clearedPendingPlan }
  })
}
