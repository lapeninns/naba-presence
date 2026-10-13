import { apiFetch, type RequestOptions } from "./client"

// Schemas load on demand (see `ResponseSchema` in ./client): the billing
// banner reads the overview on every page, and the contract pulls in zod.
const contract = () => import("@/lib/contracts/billing")

export type {
  BillingOverview,
  CancelResult,
  CheckoutResult,
  Plan,
  PlanChangeResult,
  PortalResult,
} from "@/lib/contracts/billing"

/** GET /api/billing: state, access, limits and the plans on offer. */
export function getBilling(options?: RequestOptions) {
  return apiFetch("/api/billing", {
    schema: () => contract().then((m) => m.billingOverviewSchema),
    ...options,
  })
}

/** Owner only: a Stripe Checkout session for one plan from the catalog. */
export function startCheckout(planId: string) {
  return apiFetch("/api/billing/checkout", {
    method: "POST",
    body: { planId },
    schema: () => contract().then((m) => m.checkoutResultSchema),
  })
}

/** Owner only: a Customer Portal session (payment methods, invoices). */
export function openBillingPortal() {
  return apiFetch("/api/billing/portal", {
    method: "POST",
    schema: () => contract().then((m) => m.portalResultSchema),
  })
}

/** Owner only: bill another plan from the next period boundary. */
export function changePlan(planId: string) {
  return apiFetch("/api/billing/plan-change", {
    method: "POST",
    body: { planId },
    schema: () => contract().then((m) => m.planChangeResultSchema),
  })
}

/** Owner only: cancel at the period end (true) or resume (false). */
export function setCancelAtPeriodEnd(cancelAtPeriodEnd: boolean) {
  return apiFetch("/api/billing/cancel", {
    method: "POST",
    body: { cancelAtPeriodEnd },
    schema: () => contract().then((m) => m.cancelResultSchema),
  })
}
