"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  type BillingOverview,
  changePlan,
  getBilling,
  openBillingPortal,
  setCancelAtPeriodEnd,
  startCheckout,
} from "@/lib/api/billing"
import { isStripeHostedUrl } from "@/lib/billing/presentation"

import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"
import { useSession } from "./use-session"

/**
 * The organisation's billing overview (GET /api/billing), keyed by the
 * session's organisation. `background` reads (the shell banner) never send
 * the viewer to sign-in; `pollMs` keeps refetching (the confirming screen).
 */
export function useBilling(
  options: {
    background?: boolean
    /** Interval, or a function of the latest overview (false stops). */
    pollMs?: number | false | ((data: BillingOverview | undefined) => number | false)
  } = {}
) {
  const session = useSession().data?.session
  const organisationId = session?.organisationId ?? null
  return useQuery({
    queryKey: queryKeys.billing(organisationId ?? "none"),
    queryFn: (ctx) =>
      getBilling({
        ...requestOptions(ctx),
        ...(options.background ? { background: true } : {}),
      }),
    enabled: organisationId !== null,
    refetchInterval: (query) => {
      const poll = options.pollMs ?? false
      return typeof poll === "function" ? poll(query.state.data) : poll
    },
    ...(options.background ? { retry: false } : {}),
  })
}

/** The Stripe page a billing action returned, or an error naming it. */
class UnexpectedBillingRedirect extends Error {
  constructor() {
    super("The billing page could not be opened. Nothing has been charged.")
    this.name = "UnexpectedBillingRedirect"
  }
}

function goToStripe(url: string) {
  // Only Stripe's hosted Checkout and Customer Portal are followed.
  if (!isStripeHostedUrl(url)) throw new UnexpectedBillingRedirect()
  window.location.assign(url)
}

/** Starts (or reopens) Checkout for a plan and goes to Stripe's page. */
export function useStartCheckout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (planId: string) => {
      const result = await startCheckout(planId)
      goToStripe(result.url)
      return result
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.billingAll }),
  })
}

/** Opens the Customer Portal (payment methods and invoices). */
export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: async () => {
      const result = await openBillingPortal()
      goToStripe(result.url)
      return result
    },
  })
}

/** Schedules (or clears) a plan change at the next boundary. */
export function useChangePlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (planId: string) => changePlan(planId),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.billingAll }),
  })
}

/** Cancels at the period end, or resumes. */
export function useCancelSubscription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (cancel: boolean) => setCancelAtPeriodEnd(cancel),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.billingAll }),
  })
}
