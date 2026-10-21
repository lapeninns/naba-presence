import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, type Route, test } from "@playwright/test"

import { pageSettled } from "./helpers/settled"
import { readJourneyState } from "./helpers/stub-bridge"

/**
 * The Billing, Confirming and Usage screens and the shell's read-only banner
 * (plan P07-S6). The harness runs with BILLING_ENABLED on and no Stripe key,
 * so the real overview says checkout is unavailable; these specs stub the
 * GET /api/billing read to show each state, and stub Stripe's hosted page
 * so nothing leaves the machine.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

const PLAN = {
  id: "00000000-0000-4000-8000-0000000000a2",
  code: "large",
  version: 1,
  workspaceMode: "business",
  environment: "test",
  name: "Large",
  locationLimit: 10,
  memberLimit: null,
  aiDraftCreditsPerPeriod: 500,
  isTestOffer: true,
  active: true,
}

const PILOT = {
  state: "pilot",
  environment: null,
  plan: null,
  pendingPlan: null,
  pendingEffectiveAt: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  hasCustomer: false,
  providerSyncedAt: null,
  trialDays: 14,
  writesBlocked: false,
  checkoutPending: null,
  access: {
    mode: "full",
    reason: "pilot",
    canWrite: true,
    canUseAi: true,
    locationLimit: null,
    pendingLocationLimit: null,
    newLinkLimit: null,
    memberLimit: null,
    endsAt: null,
  },
  billableLocations: 1,
  catalog: [PLAN],
  checkout: { available: true, reason: null },
  canManage: true,
}

const TRIALING = {
  ...PILOT,
  state: "trialing",
  environment: "test",
  plan: PLAN,
  trialEndsAt: "2030-01-15T10:00:00.000Z",
  hasCustomer: true,
  providerSyncedAt: "2030-01-01T10:00:05.000Z",
  trialDays: 0,
  access: {
    ...PILOT.access,
    reason: "trialing",
    locationLimit: 10,
    newLinkLimit: 10,
    endsAt: "2030-01-15T10:00:00.000Z",
  },
}

const READ_ONLY = {
  ...TRIALING,
  state: "canceled",
  writesBlocked: true,
  access: {
    ...TRIALING.access,
    mode: "read_only",
    reason: "subscription_ended",
    canWrite: false,
    canUseAi: false,
    endsAt: null,
  },
}

async function applyCookie(
  page: Page,
  baseURL: string | undefined,
  cookie: string
) {
  const [name, value] = cookie.split("=", 2)
  await page.context().addCookies([{ name, value, url: baseURL! }])
}

async function stubBilling(page: Page, body: () => object) {
  await page.route("**/api/billing", (route: Route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: body() })
      : route.fallback()
  )
}

test.describe("billing", () => {
  test("an owner sees test offers marked and is sent to Stripe's page for checkout", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await stubBilling(page, () => PILOT)
    let checkoutBody: unknown = null
    await page.route("**/api/billing/checkout", async (route) => {
      checkoutBody = route.request().postDataJSON()
      await route.fulfill({
        json: {
          url: "https://checkout.stripe.com/c/pay/cs_test_e2e",
          expiresAt: "2030-01-01T11:00:00.000Z",
          reused: false,
          trialDays: 14,
        },
      })
    })
    await page.route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Stripe Checkout stub</title><h1>Stripe Checkout stub</h1>",
      })
    )

    await page.goto("/settings/billing")
    await expect(
      page.getByRole("heading", { name: "Billing", level: 1 })
    ).toBeVisible()
    await expect(page.getByText("Test mode")).toBeVisible()
    const large = page.locator('[data-plan-code="large"]')
    await expect(large.getByText("Test offer")).toBeVisible()
    await expect(page.getByText(/14-day free trial/)).toBeVisible()
    await large.getByRole("button", { name: "Subscribe to Large" }).click()
    await expect(
      page.getByRole("heading", { name: "Stripe Checkout stub" })
    ).toBeVisible()
    expect(checkoutBody).toEqual({ planId: PLAN.id })
  })

  test("the return from Checkout waits for the provider sync before confirming", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    let reads = 0
    await stubBilling(page, () => (++reads >= 3 ? TRIALING : PILOT))
    await page.goto("/settings/billing?checkout=returned")
    await expect(page).toHaveURL(/\/settings\/billing\/confirming$/)
    await expect(
      page.getByRole("heading", { name: "Confirming subscription" })
    ).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "Subscription confirmed" })
    ).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByText(/Free trial until 15 January 2030/)
    ).toBeVisible()
  })

  test("a read-only workspace sees the banner on every page, with the way to Billing", async ({
    baseURL,
    page,
  }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.cookie)
    await stubBilling(page, () => READ_ONLY)
    await page.goto("/settings")
    const banner = page.locator('[data-slot="billing-banner"]')
    await expect(banner).toContainText("The subscription has ended")
    await expect(banner).toContainText("You can still view everything")
    await banner.getByRole("link", { name: "Go to Billing" }).click()
    await expect(page).toHaveURL(/\/settings\/billing$/)
    await expect(page.locator('[data-slot="billing-banner"]')).toHaveCount(0)
    await expect(page.getByText("Cancelled").first()).toBeVisible()
  })

  test("a member gets Usage but not Billing", async ({ baseURL, page }) => {
    const state = await readJourneyState()
    await applyCookie(page, baseURL, state.memberUnassignedCookie)
    await page.goto("/settings/usage")
    await expect(
      page.getByRole("heading", { name: "Usage", level: 1 })
    ).toBeVisible()
    const nav = page.getByRole("navigation", { name: "Settings sections" })
    await expect(nav.getByRole("link", { name: "Usage" })).toBeVisible()
    await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0)
    await page.goto("/settings/billing")
    await expect(
      page.getByRole("heading", {
        name: /You don.t have access to this page/,
        level: 1,
      })
    ).toBeVisible()
  })

  for (const theme of ["light", "dark"] as const) {
    for (const [path, heading, body] of [
      ["/settings/billing", "Billing", TRIALING],
      ["/settings/usage", "Usage", TRIALING],
    ] as const) {
      test(`${heading} passes axe (${theme})`, async ({ baseURL, page }) => {
        await page.emulateMedia({ colorScheme: theme })
        const state = await readJourneyState()
        await applyCookie(page, baseURL, state.cookie)
        await stubBilling(page, () => body)
        await page.goto(path)
        await expect(
          page.getByRole("heading", { name: heading, level: 1 })
        ).toBeVisible()
        await pageSettled(page)
        const wcag = await new AxeBuilder({ page })
          .withTags(WCAG_TAGS)
          .analyze()
        expect(wcag.violations, `${theme} ${heading} wcag`).toEqual([])
      })
    }
  }
})
