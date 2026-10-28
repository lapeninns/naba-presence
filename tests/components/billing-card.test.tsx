import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BillingBanner } from "@/components/app-shell/billing-banner"
import {
  BillingCard,
  CheckoutCanceledNotice,
} from "@/components/settings/billing-card"
import { BillingConfirming } from "@/components/settings/billing-confirming"
import { PlanUsageCard } from "@/components/settings/plan-usage-card"
import { toast } from "@/components/ui/toast"
import type { BillingOverview, Plan } from "@/lib/api/billing"
import { CONFIRMATION_PATIENCE_MS } from "@/lib/billing/presentation"
import * as billingHooks from "@/lib/queries/use-billing"

let pathname = "/inbox"
const router = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => router,
}))

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
    expect(change.mutate).toHaveBeenCalledWith(SMALL.id, expect.anything())
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
    expect(change.mutate).toHaveBeenCalledWith(LARGE.id, expect.anything())
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
    expect(cancel.mutate).toHaveBeenCalledWith(false, expect.anything())
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
    expect(cancel.mutate).toHaveBeenCalledWith(false, expect.anything())
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
    ).toHaveAccessibleDescription(/Update the payment method first/)
    await user.click(
      screen.getByRole("button", { name: "Resume subscription" })
    )
    expect(cancel.mutate).toHaveBeenCalledWith(false, expect.anything())
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
    expect(
      screen.getAllByText(/Update the payment method first/)[0]
    ).toBeVisible()
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
    ).toHaveAccessibleDescription(/Update the payment method first/)
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

const GRACE: BillingOverview = {
  ...ACTIVE,
  state: "past_due",
  access: {
    ...ACTIVE.access,
    mode: "grace",
    reason: "payment_grace",
    endsAt: "2026-10-19T08:00:00.000Z",
  },
}

// A mutation whose mutate answers like the server did, through onSuccess.
function answering(result: unknown) {
  return mutation({
    mutate: vi.fn(
      (_input: unknown, options?: { onSuccess?: (r: unknown) => void }) =>
        options?.onSuccess?.(result)
    ),
  } as never)
}

