import { describe, expect, it } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import type { BillingOverview } from "@/lib/contracts/billing"
import {
  CONFIRMATION_PATIENCE_MS,
  billingBanner,
  billingStatus,
  canChangePlan,
  confirmationPhase,
  describeAccess,
  describeCheckoutUnavailable,
  describeLocationUsage,
  isStripeHostedUrl,
  pendingLinkLimitNote,
} from "@/lib/billing/presentation"
import { ACCESS_REASONS } from "@/lib/domain/entitlements"
import { describeActionError } from "@/lib/errors/action-errors"

const ACCESS: BillingOverview["access"] = {
  mode: "full",
  reason: "active",
  canWrite: true,
  canUseAi: true,
  locationLimit: 5,
  pendingLocationLimit: null,
  newLinkLimit: 5,
  memberLimit: null,
  endsAt: "2026-11-14T08:00:00.000Z",
}

describe("billing presentation (P07-S6)", () => {
  it("has a sentence for every access reason", () => {
    for (const reason of ACCESS_REASONS) {
      expect(describeAccess({ ...ACCESS, reason }).length).toBeGreaterThan(10)
    }
    expect(describeAccess({ ...ACCESS, reason: "trialing" })).toBe(
      "Free trial until 14 November 2026. The first payment is taken then."
    )
  })

  it("labels read-only by the record's state, never as active", () => {
    const readOnly = {
      ...ACCESS,
      mode: "read_only" as const,
      reason: "renewal_unconfirmed" as const,
    }
    expect(
      billingStatus({
        state: "active",
        access: readOnly,
        cancelAtPeriodEnd: false,
      })
    ).toEqual({ label: "Read-only", tone: "bad" })
    expect(
      billingStatus({
        state: "canceled",
        access: readOnly,
        cancelAtPeriodEnd: false,
      })
    ).toEqual({ label: "Cancelled", tone: "bad" })
    expect(
      billingStatus({
        state: "past_due",
        access: { ...ACCESS, mode: "grace", reason: "payment_grace" },
        cancelAtPeriodEnd: false,
      })
    ).toEqual({ label: "Payment failed", tone: "warn" })
    expect(
      billingStatus({ state: null, access: readOnly, cancelAtPeriodEnd: false })
        .tone
    ).toBe("bad")
  })

  it("counts locations against the limit, or says there is none", () => {
    expect(
      describeLocationUsage({
        billableLocations: 1,
        access: { ...ACCESS, locationLimit: 1 },
      })
    ).toBe("1 of 1 location linked")
    expect(
      describeLocationUsage({
        billableLocations: 4,
        access: { ...ACCESS, locationLimit: null },
      })
    ).toBe("4 locations linked, no limit")
  })

  it("explains a scheduled lower limit only when it binds new links", () => {
    expect(
      pendingLinkLimitNote({ access: ACCESS, pendingEffectiveAt: null })
    ).toBeNull()
    expect(
      pendingLinkLimitNote({
        access: { ...ACCESS, pendingLocationLimit: 2, newLinkLimit: 2 },
        pendingEffectiveAt: "2026-11-14T08:00:00.000Z",
      })
    ).toMatch(/allows 2 locations from 14 November 2026.*never removed/)
  })

  it("allows plan changes only while trialing or active and not cancelling", () => {
    expect(canChangePlan({ state: "active", cancelAtPeriodEnd: false })).toBe(
      true
    )
    expect(canChangePlan({ state: "trialing", cancelAtPeriodEnd: false })).toBe(
      true
    )
    expect(canChangePlan({ state: "active", cancelAtPeriodEnd: true })).toBe(
      false
    )
    expect(canChangePlan({ state: "past_due", cancelAtPeriodEnd: false })).toBe(
      false
    )
    expect(canChangePlan({ state: "pilot", cancelAtPeriodEnd: false })).toBe(
      false
    )
  })

  it("says why checkout is closed without leaking configuration", () => {
    expect(
      describeCheckoutUnavailable({ available: true, reason: null })
    ).toBeNull()
    expect(
      describeCheckoutUnavailable({
        available: false,
        reason: "live_tax_missing",
      })
    ).toBe("Subscriptions are not available yet. Nothing has been charged.")
    expect(
      describeCheckoutUnavailable({ available: false, reason: "catalog_empty" })
    ).toMatch(/No plans/)
  })

  it("follows only Stripe's own hosted pages", () => {
    expect(
      isStripeHostedUrl("https://checkout.stripe.com/c/pay/cs_test_1")
    ).toBe(true)
    expect(isStripeHostedUrl("https://billing.stripe.com/p/session/x")).toBe(
      true
    )
    for (const bad of [
      "http://checkout.stripe.com/c/pay",
      "https://checkout.stripe.com.evil.example/c",
      "https://evilstripe.com/",
      "https://user:pw@checkout.stripe.com/",
      "javascript:alert(1)",
      "/settings/billing",
      "not a url",
    ]) {
      expect(isStripeHostedUrl(bad), bad).toBe(false)
    }
  })

  it("shows a banner only for grace and read-only, and says what enforcement leaves", () => {
    expect(billingBanner({ access: ACCESS, writesBlocked: false })).toBeNull()
    const readOnly = {
      ...ACCESS,
      mode: "read_only" as const,
      reason: "subscription_ended" as const,
      canWrite: false,
      canUseAi: false,
    }
    expect(
      billingBanner({ access: readOnly, writesBlocked: true })?.message
    ).toMatch(/export data, manage billing/)
    expect(
      billingBanner({ access: readOnly, writesBlocked: false })?.message
    ).toMatch(/AI drafting is off/)
    expect(
      billingBanner({
        access: { ...ACCESS, mode: "grace", reason: "payment_grace" },
        writesBlocked: false,
      })?.tone
    ).toBe("warn")
  })

  it("confirms a checkout only from a provider-synced subscription", () => {
    const at = "2026-10-12T10:00:00.000Z"
    expect(
      confirmationPhase({
        state: "pilot",
        providerSyncedAt: null,
        elapsedMs: 0,
      })
    ).toBe("confirming")
    expect(
      confirmationPhase({
        state: "canceled",
        providerSyncedAt: at,
        elapsedMs: 0,
      })
    ).toBe("confirming")
    expect(
      confirmationPhase({
        state: "trialing",
        providerSyncedAt: null,
        elapsedMs: 0,
      })
    ).toBe("confirming")
    expect(
      confirmationPhase({
        state: "trialing",
        providerSyncedAt: at,
        elapsedMs: 0,
      })
    ).toBe("confirmed")
    expect(
      confirmationPhase({
        state: "pilot",
        providerSyncedAt: null,
        elapsedMs: CONFIRMATION_PATIENCE_MS,
      })
    ).toBe("delayed")
  })

  it("maps billing errors to words, naming the limit when the server sent it", () => {
    expect(
      describeActionError(new ApiClientError(503, "billing_unavailable", "x"))
    ).toMatch(/Nothing has been charged/)
    expect(
      describeActionError(
        new ApiClientError(402, "location_limit_reached", "x", { limit: 3 })
      )
    ).toMatch(/allows 3 locations/)
    expect(
      describeActionError(
        new ApiClientError(409, "location_limit_exceeded", "x", {
          limit: 1,
          billableLocations: 2,
        })
      )
    ).toMatch(/That plan allows 1 location,/)
    expect(
      describeActionError(
        new ApiClientError(402, "location_limit_reached", "x")
      )
    ).toMatch(/location limit/)
    expect(
      describeActionError(
        new ApiClientError(403, "support_session_forbidden", "x")
      )
    ).toMatch(/support session/)
  })
})
