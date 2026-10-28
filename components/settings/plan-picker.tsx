"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import type { BillingOverview, Plan } from "@/lib/api/billing"
import type { PlanChangeResult } from "@/lib/contracts/billing"
import {
  canChangePlan,
  describeCheckoutUnavailable,
  formatBillingDate,
  formatBillingDateTime,
  isSubscribed,
  planLimitWarning,
  planUnavailableReason,
} from "@/lib/billing/presentation"
import { describeActionError } from "@/lib/errors/action-errors"
import { useChangePlan, useStartCheckout } from "@/lib/queries/use-billing"

/** What a failed billing action says (a refused redirect names itself). */
export function billingActionError(error: unknown): string {
  if (error instanceof Error && error.name === "UnexpectedBillingRedirect") {
    return error.message
  }
  return describeActionError(error)
}

/**
 * What a plan change did, from the server's answer only: a change scheduled
 * for its boundary, or a scheduled change dropped. "unchanged" says nothing.
 */
export function showPlanChangeToast(
  result: PlanChangeResult,
  overview: Pick<BillingOverview, "catalog" | "plan">
) {
  if (result.outcome === "scheduled") {
    const name =
      overview.catalog.find((plan) => plan.id === result.pendingPlanId)?.name ??
      "The new plan"
    toast.add({
      type: "success",
      title: result.pendingEffectiveAt
        ? `${name} starts on ${formatBillingDate(result.pendingEffectiveAt)}`
        : `${name} is scheduled`,
      description: "Nothing is charged now.",
    })
  } else if (result.outcome === "cleared") {
    toast.add({
      type: "success",
      title: overview.plan
        ? `You’ll stay on ${overview.plan.name}`
        : "The scheduled change was dropped",
    })
  }
}

function planFacts(plan: Plan): string {
  const locations = `${plan.locationLimit} ${plan.locationLimit === 1 ? "location" : "locations"}`
  const members =
    plan.memberLimit === null
      ? "unlimited team members"
      : `${plan.memberLimit} team ${plan.memberLimit === 1 ? "member" : "members"}`
  return `${locations} · ${members} · ${plan.aiDraftCreditsPerPeriod} AI reply credits per period`
}

/**
 * The plans on offer (reference `choice-card` list). Before a subscription
 * each plan starts Stripe Checkout; during a trial or active subscription it
 * schedules a change at the next renewal, without proration. A test offer
 * is marked on the plan itself, never only in a page note. Prices are not
 * shown here: the catalog holds no amounts, and Stripe's Checkout page
 * shows the price and terms before anything is charged.
 */
