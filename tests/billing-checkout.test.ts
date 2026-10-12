import { describe, expect, it, vi } from "vitest"

import {
  checkoutInputSchema,
  planChangeInputSchema,
} from "@/lib/contracts/billing"
import { publicPlan, type CatalogPlan } from "@/lib/server/billing/catalog"
import {
  billingReadiness,
  refuseSupportSession,
} from "@/lib/server/billing/checkout"
import { stripeApiTarget } from "@/lib/server/billing/stripe"
import type { ServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { NO_PAUSES, type PauseSnapshot } from "@/lib/server/pause-controls"

vi.mock("server-only", () => ({}))

/**
 * Checkout's fail-closed gate and input boundary (plan P07-S5). The routes
 * through the real database and a stubbed Stripe are pinned by
 * tests/integration/routes/billing-checkout.test.ts.
 */

const TEST_ENV = {
  BILLING_ENABLED: true,
  BILLING_ENVIRONMENT: "test",
  STRIPE_SECRET_KEY: "sk_test_unit",
  STRIPE_WEBHOOK_SECRET: "whsec_unit",
  NEXTAUTH_URL: "https://app.example.test/some/path",
  BILLING_TERMS_URL: undefined,
  BILLING_AUTOMATIC_TAX: false,
} as unknown as ServerEnv

const LIVE_READY = {
  ...TEST_ENV,
  BILLING_ENVIRONMENT: "live",
  STRIPE_SECRET_KEY: "sk_live_unit",
  BILLING_TERMS_URL: "https://example.test/terms",
  BILLING_AUTOMATIC_TAX: true,
} as unknown as ServerEnv

const ready = (
  env: Partial<ServerEnv>,
  forCheckout = true,
  pauses: PauseSnapshot = NO_PAUSES
) =>
  billingReadiness({
    env: { ...TEST_ENV, ...env } as ServerEnv,
    pauses,
    forCheckout,
  })

describe("billingReadiness", () => {
  it("is ready in the test environment without terms or tax", () => {
    const result = ready({})
    expect(result).toMatchObject({
      ok: true,
      appUrl: "https://app.example.test",
    })
  })

  it.each([
    [{ BILLING_ENABLED: false }, "billing_disabled"],
    [{ STRIPE_SECRET_KEY: undefined }, "secret_key_missing"],
    [{ STRIPE_WEBHOOK_SECRET: undefined }, "webhook_secret_missing"],
    [{ STRIPE_SECRET_KEY: "sk_live_unit" }, "secret_key_mode_mismatch"],
    [{ NEXTAUTH_URL: undefined }, "app_url_missing"],
  ] as const)("fails closed: %o -> %s", (env, reason) => {
    expect(ready(env as Partial<ServerEnv>)).toEqual({ ok: false, reason })
  })

  it("fails closed while the operator billing pause is on, or unreadable", () => {
    expect(
      ready({}, true, { paused: new Set(["billing"]), readFailed: false })
    ).toEqual({ ok: false, reason: "billing_paused" })
    expect(ready({}, true, { paused: new Set(), readFailed: true })).toEqual({
      ok: false,
      reason: "billing_paused",
    })
  })

  it("keeps live checkout closed until terms and tax are both in place", () => {
    expect(ready({ ...LIVE_READY, BILLING_TERMS_URL: undefined })).toEqual({
      ok: false,
      reason: "live_terms_missing",
    })
    expect(ready({ ...LIVE_READY, BILLING_AUTOMATIC_TAX: false })).toEqual({
      ok: false,
      reason: "live_tax_missing",
    })
    expect(ready(LIVE_READY).ok).toBe(true)
    // The portal and plan changes do not sell, so they do not need them.
    expect(
      ready({ ...LIVE_READY, BILLING_TERMS_URL: undefined }, false).ok
    ).toBe(true)
  })
})

describe("stripeApiTarget", () => {
  it("redirects only a test-mode key", () => {
    expect(
      stripeApiTarget("sk_test_abc", "http://127.0.0.1:4010")?.toString()
    ).toBe("http://127.0.0.1:4010/")
    expect(stripeApiTarget("sk_live_abc", "http://127.0.0.1:4010")).toBeNull()
    expect(stripeApiTarget("rk_live_abc", "http://127.0.0.1:4010")).toBeNull()
    expect(stripeApiTarget("sk_test_abc", undefined)).toBeNull()
    expect(stripeApiTarget("sk_test_abc", "not a url")).toBeNull()
  })
})

describe("checkout input boundary", () => {
  const planId = "11111111-1111-4111-8111-111111111111"

  it("accepts only a plan id: a price or customer id is refused", () => {
    expect(checkoutInputSchema.safeParse({ planId }).success).toBe(true)
    expect(
      checkoutInputSchema.safeParse({ planId, priceId: "price_cheap" }).success
    ).toBe(false)
    expect(
      checkoutInputSchema.safeParse({ planId, customerId: "cus_other" }).success
    ).toBe(false)
    expect(checkoutInputSchema.safeParse({ planId: "price_x" }).success).toBe(
      false
    )
    expect(
      planChangeInputSchema.safeParse({ planId, priceId: "price_x" }).success
    ).toBe(false)
  })

  it("never exposes the Stripe price id", () => {
    const plan: CatalogPlan = {
      id: planId,
      code: "basic",
      version: 1,
      workspaceMode: "agency",
      environment: "test",
      name: "Basic",
      locationLimit: 3,
      memberLimit: null,
      aiDraftCreditsPerPeriod: 40,
      isTestOffer: true,
      active: true,
      stripePriceId: "price_secret",
    }
    expect(JSON.stringify(publicPlan(plan))).not.toContain("price_secret")
  })

  it("refuses support impersonation sessions", () => {
    expect(() =>
      refuseSupportSession({ supportActor: "ops@example.test" })
    ).toThrow(ApiError)
    expect(() => refuseSupportSession({ supportActor: null })).not.toThrow()
  })
})
