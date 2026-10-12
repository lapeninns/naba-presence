"use client"

import * as React from "react"

import {
  PlanPicker,
  billingActionError,
} from "@/components/settings/plan-picker"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { QueryError } from "@/components/ui/query-states"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type { BillingOverview } from "@/lib/api/billing"
import {
  billingStatus,
  describeBilling,
  describeLocationUsage,
  formatBillingDate,
  isSubscribed,
  pendingLinkLimitNote,
} from "@/lib/billing/presentation"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  useBilling,
  useCancelSubscription,
  useChangePlan,
  useOpenBillingPortal,
} from "@/lib/queries/use-billing"

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-ink-muted">{term}</dt>
      <dd className="m-0 text-body text-ink">{children}</dd>
    </div>
  )
}

/**
 * The owner Billing screen (plan P07-S6): the plan and its state, effective
 * dates, limits, a scheduled change, invoices and payment details through
 * Stripe's Customer Portal, cancellation and resumption, and the plans on
 * offer. Every fact is the server's record; nothing is assumed from a
 * Checkout return.
 */
export function BillingCard() {
  const billing = useBilling()

  if (billing.isPending) {
    return (
      <Card flush data-slot="billing-card">
        <CardContent className="flex flex-col gap-3 py-(--np-card-pad)">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!billing.data) {
    return (
      <QueryError
        title="Billing could not be loaded"
        description={describeActionError(billing.error)}
        onRetry={() => void billing.refetch()}
      />
    )
  }
  return <BillingDetails overview={billing.data} />
}

export function BillingDetails({ overview }: { overview: BillingOverview }) {
  const portal = useOpenBillingPortal()
  const cancel = useCancelSubscription()
  const keep = useChangePlan()
  const [confirmCancel, setConfirmCancel] = React.useState(false)
  const status = billingStatus(overview)
  const subscribed = isSubscribed(overview.state)
  const manageBlocked = overview.canManage
    ? undefined
    : "Only the workspace owner can change billing, and not from a support session."
  const linkNote = pendingLinkLimitNote(overview)
  const actionError = portal.error ?? cancel.error ?? keep.error
  // When full access ends if the subscription is cancelled now: the trial
  // end while trialing, the grace end after a failed payment, else the
  // period end.
  const periodEnd =
    overview.state === "trialing"
      ? (overview.trialEndsAt ?? overview.currentPeriodEnd)
      : overview.access.mode === "grace"
        ? overview.access.endsAt
        : (overview.currentPeriodEnd ?? overview.trialEndsAt)

  return (
    <div className="flex flex-col gap-(--np-gap-section)">
      {overview.environment === "test" ||
      overview.catalog.some((plan) => plan.isTestOffer) ? (
        <Alert variant="info" data-slot="billing-test-mode">
          <AlertTitle>Test mode</AlertTitle>
          <AlertDescription>
            Billing here uses Stripe’s test environment. Plans marked “Test
            offer” never charge a real card.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card flush data-slot="billing-card">
        <CardHeader divided>
          <CardTitle as="h2">Subscription</CardTitle>
          <CardDescription>{describeBilling(overview)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 py-(--np-card-pad)">
          <dl className="m-0 grid gap-4 sm:grid-cols-2">
            <Fact term="Status">
              <StatusPill tone={status.tone} data-slot="billing-status">
                {status.label}
              </StatusPill>
            </Fact>
            <Fact term="Plan">
              {overview.plan ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {overview.plan.name}
                  {overview.plan.isTestOffer ? (
                    <Badge variant="warning">Test offer</Badge>
                  ) : null}
                </span>
              ) : overview.state === "pilot" ? (
                "Pilot"
              ) : (
                "No plan"
              )}
            </Fact>
            {overview.state === "trialing" && overview.trialEndsAt ? (
              <Fact
                term={overview.cancelAtPeriodEnd ? "Access ends" : "Trial ends"}
              >
                {formatBillingDate(overview.trialEndsAt)}
              </Fact>
            ) : null}
            {overview.state === "active" && overview.currentPeriodEnd ? (
              <Fact
                term={overview.cancelAtPeriodEnd ? "Access ends" : "Renews on"}
              >
                {formatBillingDate(overview.currentPeriodEnd)}
              </Fact>
            ) : null}
            {overview.access.mode === "grace" && overview.access.endsAt ? (
              <Fact term="Grace ends">
                {formatBillingDate(overview.access.endsAt)}
              </Fact>
            ) : null}
            <Fact term="Locations">{describeLocationUsage(overview)}</Fact>
          </dl>

          {overview.pendingPlan && overview.pendingEffectiveAt ? (
            <div
              data-slot="pending-change"
              className="flex flex-col gap-2 rounded-md bg-fill px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="m-0 text-ui text-ink">
                Changes to <strong>{overview.pendingPlan.name}</strong> on{" "}
                {formatBillingDate(overview.pendingEffectiveAt)}.
              </p>
              {overview.plan ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabledReason={manageBlocked}
                  pending={keep.isPending}
                  onClick={() => keep.mutate(overview.plan!.id)}
                >
                  Keep {overview.plan.name}
                </Button>
              ) : null}
            </div>
          ) : null}
          {linkNote ? (
            <p className="m-0 text-caption text-ink-muted">{linkNote}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {overview.hasCustomer ? (
              <Button
                variant="outline"
                disabledReason={
                  manageBlocked ??
                  (overview.checkout.reason === "billing_disabled" ||
                  overview.checkout.reason === "billing_paused"
                    ? "Billing is not available right now."
                    : undefined)
                }
                pending={portal.isPending}
                onClick={() => portal.mutate()}
              >
                Payment details and invoices
              </Button>
            ) : null}
            {subscribed && !overview.cancelAtPeriodEnd ? (
              <Button
                variant="destructive"
                disabledReason={manageBlocked}
                onClick={() => {
                  cancel.reset()
                  setConfirmCancel(true)
                }}
              >
                Cancel subscription
              </Button>
            ) : null}
            {subscribed && overview.cancelAtPeriodEnd ? (
              <Button
                variant="outline"
                disabledReason={manageBlocked}
                pending={cancel.isPending}
                onClick={() => cancel.mutate(false)}
              >
                Resume subscription
              </Button>
            ) : null}
          </div>
          {actionError && !confirmCancel ? (
            <p role="alert" className="m-0 text-caption text-danger-ink">
              {billingActionError(actionError)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card flush data-slot="plans-card">
        <CardHeader divided>
          <CardTitle as="h2">Plans</CardTitle>
          <CardDescription>
            Limits apply to linked Google locations, including disconnected
            ones. Linked locations are never removed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-(--np-card-pad)">
          <PlanPicker overview={overview} />
        </CardContent>
      </Card>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
          <AlertDialogTitle>Cancel the subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            {periodEnd
              ? `Full access continues until ${formatBillingDate(periodEnd)}${overview.state === "trialing" ? " and nothing is charged" : ""}. After that the workspace becomes read-only: you can still view and export everything.`
              : "Full access continues until the end of the period. After that the workspace becomes read-only: you can still view and export everything."}
            {overview.pendingPlan
              ? ` The scheduled change to ${overview.pendingPlan.name} is dropped.`
              : ""}{" "}
            You can resume before then.
          </AlertDialogDescription>
          {cancel.error ? (
            <p role="alert" className="m-0 text-caption text-danger-ink">
              {billingActionError(cancel.error)}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep subscription</Button>}
            />
            <Button
              variant="danger"
              pending={cancel.isPending}
              onClick={() =>
                cancel.mutate(true, {
                  onSuccess: () => setConfirmCancel(false),
                })
              }
            >
              Cancel subscription
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