export function PlanPicker({ overview }: { overview: BillingOverview }) {
  const checkout = useStartCheckout()
  const change = useChangePlan()
  const subscribed = isSubscribed(overview.state)
  const changeable = canChangePlan(overview)
  const checkoutBlocked = describeCheckoutUnavailable(overview.checkout)
  const manageBlocked = overview.canManage
    ? null
    : "Only the workspace owner can change billing, and not from a support session."
  const pending = overview.checkoutPending
  // A change starts at the next boundary: the trial end while trialing,
  // otherwise the end of the paid period.
  const boundary =
    overview.state === "trialing"
      ? (overview.trialEndsAt ?? overview.currentPeriodEnd)
      : overview.currentPeriodEnd
  const busy = checkout.isPending || change.isPending
  const error = checkout.error ?? change.error

  if (overview.catalog.length === 0) {
    return (
      <p data-slot="plan-picker-empty" className="m-0 text-body text-ink">
        {checkoutBlocked ?? "No plans are on offer for this workspace yet."}
      </p>
    )
  }

  const subscribedBlock = subscribed
    ? changeable
      ? null
      : overview.state === "trialing" || overview.state === "active"
        ? "Resume the subscription before changing plan."
        : "Plans can be changed during a trial or while the subscription is active. Update the payment method first."
    : null
  // A reason that holds for every plan is said once, above the list; each
  // button still carries it as its description.
  const sharedBlock = manageBlocked ?? (subscribed ? null : checkoutBlocked)

  return (
    <div className="flex flex-col gap-3" data-slot="plan-picker">
      {!subscribed ? (
        <p className="m-0 text-ui text-ink-secondary">
          {overview.trialDays > 0
            ? `New subscriptions start with a ${overview.trialDays}-day free trial. Stripe asks for a card and shows the price before anything is charged.`
            : "Billing starts when you subscribe. Stripe shows the price before anything is charged."}
        </p>
      ) : changeable ? (
        <p className="m-0 text-ui text-ink-secondary">
          A new plan starts at the next renewal
          {boundary ? ` (${formatBillingDate(boundary)})` : ""}. Nothing is
          prorated or charged now.
        </p>
      ) : (
        <p className="m-0 text-ui text-ink-secondary">{subscribedBlock}</p>
      )}
      {sharedBlock ? (
        <p data-slot="plan-picker-blocked" className="m-0 text-ui text-ink">
          {sharedBlock}
        </p>
      ) : null}
      {pending ? (
        <p
          data-slot="checkout-pending"
          className="m-0 rounded-md bg-info-tint px-3 py-2 text-ui text-ink"
        >
          A checkout was started for{" "}
          {overview.catalog.find((plan) => plan.id === pending.planId)?.name ??
            "a plan"}{" "}
          and stays open until {formatBillingDateTime(pending.expiresAt)}.
          Continuing it opens the same Stripe page.
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col divide-y divide-line border-y border-line p-0">
        {overview.catalog.map((plan) => {
          const current = overview.plan?.id === plan.id
          const scheduled = overview.pendingPlan?.id === plan.id
          const tooSmall = planUnavailableReason(overview, plan)
          // Checkout is not refused for a small plan (the server does not
          // refuse it either); it says what the limit will mean instead.
          const limitWarning = subscribed
            ? null
            : planLimitWarning(overview, plan)
          const label = subscribed
            ? current
              ? overview.pendingPlan
                ? `Keep ${plan.name}`
                : "Current plan"
              : scheduled
                ? "Scheduled"
                : `Switch to ${plan.name}`
            : pending?.planId === plan.id
              ? "Continue checkout"
              : `Subscribe to ${plan.name}`
          const reason = subscribed
            ? (manageBlocked ??
              subscribedBlock ??
              (current && !overview.pendingPlan
                ? "This is your current plan."
                : scheduled
                  ? "This plan is already scheduled."
                  : current
                    ? null
                    : tooSmall))
            : (manageBlocked ?? checkoutBlocked)
          return (
            <li
              key={plan.id}
              data-slot="plan-option"
              data-plan-code={plan.code}
              className="flex min-h-(--np-row-h) flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="m-0 flex flex-wrap items-center gap-2 text-body font-semibold text-ink">
                  {plan.name}
                  {plan.isTestOffer ? (
                    <Badge variant="warning" data-slot="test-offer">
                      Test offer
                    </Badge>
                  ) : null}
                  {current ? <Badge variant="secondary">Current</Badge> : null}
                  {scheduled ? <Badge variant="info">Scheduled</Badge> : null}
                </p>
                <p className="m-0 text-caption text-ink-muted">
                  {planFacts(plan)}
                </p>
                {/* Only the one per-plan reason; the rest are said once. */}
                {reason && reason === tooSmall ? (
                  <p className="m-0 text-caption text-ink-muted">{reason}</p>
                ) : null}
                {limitWarning && !reason ? (
                  <p
                    data-slot="plan-limit-warning"
                    className="m-0 text-caption text-warning-ink"
                  >
                    {limitWarning}
                  </p>
                ) : null}
              </div>
              <Button
                variant={current || scheduled ? "outline" : "default"}
                size="sm"
                className="shrink-0"
                disabledReason={reason ?? undefined}
                pending={
                  busy &&
                  (checkout.variables === plan.id ||
                    change.variables === plan.id)
                }
                disabled={busy}
                onClick={() =>
                  subscribed
                    ? change.mutate(plan.id, {
                        onSuccess: (result) =>
                          showPlanChangeToast(result, overview),
                      })
                    : checkout.mutate(plan.id)
                }
              >
                {label}
              </Button>
            </li>
          )
        })}
      </ul>
      {error ? (
        <p role="alert" className="m-0 text-caption text-danger-ink">
          {billingActionError(error)}
        </p>
      ) : null}
    </div>
  )
}
