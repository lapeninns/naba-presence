"use client"

import Link from "next/link"
import * as React from "react"

import { buttonVariants } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  CONFIRMATION_POLL_MS,
  confirmationPhase,
  describeBilling,
} from "@/lib/billing/presentation"
import { useHydrated } from "@/lib/hooks/use-hydrated"
import { useBilling } from "@/lib/queries/use-billing"

const BILLING_PATH = "/settings/billing"

const systemNow = () => Date.now()

/**
 * "Confirming subscription" (plan P07-S6), where Stripe Checkout returns.
 * Returning from Checkout proves nothing: the subscription exists for this
 * app only once the webhook processor (or the hourly reconciliation) has
 * fetched it from Stripe and advanced the record's provider sync. Until then
 * this polls GET /api/billing and says it is waiting; after a few minutes
 * it says the confirmation is late (and that it is still checking) rather
 * than spinning silently. A failed read is said as that, never as a delay.
 */
export function BillingConfirming({
  now = systemNow,
}: {
  /** Injected for tests. */
  now?: () => number
}) {
  const [startedAt] = React.useState(now)
  const [elapsed, setElapsed] = React.useState(0)
  // Polls until the record shows the confirmed subscription.
  const billing = useBilling({
    pollMs: (latest) =>
      latest &&
      confirmationPhase({
        state: latest.state,
        providerSyncedAt: latest.providerSyncedAt,
        accessMode: latest.access.mode,
        elapsedMs: 0,
      }) !== "confirming"
        ? false
        : CONFIRMATION_POLL_MS,
  })
  // The server never has billing, so it renders "Checking with Stripe…".
  // The shell's billing banner reads the same query and can fill the cache
  // before this page hydrates; the hydration render must still match the
  // server's (React #418), so the record lands one render later.
  const hydrated = useHydrated()
  const data = hydrated ? billing.data : undefined
  const phase = confirmationPhase({
    state: data?.state ?? null,
    providerSyncedAt: data?.providerSyncedAt ?? null,
    accessMode: data?.access.mode ?? null,
    elapsedMs: elapsed,
  })

  React.useEffect(() => {
    if (phase === "confirmed" || phase === "attention") return
    const timer = setInterval(
      () => setElapsed(now() - startedAt),
      CONFIRMATION_POLL_MS
    )
    return () => clearInterval(timer)
  }, [phase, now, startedAt])

  const confirmed = phase === "confirmed"
  const attention = phase === "attention"
  // A record we could not read says nothing about Stripe: it is not called
  // a Stripe delay, only that loading failed and is being retried.
  const loadFailed = hydrated && billing.isError && !data
  const delayed = phase === "delayed" && !loadFailed
  // The plan is named only from a record the server says is confirmed.
  const confirmedPlan = confirmed ? (data?.plan?.name ?? null) : null

  return (
    // A centred state block (title, one line, the live status, one action),
    // flat on a phone and in a card from md.
    <section
      aria-labelledby="billing-confirming-title"
      data-slot="billing-confirming"
      data-phase={phase}
      className="flex flex-col items-center gap-4 px-1 py-10 text-center md:rounded-(--np-radius-card) md:border md:border-line md:bg-surface md:p-(--np-card-pad) md:py-12"
    >
      <div className="flex max-w-prose flex-col gap-1.5">
        <h2
          id="billing-confirming-title"
          className="text-title font-semibold text-ink"
        >
          {confirmed
            ? "Subscription confirmed"
            : attention
              ? "Subscription needs attention"
              : delayed
                ? "Still waiting for Stripe"
                : "Confirming subscription"}
        </h2>
        <p className="m-0 text-ui text-ink-muted">
          {confirmed
            ? confirmedPlan
              ? `Stripe has confirmed the ${confirmedPlan} plan.`
              : "Stripe has confirmed the subscription."
            : attention
              ? "Stripe has the subscription, but its payment did not go through. Billing shows what to do next."
              : delayed
                ? "This is taking longer than usual. Nothing changes in this workspace until Stripe confirms the subscription."
                : "We are waiting for Stripe to confirm the subscription. Nothing changes in this workspace until it does."}
        </p>
      </div>
      <div className="flex max-w-prose flex-col items-center gap-3">
        <div role="status" aria-live="polite" className="text-body text-ink">
          {(confirmed || attention) && data ? (
            <p className="m-0">
              {/* The heading's change is not announced; this lead says the
                  outcome in the same polite update as the details. */}
              <span className="sr-only">
                {confirmed
                  ? "Subscription confirmed. "
                  : "Subscription needs attention. "}
              </span>
              {describeBilling(data)}
            </p>
          ) : delayed ? (
            <div className="flex flex-col items-center gap-2">
              <p className="m-0">
                Stripe has not confirmed the subscription yet. You can leave
                this page: Billing shows the subscription as soon as Stripe
                confirms it.
              </p>
              <p className="m-0 inline-flex items-center gap-2 text-ui text-ink-muted">
                <Spinner decorative size="sm" />
                Still checking…
              </p>
            </div>
          ) : loadFailed ? (
            // Said once, in this polite status: what failed, then that it
            // keeps trying. No separate alert repeats it.
            <div className="flex flex-col items-center gap-1">
              <p className="m-0 text-ui text-danger-ink">
                Billing could not be loaded.
              </p>
              <p className="m-0 inline-flex items-center gap-2">
                <Spinner decorative size="sm" />
                Trying again…
              </p>
            </div>
          ) : (
            <p className="m-0 inline-flex items-center gap-2">
              <Spinner decorative size="sm" />
              Checking with Stripe…
            </p>
          )}
        </div>
        <div>
          <Link
            href={BILLING_PATH}
            className={buttonVariants({
              variant: confirmed || attention ? "default" : "outline",
            })}
          >
            Back to Billing
          </Link>
        </div>
      </div>
    </section>
  )
}
