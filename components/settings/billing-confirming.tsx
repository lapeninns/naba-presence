"use client"

import Link from "next/link"
import * as React from "react"

import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import {
  CONFIRMATION_POLL_MS,
  confirmationPhase,
  describeAccess,
} from "@/lib/billing/presentation"
import { useBilling } from "@/lib/queries/use-billing"

const BILLING_PATH = "/settings/billing"

const systemNow = () => Date.now()

/**
 * "Confirming subscription" (plan P07-S6), where Stripe Checkout returns.
 * Returning from Checkout proves nothing: the subscription exists for this
 * app only once the webhook processor (or the hourly reconciliation) has
 * fetched it from Stripe and advanced the record's provider sync. Until then
 * this polls GET /api/billing and says it is waiting; after a few minutes
 * it says the confirmation is late rather than spinning forever.
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
        elapsedMs: 0,
      }) === "confirmed"
        ? false
        : CONFIRMATION_POLL_MS,
  })
  const data = billing.data
  const phase = confirmationPhase({
    state: data?.state ?? null,
    providerSyncedAt: data?.providerSyncedAt ?? null,
    elapsedMs: elapsed,
  })

  React.useEffect(() => {
    if (phase === "confirmed") return
    const timer = setInterval(
      () => setElapsed(now() - startedAt),
      CONFIRMATION_POLL_MS
    )
    return () => clearInterval(timer)
  }, [phase, now, startedAt])

  const confirmed = phase === "confirmed"

  return (
    <Card flush data-slot="billing-confirming" data-phase={phase}>
      <CardHeader divided>
        <CardTitle as="h2">
          {confirmed ? "Subscription confirmed" : "Confirming subscription"}
        </CardTitle>
        <CardDescription>
          {confirmed
            ? "Stripe has confirmed the subscription."
            : "We are waiting for Stripe to confirm the subscription. Nothing changes in this workspace until it does."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 py-(--np-card-pad)">
        <div role="status" aria-live="polite" className="text-body text-ink">
          {confirmed && data ? (
            <p className="m-0">{describeAccess(data.access)}</p>
          ) : phase === "delayed" ? (
            <p className="m-0">
              Stripe has not confirmed the subscription yet. This can take a few
              minutes. You can leave this page: Billing shows the subscription
              as soon as Stripe confirms it. If you closed the Stripe page
              before paying, nothing was charged.
            </p>
          ) : (
            <p className="m-0 inline-flex items-center gap-2">
              <Spinner decorative size="sm" />
              Checking with Stripe…
            </p>
          )}
        </div>
        {billing.isError && !data ? (
          <p role="alert" className="m-0 text-caption text-danger-ink">
            Billing could not be loaded. We will keep trying.
          </p>
        ) : null}
        <div>
          <Link
            href={BILLING_PATH}
            className={buttonVariants({
              variant: confirmed ? "default" : "outline",
            })}
          >
            Back to Billing
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
