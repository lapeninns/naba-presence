import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BillingBanner } from "@/components/app-shell/billing-banner"
import { BillingCard } from "@/components/settings/billing-card"
import { BillingConfirming } from "@/components/settings/billing-confirming"
import { PlanUsageCard } from "@/components/settings/plan-usage-card"
import type { BillingOverview, Plan } from "@/lib/api/billing"
import { CONFIRMATION_PATIENCE_MS } from "@/lib/billing/presentation"
import * as billingHooks from "@/lib/queries/use-billing"

let pathname = "/inbox"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))

const SMALL: Plan = {
  id: "00000000-0000-4000-8000-0000000000a1",
  code: "small",
  version: 1,
  workspaceMode: "business",
  environment: "test",
  name: "Small",
  locationLimit: 2,
  memberLimit: 3,
  aiDraftCreditsPerPeriod: 100,
  isTestOffer: true,
  active: true,
}
const LARGE: Plan = {
  ...SMALL,
  id: "00000000-0000-4000-8000-0000000000a2",
  code: "large",
  name: "Large",
  locationLimit: 10,
  memberLimit: null,
  aiDraftCreditsPerPeriod: 500,
}

const PILOT: BillingOverview = {
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
  billableLocations: 3,
  catalog: [SMALL, LARGE],
  checkout: { available: true, reason: null },
  canManage: true,
}

const ACTIVE: BillingOverview = {
  ...PILOT,
  state: "active",
  environment: "test",
  plan: LARGE,
  currentPeriodEnd: "2026-11-14T08:00:00.000Z",
  hasCustomer: true,
  providerSyncedAt: "2026-10-14T08:00:05.000Z",
  trialDays: 0,
  access: {
    ...PILOT.access,
    reason: "active",
    locationLimit: 10,
    newLinkLimit: 10,
    endsAt: "2026-11-14T08:00:00.000Z",
  },
  billableLocations: 1,
}

const READ_ONLY_ACCESS: BillingOverview["access"] = {
  ...ACTIVE.access,
  mode: "read_only",
  reason: "grace_expired",
  canWrite: false,
  canUseAi: false,
  endsAt: null,
}

type Mutation = { mutate: ReturnType<typeof vi.fn> }

function mutation(overrides: Partial<UseMutationResult> = {}) {
  return {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
    ...overrides,
  } as unknown as UseMutationResult<never, Error, never> & Mutation
}

function mockBilling(data: BillingOverview | undefined, extra: object = {}) {
  vi.spyOn(billingHooks, "useBilling").mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  } as unknown as UseQueryResult<BillingOverview>)
  const checkout = mutation()
  const change = mutation()
  const portal = mutation()
  const cancel = mutation()
  vi.spyOn(billingHooks, "useStartCheckout").mockReturnValue(checkout as never)
  vi.spyOn(billingHooks, "useChangePlan").mockReturnValue(change as never)
  vi.spyOn(billingHooks, "useOpenBillingPortal").mockReturnValue(
    portal as never
  )
  vi.spyOn(billingHooks, "useCancelSubscription").mockReturnValue(
    cancel as never
  )
  return { checkout, change, portal, cancel }
}

const plan = (code: string) =>
  screen
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("data-plan-code") === code)!

