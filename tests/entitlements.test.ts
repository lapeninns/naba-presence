import { describe, expect, it } from "vitest"

import { accessSchema } from "@/lib/contracts/billing"
import {
  BILLING_STATES,
  GRACE_PERIOD_DAYS,
  PROVIDER_CONFIRMATION_HOURS,
  deriveAccess,
  type BillingRecord,
  type PlanLimits,
} from "@/lib/domain/entitlements"

const NOW = new Date("2026-10-11T12:00:00.000Z")
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000)
const DAY = 24

const STARTER: PlanLimits = { locationLimit: 5, memberLimit: 3 }
const SMALL: PlanLimits = { locationLimit: 2, memberLimit: null }
const BIG: PlanLimits = { locationLimit: 20, memberLimit: null }

const record = (overrides: Partial<BillingRecord>): BillingRecord => ({
  state: "active",
  trialEndsAt: null,
  currentPeriodStart: at(-10 * DAY),
  currentPeriodEnd: at(20 * DAY),
  graceEndsAt: null,
  cancelAtPeriodEnd: false,
  firstPaymentSucceeded: true,
  pendingEffectiveAt: null,
  ...overrides,
})

const derive = (
  overrides: Partial<BillingRecord>,
  plans: { current?: PlanLimits | null; pending?: PlanLimits | null } = {}
) =>
  deriveAccess(
    record(overrides),
    {
      current: plans.current === undefined ? STARTER : plans.current,
      pending: plans.pending ?? null,
    },
    NOW
  )

