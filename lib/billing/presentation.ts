/**
 * Customer-facing billing copy and decisions (plan P07-S6). Pure and
 * client-safe: the Billing screen, the Usage screen, the "Confirming
 * subscription" screen and the shell's read-only banner all read the same
 * GET /api/billing overview through these helpers, so they never disagree.
 *
 * Nothing here grants anything. Every sentence describes the record the
 * server derived from the provider's state; a checkout that has not been
 * confirmed by the webhook processor is never shown as a subscription.
 */
import type { AccessView, BillingOverview, Plan } from "@/lib/contracts/billing"
import { SUBSCRIBED_STATES } from "@/lib/domain/billing-lifecycle"
import type { AccessReason, BillingState } from "@/lib/domain/entitlements"

/** "14 November 2026", in UTC like Stripe's period boundaries. */
export function formatBillingDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** "14 November 2026, 09:30 UTC" for short windows (an open checkout). */
export function formatBillingDateTime(iso: string): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  })
  return `${formatBillingDate(iso)}, ${time} UTC`
}

const STATE_LABEL: Record<BillingState, string> = {
  pilot: "Pilot",
  trialing: "Trial",
  active: "Active",
  past_due: "Payment failed",
  grace: "Payment failed",
  read_only: "Read-only",
  canceled: "Cancelled",
}

export type BillingTone = "ok" | "warn" | "bad" | "info"

/** The status pill: what the record says, coloured by what access allows. */
export function billingStatus(
  overview: Pick<BillingOverview, "state" | "access" | "cancelAtPeriodEnd">
): { label: string; tone: BillingTone } {
  const { access } = overview
  if (overview.state === null)
    return { label: "No billing record", tone: "bad" }
  if (access.mode === "read_only") {
    const label =
      overview.state === "canceled"
        ? "Cancelled"
        : overview.state === "past_due" || overview.state === "grace"
          ? "Payment failed"
          : "Read-only"
    return { label, tone: "bad" }
  }
  if (access.mode === "grace") return { label: "Payment failed", tone: "warn" }
  if (
    access.reason === "cancel_scheduled" ||
    (overview.cancelAtPeriodEnd && access.reason === "trialing")
  )
    return { label: "Ending", tone: "warn" }
  if (access.reason === "confirming_payment") {
    return { label: "Confirming payment", tone: "info" }
  }
  return {
    label: STATE_LABEL[overview.state],
    tone: overview.state === "pilot" ? "info" : "ok",
  }
}

/**
 * One sentence on what the organisation may do now and until when. Dates
 * come from `access.endsAt`, which deriveAccess already capped (grace never
 * outlasts seven days after the failed renewal).
 */
export function describeAccess(access: AccessView): string {
  const until = access.endsAt ? formatBillingDate(access.endsAt) : null
  const copy: Record<AccessReason, string> = {
    pilot: "Pilot access: every feature, with no location limit and no charge.",
    trialing: until
      ? `Free trial until ${until}. The first payment is taken then.`
      : "Free trial.",
    active: until ? `Active. Renews on ${until}.` : "Active.",
    cancel_scheduled: until
      ? `Cancelled. Full access continues until ${until}, then the workspace becomes read-only.`
      : "Cancelled. The workspace becomes read-only at the end of the period.",
    confirming_payment:
      "The period has ended and the payment is being confirmed. Access continues meanwhile.",
    payment_grace: until
      ? `A payment failed. Full access continues until ${until}; update the payment method before then.`
      : "A payment failed. Update the payment method to keep access.",
    first_payment_failed:
      "The first payment failed, so the workspace is read-only. Update the payment method to restore access.",
    trial_ended_unpaid:
      "The trial ended without a confirmed payment, so the workspace is read-only.",
    renewal_unconfirmed:
      "The renewal payment has not been confirmed, so the workspace is read-only.",
    grace_expired:
      "The payment is still outstanding and the grace period has ended, so the workspace is read-only.",
    subscription_ended:
      "The subscription has ended, so the workspace is read-only. Subscribe again to restore access.",
    read_only: "Billing needs attention, so the workspace is read-only.",
    plan_missing:
      "This workspace's plan could not be found, so it is read-only. Contact support.",
    record_incomplete:
      "This workspace's billing record is incomplete, so it is read-only. Contact support.",
    billing_missing:
      "This workspace has no billing record, so it is read-only. Contact support.",
  }
  return copy[access.reason]
}

/**
 * describeAccess for the whole overview. deriveAccess reports a cancelled
 * trial as plain "trialing" (access is the same until the trial ends), but
 * Stripe takes no payment then: the subscription ends with the trial.
 */
export function describeBilling(
  overview: Pick<BillingOverview, "access" | "cancelAtPeriodEnd">
): string {
  const { access } = overview
  if (overview.cancelAtPeriodEnd && access.reason === "trialing") {
    return access.endsAt
      ? `Cancelled during the trial. Full access continues until ${formatBillingDate(access.endsAt)} with no charge, then the workspace becomes read-only.`
      : "Cancelled during the trial. Nothing is charged and the workspace becomes read-only when the trial ends."
  }
  return describeAccess(access)
}

/** "3 of 5 locations linked" / "3 locations linked, no limit". */
export function describeLocationUsage(
  overview: Pick<BillingOverview, "billableLocations" | "access">
): string {
  const used = overview.billableLocations
  const limit = overview.access.locationLimit
  const noun = (count: number) => (count === 1 ? "location" : "locations")
  if (limit === null) return `${used} ${noun(used)} linked, no limit`
  return `${used} of ${limit} ${noun(limit)} linked`
}

