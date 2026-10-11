/**
 * Organisation access derived from its billing record (plan P07). Pure and
 * client-safe: no I/O, no clock of its own, so the server, the workers and
 * the UI derive the same answer from the same record and instant.
 *
 * The record is `organisation_billing` (migration 0220) as read by
 * lib/server/billing/state.ts. This module only answers "what may this
 * organisation do now"; refusing work is P07-S3's central enforcement, and
 * moving between states is the Stripe processor's (P07-S4).
 *
 * Lifecycle (plan §3 "Billing and AI"):
 * - pilot: explicit pilot access, no location limit, never charged;
 * - trialing: full access until the trial ends;
 * - active: full access; a scheduled cancellation keeps it to period end;
 * - past_due / grace after a failed renewal: seven days of grace, then
 *   read-only. A failed FIRST payment (the one at trial end) has no grace;
 * - read_only / canceled: read-only (billing, export, privacy and disconnect
 *   stay available; S3 keeps that list).
 *
 * Everything fails closed: no record, a paid state without its plan, an
 * unknown state, or a grace with no anchor to count from derives read-only.
 */

export const BILLING_STATES = [
  "pilot",
  "trialing",
  "active",
  "past_due",
  "grace",
  "read_only",
  "canceled",
] as const
export type BillingState = (typeof BILLING_STATES)[number]

/** Grace after a failed renewal. A failed first payment gets none. */
export const GRACE_PERIOD_DAYS = 7

/**
 * How long a trial end or period end may pass with no provider outcome
 * recorded before the record is treated as unpaid. Stripe finalises the
 * invoice for a trial end or renewal about an hour after the boundary and
 * the processor learns the result from the webhook (or the hourly
 * reconciliation), so for a while "ended, no payment recorded" is the normal
 * state of a paying customer. A payment that actually FAILS is recorded
 * (past_due) and ends access at once; this window only covers silence.
 */
export const PROVIDER_CONFIRMATION_HOURS = 24

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export type AccessMode = "full" | "grace" | "read_only"

export type AccessReason =
  | "pilot"
  | "trialing"
  | "active"
  | "cancel_scheduled"
  | "confirming_payment"
  | "payment_grace"
  | "first_payment_failed"
  | "trial_ended_unpaid"
  | "renewal_unconfirmed"
  | "grace_expired"
  | "subscription_ended"
  | "read_only"
  | "plan_missing"
  | "record_incomplete"
  | "billing_missing"

/** The fields of `organisation_billing` access depends on. */
export type BillingRecord = {
  state: BillingState
  trialEndsAt: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  graceEndsAt: Date | null
  cancelAtPeriodEnd: boolean
  firstPaymentSucceeded: boolean
  pendingEffectiveAt: Date | null
}

/** The limits of a `billing_plan` version. */
export type PlanLimits = {
  locationLimit: number
  /** null = no member limit. */
  memberLimit: number | null
}

export type Access = {
  mode: AccessMode
  reason: AccessReason
  /** May create or change content, links and settings. */
  canWrite: boolean
  /** May start new AI work (the period allowance still applies). */
  canUseAi: boolean
  /** The current plan's location limit; null = no limit (pilot). */
  locationLimit: number | null
  /** A scheduled plan's location limit; null when none is scheduled. */
  pendingLocationLimit: number | null
  /**
   * The limit new links must fit: the lower of the current and pending
   * limits, so a scheduled downgrade binds new links at once. Existing links
   * are never removed. null = no limit.
   */
  newLinkLimit: number | null
  memberLimit: number | null
  /** When the current mode ends on its own (trial, period or grace end). */
  endsAt: Date | null
}

export type AccessPlans = {
  current: PlanLimits | null
  pending: PlanLimits | null
}

const minLimit = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b)

const passed = (at: Date | null, now: Date) =>
  at !== null && now.getTime() >= at.getTime()

const addMs = (at: Date, ms: number) => new Date(at.getTime() + ms)

/**
 * The organisation's access at `now`. `billing` null (no row) and a
 * subscription state without its current plan derive read-only.
 */
export function deriveAccess(
  billing: BillingRecord | null,
  plans: AccessPlans,
  now: Date
): Access {
  const current = plans.current
  const pendingLimit =
    billing?.pendingEffectiveAt && plans.pending
      ? plans.pending.locationLimit
      : null

  const build = (
    mode: AccessMode,
    reason: AccessReason,
    endsAt: Date | null,
    limits: { location: number | null; member: number | null } = {
      location: current?.locationLimit ?? null,
      member: current?.memberLimit ?? null,
    }
  ): Access => ({
    mode,
    reason,
    canWrite: mode !== "read_only",
    canUseAi: mode !== "read_only",
    locationLimit: limits.location,
    pendingLocationLimit: pendingLimit,
    newLinkLimit: minLimit(limits.location, pendingLimit),
    memberLimit: limits.member,
    endsAt,
  })

  if (!billing) return build("read_only", "billing_missing", null)

  switch (billing.state) {
    case "pilot":
      // Explicit pilot entitlements: no plan, no limits.
      return build("full", "pilot", null, { location: null, member: null })
    case "read_only":
      return build("read_only", "read_only", null)
    case "canceled":
      return build("read_only", "subscription_ended", null)
    default:
      break
  }

  if (!current) return build("read_only", "plan_missing", null)

  switch (billing.state) {
    case "trialing": {
      const ends = billing.trialEndsAt
      if (!ends) return build("read_only", "record_incomplete", null)
      if (!passed(ends, now)) return build("full", "trialing", ends)
      const confirmBy = addMs(ends, PROVIDER_CONFIRMATION_HOURS * HOUR_MS)
      if (!passed(confirmBy, now)) {
        return build("full", "confirming_payment", confirmBy)
      }
      return build("read_only", "trial_ended_unpaid", null)
    }
    case "active": {
      const ends = billing.currentPeriodEnd
      if (billing.cancelAtPeriodEnd) {
        return passed(ends, now)
          ? build("read_only", "subscription_ended", null)
          : build("full", "cancel_scheduled", ends)
      }
      if (!ends || !passed(ends, now)) return build("full", "active", ends)
      const confirmBy = addMs(ends, PROVIDER_CONFIRMATION_HOURS * HOUR_MS)
      if (!passed(confirmBy, now)) {
        return build("full", "confirming_payment", confirmBy)
      }
      return build("read_only", "renewal_unconfirmed", null)
    }
    case "past_due":
    case "grace": {
      if (!billing.firstPaymentSucceeded) {
        return build("read_only", "first_payment_failed", null)
      }
      // The processor records grace_ends_at; failing that, count from the
      // renewal that failed. No anchor at all derives read-only.
      const graceEnds =
        billing.graceEndsAt ??
        (billing.currentPeriodEnd
          ? addMs(billing.currentPeriodEnd, GRACE_PERIOD_DAYS * DAY_MS)
          : null)
      if (!graceEnds || passed(graceEnds, now)) {
        return build("read_only", "grace_expired", null)
      }
      return build("grace", "payment_grace", graceEnds)
    }
    default:
      return build("read_only", "record_incomplete", null)
  }
}