describe("BillingCard recovery, outcomes and notices", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    router.replace.mockReset()
  })

  it("leads a failed payment with what happened and the Portal to fix it", async () => {
    const user = userEvent.setup()
    const { portal } = mockBilling(GRACE)
    render(<BillingCard />)
    const alert = screen
      .getByText("Your last payment didn’t go through")
      .closest("[data-slot='billing-attention']") as HTMLElement
    expect(alert).not.toBeNull()
    // Said once: in the alert, not again under "Subscription".
    expect(
      screen.getAllByText(/A payment failed\. Full access continues/)
    ).toHaveLength(1)
    expect(within(alert).getByText(/A payment failed/)).toBeVisible()
    await user.click(
      within(alert).getByRole("button", { name: "Update payment method" })
    )
    expect(portal.mutate).toHaveBeenCalledTimes(1)
  })

  it("keeps the recovery action blocked in a support session", () => {
    mockBilling({ ...GRACE, canManage: false })
    render(<BillingCard />)
    expect(
      screen.getByRole("button", { name: "Update payment method" })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it("points a cancelled, read-only workspace at the plans", () => {
    mockBilling({
      ...ACTIVE,
      state: "canceled",
      access: { ...READ_ONLY_ACCESS, reason: "subscription_ended" },
    })
    render(<BillingCard />)
    expect(screen.getByText("Your subscription has ended")).toBeVisible()
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      "#billing-plans"
    )
    expect(
      screen.queryByRole("button", { name: "Update payment method" })
    ).toBeNull()
  })

  it("never asks for a payment once a cancelled subscription has ended", () => {
    // Still "active" until the webhook flips it, but the period has passed.
    mockBilling({
      ...ACTIVE,
      cancelAtPeriodEnd: true,
      hasCustomer: true,
      access: { ...READ_ONLY_ACCESS, reason: "subscription_ended" },
    })
    render(<BillingCard />)
    const alert = screen
      .getByText("Your subscription has ended")
      .closest("[data-slot='billing-attention']") as HTMLElement
    expect(within(alert).getByText(/The subscription has ended/)).toBeVisible()
    expect(screen.queryByText(/Payment needed/)).toBeNull()
    expect(
      within(alert).queryByRole("button", { name: "Update payment method" })
    ).toBeNull()
  })

  it("words an unconfirmed renewal as waiting, not as a failed payment", async () => {
    const user = userEvent.setup()
    const { portal } = mockBilling({
      ...ACTIVE,
      hasCustomer: true,
      access: { ...READ_ONLY_ACCESS, reason: "renewal_unconfirmed" },
    })
    render(<BillingCard />)
    const alert = screen
      .getByText("Waiting for the renewal payment to be confirmed")
      .closest("[data-slot='billing-attention']") as HTMLElement
    expect(screen.queryByText(/Payment needed/)).toBeNull()
    await user.click(
      within(alert).getByRole("button", { name: "Check payment details" })
    )
    expect(portal.mutate).toHaveBeenCalledTimes(1)
  })

  it("asks for a payment when the first payment failed", () => {
    mockBilling({
      ...ACTIVE,
      state: "past_due",
      hasCustomer: true,
      access: { ...READ_ONLY_ACCESS, reason: "first_payment_failed" },
    })
    render(<BillingCard />)
    expect(
      screen.getByText("Payment needed to restore full access")
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Update payment method" })
    ).toBeVisible()
  })

  it("offers no action for a state only support can resolve", () => {
    mockBilling({
      ...PILOT,
      state: null,
      access: { ...READ_ONLY_ACCESS, reason: "billing_missing" },
    })
    render(<BillingCard />)
    const alert = screen
      .getByText("This workspace is read-only")
      .closest("[data-slot='billing-attention']") as HTMLElement
    expect(within(alert).queryByRole("link")).toBeNull()
    expect(within(alert).queryByRole("button")).toBeNull()
  })

  it("shows no recovery alert while access is full", () => {
    mockBilling(ACTIVE)
    const { container } = render(<BillingCard />)
    expect(
      container.querySelector("[data-slot='billing-attention']")
    ).toBeNull()
  })

  it("says a reason that holds for every plan once, above the list", () => {
    mockBilling({
      ...PILOT,
      checkout: { available: false, reason: "secret_key_missing" },
    })
    render(<BillingCard />)
    // Visible once; the buttons' own copies are hidden descriptions.
    expect(
      screen
        .getAllByText(
          "Subscriptions are not available yet. Nothing has been charged."
        )
        .filter((node) => !node.closest("[hidden]"))
    ).toHaveLength(1)
    for (const code of ["small", "large"]) {
      expect(
        within(plan(code)).getByRole("button")
      ).toHaveAccessibleDescription(
        "Subscriptions are not available yet. Nothing has been charged."
      )
    }
  })

  it("confirms a scheduled plan change from the server's answer", async () => {
    const user = userEvent.setup()
    const add = vi.spyOn(toast, "add").mockReturnValue("t")
    mockBilling(ACTIVE)
    vi.spyOn(billingHooks, "useChangePlan").mockReturnValue(
      answering({
        outcome: "scheduled",
        pendingPlanId: SMALL.id,
        pendingEffectiveAt: "2026-11-14T08:00:00.000Z",
      }) as never
    )
    render(<BillingCard />)
    await user.click(
      within(plan("small")).getByRole("button", { name: "Switch to Small" })
    )
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Small starts on 14 November 2026",
        description: "Nothing is charged now.",
      })
    )
  })

  it("confirms keeping the plan, and says nothing when nothing changed", async () => {
    const user = userEvent.setup()
    const add = vi.spyOn(toast, "add").mockReturnValue("t")
    const scheduled: BillingOverview = {
      ...ACTIVE,
      pendingPlan: SMALL,
      pendingEffectiveAt: "2026-11-14T08:00:00.000Z",
    }
    mockBilling(scheduled)
    vi.spyOn(billingHooks, "useChangePlan").mockReturnValue(
      answering({
        outcome: "cleared",
        pendingPlanId: null,
        pendingEffectiveAt: null,
      }) as never
    )
    const { unmount } = render(<BillingCard />)
    await user.click(screen.getAllByRole("button", { name: "Keep Large" })[0])
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ title: "You’ll stay on Large" })
    )
    unmount()
    add.mockClear()
    vi.spyOn(billingHooks, "useChangePlan").mockReturnValue(
      answering({
        outcome: "unchanged",
        pendingPlanId: SMALL.id,
        pendingEffectiveAt: "2026-11-14T08:00:00.000Z",
      }) as never
    )
    render(<BillingCard />)
    await user.click(screen.getAllByRole("button", { name: "Keep Large" })[0])
    expect(add).not.toHaveBeenCalled()
  })

  it("confirms a cancellation and returns focus to the subscription", async () => {
    const user = userEvent.setup()
    const add = vi.spyOn(toast, "add").mockReturnValue("t")
    mockBilling(ACTIVE)
    vi.spyOn(billingHooks, "useCancelSubscription").mockReturnValue(
      answering({
        outcome: "updated",
        cancelAtPeriodEnd: true,
        clearedPendingPlan: false,
      }) as never
    )
    render(<BillingCard />)
    const subscription = screen.getByRole("region", { name: "Subscription" })
    await user.click(
      screen.getByRole("button", { name: "Cancel subscription" })
    )
    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel subscription" })
    )
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Subscription cancelled",
        description: "Full access continues until 14 November 2026.",
      })
    )
    // Focus lands back in the Subscription block, not on the page body.
    await vi.waitFor(() =>
      expect(subscription.parentElement!.contains(document.activeElement)).toBe(
        true
      )
    )
    // A programmatic target, never a Tab stop, with a visible focus halo.
    const target = subscription.closest(
      "[data-slot='billing-subscription-focus']"
    )
    expect(target).toHaveAttribute("tabindex", "-1")
    expect(target).toHaveClass("focus-halo")
  })

  it("returns focus to the Cancel trigger when the subscription is kept", async () => {
    const user = userEvent.setup()
    mockBilling(ACTIVE)
    render(<BillingCard />)
    const trigger = screen.getByRole("button", { name: "Cancel subscription" })
    await user.click(trigger)
    const dialog = await screen.findByRole("alertdialog")
    await user.click(
      within(dialog).getByRole("button", { name: "Keep subscription" })
    )
    await vi.waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    await screen.findByRole("alertdialog")
    await user.keyboard("{Escape}")
    await vi.waitFor(() => expect(trigger).toHaveFocus())
  })

  it("confirms a resumed subscription only after the server's answer", async () => {
    const user = userEvent.setup()
    const add = vi.spyOn(toast, "add").mockReturnValue("t")
    const ending: BillingOverview = {
      ...ACTIVE,
      cancelAtPeriodEnd: true,
      access: { ...ACTIVE.access, reason: "cancel_scheduled" },
    }
    const { cancel } = mockBilling(ending)
    const { unmount } = render(<BillingCard />)
    await user.click(
      screen.getByRole("button", { name: "Resume subscription" })
    )
    // The default mock never answers: no success is shown.
    expect(cancel.mutate).toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    unmount()
    vi.spyOn(billingHooks, "useCancelSubscription").mockReturnValue(
      answering({
        outcome: "updated",
        cancelAtPeriodEnd: false,
        clearedPendingPlan: false,
      }) as never
    )
    render(<BillingCard />)
    await user.click(
      screen.getByRole("button", { name: "Resume subscription" })
    )
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Subscription resumed" })
    )
  })

  it("lets the owner dismiss the cancelled-checkout notice without a server call", async () => {
    const user = userEvent.setup()
    render(<CheckoutCanceledNotice />)
    expect(screen.getByText("Checkout was not completed")).toBeVisible()
    expect(screen.getByText(/You can subscribe again below\./)).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(router.replace).toHaveBeenCalledWith("/settings/billing", {
      scroll: false,
    })
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

describe("BillingConfirming outcomes", () => {
  afterEach(() => vi.restoreAllMocks())

  const TRIAL_LARGE: BillingOverview = {
    ...ACTIVE,
    state: "trialing",
    trialEndsAt: "2026-10-26T08:00:00.000Z",
    access: {
      ...ACTIVE.access,
      reason: "trialing",
      endsAt: "2026-10-26T08:00:00.000Z",
    },
  }

  it("announces a confirmed outcome and names the plan from the record", () => {
    mockBilling(TRIAL_LARGE)
    render(<BillingConfirming />)
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent(
      /^Subscription confirmed\. Free trial until 26 October 2026/
    )
    expect(
      screen.getByText("Stripe has confirmed the Large plan.")
    ).toBeVisible()
  })

  it("announces attention, and never names a plan that is not confirmed", () => {
    mockBilling({ ...ACTIVE, state: "past_due", access: READ_ONLY_ACCESS })
    render(<BillingConfirming />)
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Subscription needs attention\./
    )
    expect(screen.queryByText(/Large plan/)).toBeNull()
  })

  it("does not name a plan while still waiting for the provider sync", () => {
    mockBilling({ ...TRIAL_LARGE, providerSyncedAt: null })
    render(<BillingConfirming />)
    expect(
      screen.getByRole("heading", { name: "Confirming subscription" })
    ).toBeVisible()
    expect(screen.queryByText(/Large/)).toBeNull()
  })

  it("says it is still waiting, and still checking, once Stripe is late", async () => {
    vi.useFakeTimers()
    try {
      mockBilling(PILOT)
      let clock = 0
      render(<BillingConfirming now={() => clock} />)
      clock = CONFIRMATION_PATIENCE_MS + 1
      await vi.advanceTimersByTimeAsync(2_500)
      expect(
        screen.getByRole("heading", { name: "Still waiting for Stripe" })
      ).toBeInTheDocument()
      expect(screen.getByText("Still checking…")).toBeInTheDocument()
      expect(screen.queryByText(/charged/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("calls a failed read a failed read, not a Stripe delay", async () => {
    vi.useFakeTimers()
    try {
      mockBilling(undefined, { isError: true })
      let clock = 0
      render(<BillingConfirming now={() => clock} />)
      clock = CONFIRMATION_PATIENCE_MS + 1
      await vi.advanceTimersByTimeAsync(2_500)
      // Announced once: in the status, with no second live region.
      expect(screen.queryByRole("alert")).toBeNull()
      expect(screen.queryByText(/Stripe has not confirmed/)).toBeNull()
      expect(
        screen.queryByRole("heading", { name: "Still waiting for Stripe" })
      ).toBeNull()
      expect(screen.getByRole("status")).toHaveTextContent(
        /Billing could not be loaded\.\s*Trying again…/
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("PlanUsageCard", () => {
  afterEach(() => vi.restoreAllMocks())

  it("says a full plan in words, and turns red only once it is over", () => {
    mockBilling({ ...ACTIVE, billableLocations: 10 })
    const { container, unmount } = render(<PlanUsageCard />)
    expect(
      screen.getByText(
        /location limit is reached, so another location can’t be linked/
      )
    ).toBeVisible()
    expect(container.querySelector(".bg-danger-solid")).toBeNull()
    unmount()
    vi.restoreAllMocks()
    mockBilling({ ...ACTIVE, billableLocations: 11 })
    const over = render(<PlanUsageCard />)
    expect(over.container.querySelector(".bg-danger-solid")).not.toBeNull()
  })

  it("does not add the limit line while the workspace is read-only", () => {
    mockBilling({
      ...ACTIVE,
      billableLocations: 10,
      access: { ...READ_ONLY_ACCESS, locationLimit: 10 },
    })
    render(<PlanUsageCard />)
    expect(screen.queryByText(/location limit is reached/)).toBeNull()
  })

  it("links the owner to Billing to change the plan", () => {
    mockBilling(ACTIVE)
    render(<PlanUsageCard />)
    expect(screen.getByRole("link", { name: "Change plan" })).toHaveAttribute(
      "href",
      "/settings/billing"
    )
    expect(
      screen.queryByText("Only the workspace owner can change the plan.")
    ).toBeNull()
  })

  it("tells anyone else who can change the plan, with no link", () => {
    mockBilling({ ...ACTIVE, canManage: false })
    render(<PlanUsageCard />)
    expect(screen.queryByRole("link", { name: "Change plan" })).toBeNull()
    expect(
      screen.getByText("Only the workspace owner can change the plan.")
    ).toBeVisible()
  })

  it("says Pilot once", () => {
    mockBilling(PILOT)
    render(<PlanUsageCard />)
    expect(screen.getAllByText("Pilot")).toHaveLength(1)
  })

  it("offers a retry when the plan could not be loaded", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    mockBilling(undefined, { isError: true, refetch })
    render(<PlanUsageCard />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The plan could not be loaded."
    )
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("says it is loading to assistive tech", () => {
    mockBilling(undefined, { isPending: true })
    render(<PlanUsageCard />)
    expect(screen.getByRole("status")).toHaveTextContent("Loading plan")
  })

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

// C-S1: the server never has billing, but the shell's banner can fill the
// query cache before a billing screen hydrates. The hydration render must
// still be the server's pending markup (React #418); the record lands after.
describe("billing screens hydrate from a filled cache", () => {
  afterEach(() => vi.restoreAllMocks())

  async function hydrateWithCache(page: () => ReactElement) {
    mockBilling(undefined, { isPending: true })
    const html = renderToString(page())
    const container = document.createElement("div")
    container.innerHTML = html
    document.body.appendChild(container)
    mockBilling(ACTIVE)
    const errors: unknown[] = []
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, page(), {
        onRecoverableError: (error) => errors.push(error),
      })
    })
    const hydrationErrors = [
      ...errors.map(String),
      ...consoleError.mock.calls
        .map((call) => call.map(String).join(" "))
        .filter((line) => /hydrat|didn't match/i.test(line)),
    ]
    const text = container.textContent
    act(() => root!.unmount())
    container.remove()
    return { hydrationErrors, text }
  }

  it("PlanUsageCard matches the server's skeleton, then shows the plan", async () => {
    const { hydrationErrors, text } = await hydrateWithCache(() => (
      <PlanUsageCard />
    ))
    expect(hydrationErrors).toEqual([])
    expect(text).toMatch(/locations linked/)
  })

  it("BillingConfirming matches the server's wait, then confirms", async () => {
    const { hydrationErrors, text } = await hydrateWithCache(() => (
      <BillingConfirming now={() => 0} />
    ))
    expect(hydrationErrors).toEqual([])
    expect(text).toContain("Subscription confirmed")
  })
})