describe("deriveAccess", () => {
  it("is read-only without a billing record", () => {
    const access = deriveAccess(null, { current: null, pending: null }, NOW)
    expect(access).toMatchObject({
      mode: "read_only",
      reason: "billing_missing",
      canWrite: false,
      canUseAi: false,
    })
  })

  it("gives a pilot full access with no limits, plan or end", () => {
    expect(derive({ state: "pilot" }, { current: null })).toEqual({
      mode: "full",
      reason: "pilot",
      canWrite: true,
      canUseAi: true,
      locationLimit: null,
      pendingLocationLimit: null,
      newLinkLimit: null,
      memberLimit: null,
      endsAt: null,
    })
  })

  it("gives a running trial full access until it ends", () => {
    const access = derive({
      state: "trialing",
      trialEndsAt: at(3 * DAY),
      firstPaymentSucceeded: false,
    })
    expect(access).toMatchObject({
      mode: "full",
      reason: "trialing",
      canWrite: true,
      locationLimit: 5,
      memberLimit: 3,
      endsAt: at(3 * DAY),
    })
  })

  it("keeps a trial that just ended while the first payment confirms", () => {
    const access = derive({
      state: "trialing",
      trialEndsAt: at(-1),
      firstPaymentSucceeded: false,
    })
    expect(access.mode).toBe("full")
    expect(access.reason).toBe("confirming_payment")
    expect(access.endsAt).toEqual(at(PROVIDER_CONFIRMATION_HOURS - 1))
  })

  it("makes a trial with no recorded payment read-only once confirmation lapses", () => {
    const access = derive({
      state: "trialing",
      trialEndsAt: at(-PROVIDER_CONFIRMATION_HOURS),
      firstPaymentSucceeded: false,
    })
    expect(access).toMatchObject({
      mode: "read_only",
      reason: "trial_ended_unpaid",
      canWrite: false,
      canUseAi: false,
    })
  })

  it("gives a failed first payment after the trial no grace", () => {
    for (const state of ["past_due", "grace"] as const) {
      const access = derive({
        state,
        trialEndsAt: at(-1),
        currentPeriodEnd: at(-1),
        graceEndsAt: at(6 * DAY),
        firstPaymentSucceeded: false,
      })
      expect(access).toMatchObject({
        mode: "read_only",
        reason: "first_payment_failed",
      })
    }
  })

  it("gives an active subscription full access", () => {
    expect(derive({})).toMatchObject({
      mode: "full",
      reason: "active",
      canWrite: true,
      canUseAi: true,
      endsAt: at(20 * DAY),
    })
  })

  it("keeps access until period end when cancellation is scheduled", () => {
    expect(derive({ cancelAtPeriodEnd: true })).toMatchObject({
      mode: "full",
      reason: "cancel_scheduled",
      endsAt: at(20 * DAY),
    })
    expect(
      derive({ cancelAtPeriodEnd: true, currentPeriodEnd: NOW })
    ).toMatchObject({ mode: "read_only", reason: "subscription_ended" })
  })

  it("confirms a silent renewal for a bounded time, then fails closed", () => {
    expect(derive({ currentPeriodEnd: at(-2) })).toMatchObject({
      mode: "full",
      reason: "confirming_payment",
    })
    expect(
      derive({ currentPeriodEnd: at(-PROVIDER_CONFIRMATION_HOURS - 1) })
    ).toMatchObject({ mode: "read_only", reason: "renewal_unconfirmed" })
  })

  it("gives a failed renewal seven days of grace, then read-only", () => {
    for (const state of ["past_due", "grace"] as const) {
      const within = derive({
        state,
        currentPeriodEnd: at(-2 * DAY),
        graceEndsAt: at(5 * DAY),
      })
      expect(within).toMatchObject({
        mode: "grace",
        reason: "payment_grace",
        canWrite: true,
        canUseAi: true,
        endsAt: at(5 * DAY),
      })
      expect(
        derive({ state, currentPeriodEnd: at(-8 * DAY), graceEndsAt: NOW })
      ).toMatchObject({ mode: "read_only", reason: "grace_expired" })
    }
  })

  it("counts grace from the failed renewal when no end is recorded", () => {
    const renewal = at(-3 * DAY)
    const access = derive({ state: "past_due", currentPeriodEnd: renewal })
    expect(access.mode).toBe("grace")
    expect(access.endsAt).toEqual(at((GRACE_PERIOD_DAYS - 3) * DAY))
    expect(
      derive({
        state: "past_due",
        currentPeriodEnd: at(-GRACE_PERIOD_DAYS * DAY),
      })
    ).toMatchObject({ mode: "read_only", reason: "grace_expired" })
    // No anchor at all fails closed.
    expect(derive({ state: "past_due", currentPeriodEnd: null })).toMatchObject(
      { mode: "read_only", reason: "grace_expired" }
    )
  })

  it("makes read_only and canceled read-only", () => {
    expect(derive({ state: "read_only" })).toMatchObject({
      mode: "read_only",
      reason: "read_only",
      locationLimit: 5,
    })
    expect(derive({ state: "canceled" })).toMatchObject({
      mode: "read_only",
      reason: "subscription_ended",
    })
  })

  it("fails closed for a subscription state without its plan", () => {
    for (const state of ["trialing", "active", "past_due", "grace"] as const) {
      expect(
        derive({ state, trialEndsAt: at(DAY) }, { current: null })
      ).toMatchObject({ mode: "read_only", reason: "plan_missing" })
    }
  })

  it("fails closed for a trial with no end and an unknown state", () => {
    expect(derive({ state: "trialing", trialEndsAt: null })).toMatchObject({
      mode: "read_only",
      reason: "record_incomplete",
    })
    expect(
      derive({ state: "suspended" as unknown as BillingRecord["state"] })
    ).toMatchObject({ mode: "read_only", reason: "record_incomplete" })
  })

  it("binds new links to the lower of the current and pending limits", () => {
    const downgrade = derive(
      { pendingEffectiveAt: at(20 * DAY) },
      { pending: SMALL }
    )
    expect(downgrade).toMatchObject({
      locationLimit: 5,
      pendingLocationLimit: 2,
      newLinkLimit: 2,
    })
    const upgrade = derive(
      { pendingEffectiveAt: at(20 * DAY) },
      { pending: BIG }
    )
    expect(upgrade).toMatchObject({
      locationLimit: 5,
      pendingLocationLimit: 20,
      newLinkLimit: 5,
    })
    // A pending plan without an effective date is not scheduled.
    expect(derive({}, { pending: SMALL })).toMatchObject({
      pendingLocationLimit: null,
      newLinkLimit: 5,
    })
  })

  it("derives every state into the wire shape", () => {
    for (const state of BILLING_STATES) {
      const access = derive({ state, trialEndsAt: at(DAY) })
      const wire = accessSchema.parse({
        ...access,
        endsAt: access.endsAt?.toISOString() ?? null,
      })
      expect(wire.mode).toBe(access.mode)
      expect(access.canWrite).toBe(access.mode !== "read_only")
    }
  })
})