describe("BillingCard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("shows a pilot, marks test offers on each plan, and starts checkout for one", async () => {
    const user = userEvent.setup()
    const { checkout } = mockBilling(PILOT)
    render(<BillingCard />)
    expect(screen.getByText(/Pilot access: every feature/)).toBeVisible()
    expect(screen.getByText("3 locations linked, no limit")).toBeVisible()
    expect(screen.getByText("Test mode")).toBeVisible()
    for (const code of ["small", "large"]) {
      expect(within(plan(code)).getByText("Test offer")).toBeVisible()
    }
    expect(screen.getByText(/14-day free trial/)).toBeVisible()
    // Small allows 2 and 3 are linked. Checkout does not refuse that (nor
    // does the server); the plan says what the limit will mean.
    const small = within(plan("small")).getByRole("button", {
      name: /Subscribe to Small/,
    })
    expect(small).not.toHaveAttribute("aria-disabled")
    expect(
      within(plan("small")).getByText(
        /3 locations are linked and this plan allows 2\. None are unlinked, but no new location can be linked until fewer than 2 are linked\./
      )
    ).toBeVisible()
    await user.click(small)
    expect(checkout.mutate).toHaveBeenCalledWith(SMALL.id)
    expect(within(plan("large")).queryByText(/are linked/)).toBeNull()
    await user.click(
      within(plan("large")).getByRole("button", { name: "Subscribe to Large" })
    )
    expect(checkout.mutate).toHaveBeenCalledWith(LARGE.id)
    // No portal before a customer exists, and nothing to cancel.
    expect(
      screen.queryByRole("button", { name: /Payment details/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Cancel subscription/ })
    ).not.toBeInTheDocument()
  })

  it("keeps checkout off while billing is unavailable and says why", () => {
    mockBilling({
      ...PILOT,
      checkout: { available: false, reason: "secret_key_missing" },
    })
    render(<BillingCard />)
    const button = within(plan("large")).getByRole("button", {
      name: /Subscribe to Large/,
    })
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveAccessibleDescription(
      "Subscriptions are not available yet. Nothing has been charged."
    )
  })

  it("says an empty catalog in words", () => {
    mockBilling({
      ...PILOT,
      catalog: [],
      checkout: { available: false, reason: "catalog_empty" },
    })
    render(<BillingCard />)
    expect(
      screen.getByText("No plans are on offer for this workspace yet.")
    ).toBeVisible()
  })

  it("offers to continue an open checkout for the same plan", () => {
    mockBilling({
      ...PILOT,
      checkoutPending: {
        planId: LARGE.id,
        expiresAt: "2026-10-12T10:10:00.000Z",
      },
    })
    render(<BillingCard />)
    expect(screen.getByText(/A checkout was started for Large/)).toBeVisible()
    expect(
      within(plan("large")).getByRole("button", { name: "Continue checkout" })
    ).toBeEnabled()
  })

  it("shows an active plan's renewal, the portal, and a plan change at renewal", async () => {
    const user = userEvent.setup()
    const { change, portal } = mockBilling(ACTIVE)
    render(<BillingCard />)
    expect(
      screen.getByText("Active. Renews on 14 November 2026.")
    ).toBeVisible()
    expect(screen.getByText("Renews on")).toBeVisible()
    expect(screen.getByText("1 of 10 locations linked")).toBeVisible()
    expect(
      screen.getByText(/A new plan starts at the next renewal/)
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: /Payment details/ }))
    expect(portal.mutate).toHaveBeenCalled()
    await user.click(
      within(plan("small")).getByRole("button", { name: "Switch to Small" })
    )
    expect(change.mutate).toHaveBeenCalledWith(SMALL.id)
    expect(
      within(plan("large")).getByRole("button", { name: "Current plan" })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it("shows a scheduled downgrade, its lower link limit, and lets the owner keep the plan", async () => {
    const user = userEvent.setup()
    const { change } = mockBilling({
      ...ACTIVE,
      pendingPlan: SMALL,
      pendingEffectiveAt: "2026-11-14T08:00:00.000Z",
      access: { ...ACTIVE.access, pendingLocationLimit: 2, newLinkLimit: 2 },
    })
    render(<BillingCard />)
    expect(screen.getByText(/Changes to/)).toHaveTextContent(
      "Changes to Small on 14 November 2026."
    )
    expect(
      screen.getByText(/new links must already fit that limit/)
    ).toBeVisible()
    await user.click(screen.getAllByRole("button", { name: "Keep Large" })[0])
    expect(change.mutate).toHaveBeenCalledWith(LARGE.id)
  })

  it("confirms before cancelling, and says access continues to the period end", async () => {
    const user = userEvent.setup()
    const { cancel } = mockBilling(ACTIVE)
    render(<BillingCard />)
    await user.click(
      screen.getByRole("button", { name: "Cancel subscription" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText(/Full access continues until 14 November 2026/)
    ).toBeVisible()
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel subscription" })
    )
    expect(cancel.mutate).toHaveBeenCalledWith(true, expect.anything())
  })

  it("offers Resume for a scheduled cancellation", async () => {
    const user = userEvent.setup()
    const { cancel } = mockBilling({
      ...ACTIVE,
      cancelAtPeriodEnd: true,
      access: { ...ACTIVE.access, reason: "cancel_scheduled" },
    })
    render(<BillingCard />)
    expect(screen.getByText("Access ends")).toBeVisible()
    expect(screen.getByText("Ending")).toBeVisible()
    await user.click(
      screen.getByRole("button", { name: "Resume subscription" })
    )
    expect(cancel.mutate).toHaveBeenCalledWith(false)
  })

  it("still refuses a plan change below the linked locations", () => {
    mockBilling({ ...ACTIVE, billableLocations: 3 })
    render(<BillingCard />)
    expect(
      within(plan("small")).getByRole("button", { name: "Switch to Small" })
    ).toHaveAccessibleDescription(
      /3 locations are linked.*Unlink locations first/
    )
  })

  it("lets an owner cancel during the trial with no charge, then resume", async () => {
    const user = userEvent.setup()
    const trial: BillingOverview = {
      ...ACTIVE,
      state: "trialing",
      trialEndsAt: "2026-10-26T08:00:00.000Z",
      currentPeriodEnd: "2026-10-26T08:00:00.000Z",
      access: {
        ...ACTIVE.access,
        reason: "trialing",
        endsAt: "2026-10-26T08:00:00.000Z",
      },
    }
    const first = mockBilling(trial)
    const { unmount } = render(<BillingCard />)
    await user.click(
      screen.getByRole("button", { name: "Cancel subscription" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent(
      /Full access continues until 26 October 2026 and nothing is charged\..*You can resume before then\./
    )
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel subscription" })
    )
    expect(first.cancel.mutate).toHaveBeenCalledWith(true, expect.anything())
    unmount()
    vi.restoreAllMocks()

    // The record after the cancellation: still trialing, ending at trial end.
    const { cancel } = mockBilling({ ...trial, cancelAtPeriodEnd: true })
    render(<BillingCard />)
    expect(screen.getByText("Ending")).toBeVisible()
    expect(screen.getByText("Access ends")).toBeVisible()
    expect(
      screen.getByText(
        "Cancelled during the trial. Full access continues until 26 October 2026 with no charge, then the workspace becomes read-only."
      )
    ).toBeVisible()
    expect(screen.queryByText(/first payment is taken/)).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Cancel subscription" })
    ).toBeNull()
    expect(
      within(plan("small")).getByRole("button", { name: "Switch to Small" })
    ).toHaveAccessibleDescription(
      "Resume the subscription before changing plan."
    )
    await user.click(
      screen.getByRole("button", { name: "Resume subscription" })
    )
    expect(cancel.mutate).toHaveBeenCalledWith(false)
  })

  it("offers Resume for a cancellation scheduled while a payment has failed", async () => {
    const user = userEvent.setup()
    const { cancel } = mockBilling({
      ...ACTIVE,
      state: "past_due",
      cancelAtPeriodEnd: true,
      access: {
        ...ACTIVE.access,
        mode: "grace",
        reason: "payment_grace",
        endsAt: "2026-10-19T08:00:00.000Z",
      },
    })
    render(<BillingCard />)
    expect(screen.getByText("Payment failed")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "Cancel subscription" })
    ).toBeNull()
    expect(
      within(plan("small")).getByRole("button", { name: "Switch to Small" })
    ).toHaveAccessibleDescription(/Fix the payment first/)
    await user.click(
      screen.getByRole("button", { name: "Resume subscription" })
    )
    expect(cancel.mutate).toHaveBeenCalledWith(false)
  })

  it("never calls the grace deadline a renewal", () => {
    mockBilling({
      ...ACTIVE,
      state: "past_due",
      access: {
        ...ACTIVE.access,
        mode: "grace",
        reason: "payment_grace",
        endsAt: "2026-10-19T08:00:00.000Z",
      },
    })
    render(<BillingCard />)
    expect(screen.queryByText(/next renewal/)).toBeNull()
    expect(screen.getAllByText(/Fix the payment first/)[0]).toBeVisible()
  })

  it("says the trial end is when a plan change starts", () => {
    mockBilling({
      ...ACTIVE,
      state: "trialing",
      trialEndsAt: "2026-10-26T08:00:00.000Z",
      currentPeriodEnd: "2026-10-26T08:00:00.000Z",
      access: {
        ...ACTIVE.access,
        reason: "trialing",
        endsAt: "2026-10-26T08:00:00.000Z",
      },
    })
    render(<BillingCard />)
    expect(
      screen.getByText(
        /A new plan starts at the next renewal \(26 October 2026\)/
      )
    ).toBeVisible()
  })

  it("disables every billing action in a support session", () => {
    mockBilling({ ...ACTIVE, canManage: false })
    render(<BillingCard />)
    for (const name of [
      /Payment details/,
      /Cancel subscription/,
      /Switch to Small/,
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-disabled",
        "true"
      )
    }
  })

  it("says a read-only workspace's state and what restores it", () => {
    mockBilling({ ...ACTIVE, state: "past_due", access: READ_ONLY_ACCESS })
    render(<BillingCard />)
    expect(screen.getByText("Payment failed")).toBeVisible()
    expect(screen.getByText(/grace period has ended/)).toBeVisible()
    expect(
      within(plan("small")).getByRole("button", { name: "Switch to Small" })
    ).toHaveAccessibleDescription(/Fix the payment first/)
  })

  it("names a failed action in words", () => {
    mockBilling(ACTIVE)
    const failure = Object.assign(new Error("x"), {
      name: "UnexpectedBillingRedirect",
      message:
        "The billing page could not be opened. Nothing has been charged.",
    })
    vi.spyOn(billingHooks, "useOpenBillingPortal").mockReturnValue(
      mutation({ error: failure } as never) as never
    )
    render(<BillingCard />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The billing page could not be opened. Nothing has been charged."
    )
  })
})

