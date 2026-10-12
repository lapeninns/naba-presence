import {
  billingOverviewSchema,
  cancelResultSchema,
  checkoutResultSchema,
  planChangeResultSchema,
  portalResultSchema,
} from "@/lib/contracts/billing"

import { apiFetch, type RequestOptions } from "./client"

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
  return apiFetch("/api/billing", { schema: billingOverviewSchema, ...options })
}

/** Owner only: a Stripe Checkout session for one plan from the catalog. */
export function startCheckout(planId: string) {
  return apiFetch("/api/billing/checkout", {
    method: "POST",
    body: { planId },
    schema: checkoutResultSchema,
  })
}

/** Owner only: a Customer Portal session (payment methods, invoices). */
export function openBillingPortal() {
  return apiFetch("/api/billing/portal", {
    method: "POST",
    schema: portalResultSchema,
  })
}

/** Owner only: bill another plan from the next period boundary. */
export function changePlan(planId: string) {
  return apiFetch("/api/billing/plan-change", {
    method: "POST",
    body: { planId },
    schema: planChangeResultSchema,
  })
}

/** Owner only: cancel at the period end (true) or resume (false). */
export function setCancelAtPeriodEnd(cancelAtPeriodEnd: boolean) {
  return apiFetch("/api/billing/cancel", {
    method: "POST",
    body: { cancelAtPeriodEnd },
    schema: cancelResultSchema,
  })
}