/**
 * The lower limit a scheduled downgrade puts on NEW links at once, or null
 * when new links follow the current limit. Existing links are never removed.
 */
export function pendingLinkLimitNote(
  overview: Pick<BillingOverview, "access" | "pendingEffectiveAt">
): string | null {
  const { access } = overview
  if (
    access.newLinkLimit === null ||
    access.locationLimit === null ||
    access.newLinkLimit >= access.locationLimit
  ) {
    return null
  }
  const when = overview.pendingEffectiveAt
    ? ` from ${formatBillingDate(overview.pendingEffectiveAt)}`
    : ""
  return `Your scheduled plan allows ${access.newLinkLimit} ${access.newLinkLimit === 1 ? "location" : "locations"}${when}, so new links must already fit that limit. Linked locations are never removed.`
}

/** Whether the record shows a subscription Stripe has confirmed. */
export function isSubscribed(state: BillingState | null): boolean {
  return state !== null && SUBSCRIBED_STATES.includes(state)
}

/** Whether a plan change may be scheduled (the server's rule, P07-S5). */
export function canChangePlan(
  overview: Pick<BillingOverview, "state" | "cancelAtPeriodEnd">
): boolean {
  return (
    (overview.state === "trialing" || overview.state === "active") &&
    !overview.cancelAtPeriodEnd
  )
}

/** Why checkout cannot start, in words; null when it can. */
export function describeCheckoutUnavailable(
  checkout: BillingOverview["checkout"]
): string | null {
  if (checkout.available) return null
  if (checkout.reason === "catalog_empty") {
    return "No plans are on offer for this workspace yet."
  }
  if (checkout.reason === "billing_paused") {
    return "Subscriptions are paused for maintenance. Try again later."
  }
  return "Subscriptions are not available yet. Nothing has been charged."
}

/**
 * Why a plan cannot be switched to; null when it can. The server refuses a
 * plan CHANGE below the linked locations (409 location_limit_exceeded);
 * Checkout has no such rule, so a first subscription uses
 * planLimitWarning instead.
 */
export function planUnavailableReason(
  overview: Pick<BillingOverview, "billableLocations">,
  plan: Pick<Plan, "locationLimit">
): string | null {
  if (plan.locationLimit < overview.billableLocations) {
    return `${overview.billableLocations} locations are linked and this plan allows ${plan.locationLimit}. Unlink locations first.`
  }
  return null
}

/**
 * What subscribing to a plan smaller than the linked locations means; null
 * when it fits. Nothing is unlinked: new links wait until there is room.
 */
export function planLimitWarning(
  overview: Pick<BillingOverview, "billableLocations">,
  plan: Pick<Plan, "locationLimit">
): string | null {
  if (plan.locationLimit >= overview.billableLocations) return null
  return `${overview.billableLocations} locations are linked and this plan allows ${plan.locationLimit}. None are unlinked, but no new location can be linked until fewer than ${plan.locationLimit} are linked.`
}

/**
 * Only Stripe's own hosted pages (Checkout, Customer Portal) are followed
 * from a billing response; anything else is refused rather than opened.
 */
export function isStripeHostedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.hostname === "stripe.com" || url.hostname.endsWith(".stripe.com"))
    )
  } catch {
    return false
  }
}

/**
 * The read-only or grace banner the app shell shows on every page, or null.
 * Read-only without enforcement only stops AI drafting, and says so.
 */
export function billingBanner(
  overview: Pick<BillingOverview, "access" | "writesBlocked">
): { tone: "warn" | "bad"; message: string } | null {
  const { access } = overview
  if (access.mode === "grace") {
    return { tone: "warn", message: describeAccess(access) }
  }
  if (access.mode !== "read_only") return null
  return {
    tone: "bad",
    message: overview.writesBlocked
      ? `${describeAccess(access)} You can still view everything, export data, manage billing and disconnect Google.`
      : `${describeAccess(access)} AI drafting is off until billing is resolved.`,
  }
}

/** How long the "Confirming subscription" screen polls before saying so. */
export const CONFIRMATION_PATIENCE_MS = 3 * 60 * 1000
/** Poll interval while confirming. */
export const CONFIRMATION_POLL_MS = 2_000

export type ConfirmationPhase =
  "confirming" | "confirmed" | "attention" | "delayed"

/**
 * Where the "Confirming subscription" screen stands. Confirmed only once the
 * record holds a subscription Stripe reported (the processor sets the state
 * and advances `providerSyncedAt`); the return from Checkout alone grants
 * nothing. A synced subscription whose payment failed (past_due, grace) or
 * whose access is already read-only is "attention", never "confirmed".
 * After the patience window it says the confirmation is late instead of
 * spinning forever.
 */
export function confirmationPhase(input: {
  state: BillingState | null
  providerSyncedAt: string | null
  accessMode: AccessView["mode"] | null
  elapsedMs: number
}): ConfirmationPhase {
  if (isSubscribed(input.state) && input.providerSyncedAt !== null) {
    return (input.state === "trialing" || input.state === "active") &&
      input.accessMode !== "read_only"
      ? "confirmed"
      : "attention"
  }
  return input.elapsedMs >= CONFIRMATION_PATIENCE_MS ? "delayed" : "confirming"
}