describe("BillingBanner", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    pathname = "/inbox"
  })

  it("says nothing while access is full", () => {
    mockBilling(ACTIVE)
    const { container } = render(<BillingBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it("tells the owner what still works when enforcement refuses changes, with a way to Billing", () => {
    mockBilling({ ...ACTIVE, access: READ_ONLY_ACCESS, writesBlocked: true })
    render(<BillingBanner />)
    expect(screen.getByText(/You can still view everything/)).toBeVisible()
    expect(screen.getByRole("link", { name: "Go to Billing" })).toHaveAttribute(
      "href",
      "/settings/billing"
    )
  })

  it("says only AI drafting is off when enforcement is not on, and sends a member to the owner", () => {
    mockBilling({
      ...ACTIVE,
      access: READ_ONLY_ACCESS,
      writesBlocked: false,
      canManage: false,
    })
    render(<BillingBanner />)
    expect(screen.getByText(/AI drafting is off/)).toBeVisible()
    expect(screen.getByText(/Ask the workspace owner/)).toBeVisible()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })

  it("warns during grace with the date access continues to", () => {
    mockBilling({
      ...ACTIVE,
      state: "past_due",
      access: {
        ...ACTIVE.access,
        mode: "grace",
        reason: "payment_grace",
        endsAt: "2026-10-19T08:00:00.000Z",
      },
    })
    render(<BillingBanner />)
    expect(
      screen.getByText(/Full access continues until 19 October 2026/)
    ).toBeVisible()
  })

  it("stays off on the Billing screens, which say it in full", () => {
    pathname = "/settings/billing/confirming"
    mockBilling({ ...ACTIVE, access: READ_ONLY_ACCESS, writesBlocked: true })
    const { container } = render(<BillingBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it("links nowhere while the Billing screen is switched off", () => {
    mockBilling({
      ...ACTIVE,
      access: READ_ONLY_ACCESS,
      checkout: { available: false, reason: "billing_disabled" },
    })
    render(<BillingBanner />)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})

describe("BillingConfirming", () => {
  afterEach(() => vi.restoreAllMocks())

  it("waits for Stripe while the record still shows the pilot", () => {
    mockBilling(PILOT)
    render(<BillingConfirming />)
    expect(
      screen.getByRole("heading", { name: "Confirming subscription" })
    ).toBeVisible()
    expect(screen.getByText("Checking with Stripe…")).toBeVisible()
    expect(screen.queryByText(/Subscription confirmed/)).not.toBeInTheDocument()
  })

  it("polls until the record holds a provider-synced subscription", () => {
    mockBilling(PILOT)
    render(<BillingConfirming />)
    const options = vi.mocked(billingHooks.useBilling).mock.calls[0][0]!
    const poll = options.pollMs as (data?: BillingOverview) => number | false
    expect(poll(PILOT)).toBeGreaterThan(0)
    expect(poll({ ...ACTIVE, providerSyncedAt: null })).toBeGreaterThan(0)
    expect(poll(ACTIVE)).toBe(false)
    expect(
      poll({
        ...ACTIVE,
        state: "past_due",
        access: {
          ...ACTIVE.access,
          mode: "read_only",
          reason: "first_payment_failed",
        },
      })
    ).toBe(false)
  })

  it("does not call a subscription whose first payment failed confirmed", () => {
    mockBilling({
      ...ACTIVE,
      state: "past_due",
      access: READ_ONLY_ACCESS,
    })
    render(<BillingConfirming />)
    expect(
      screen.getByRole("heading", { name: "Subscription needs attention" })
    ).toBeVisible()
    expect(screen.queryByText(/Stripe has confirmed/)).toBeNull()
    expect(screen.getByText(/payment did not go through/)).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Back to Billing" })
    ).toHaveAttribute("href", "/settings/billing")
  })

  it("confirms once the processor has applied the subscription", () => {
    mockBilling({
      ...ACTIVE,
      state: "trialing",
      trialEndsAt: "2026-10-26T08:00:00.000Z",
      access: {
        ...ACTIVE.access,
        reason: "trialing",
        endsAt: "2026-10-26T08:00:00.000Z",
      },
    })
    render(<BillingConfirming />)
    expect(
      screen.getByRole("heading", { name: "Subscription confirmed" })
    ).toBeVisible()
    expect(screen.getByText(/Free trial until 26 October 2026/)).toBeVisible()
  })

  it("says the confirmation is late instead of spinning forever", async () => {
    vi.useFakeTimers()
    try {
      mockBilling(PILOT)
      let clock = 0
      render(<BillingConfirming now={() => clock} />)
      clock = CONFIRMATION_PATIENCE_MS + 1
      await vi.advanceTimersByTimeAsync(2_500)
      expect(
        screen.getByText(/Stripe has not confirmed the subscription yet/)
      ).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("PlanUsageCard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("shows linked locations against the limit for any member", () => {
    mockBilling({ ...ACTIVE, canManage: false, billableLocations: 10 })
    render(<PlanUsageCard />)
    expect(screen.getByText("10 of 10 locations linked")).toBeVisible()
    expect(screen.getByRole("progressbar")).toBeInTheDocument()
  })

  it("shows no limit bar for a pilot", () => {
    mockBilling(PILOT)
    render(<PlanUsageCard />)
    expect(screen.getByText("3 locations linked, no limit")).toBeVisible()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
})
