"use client"

import { XIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import {
  PlanPicker,
  billingActionError,
  showPlanChangeToast,
} from "@/components/settings/plan-picker"
import {
  SettingsFacts,
  SettingsSection,
} from "@/components/settings/settings-section"
import {
  Alert,
  AlertAction,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import { SettingsDestructiveAction } from "@/components/ui/settings-row"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { toast } from "@/components/ui/toast"
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
import { useHydrated } from "@/lib/hooks/use-hydrated"
import {
  useBilling,
  useCancelSubscription,
  useChangePlan,
  useOpenBillingPortal,
} from "@/lib/queries/use-billing"

/**
 * The owner Billing screen (plan P07-S6): the plan and its state, effective
 * dates, limits, a scheduled change, invoices and payment details through
 * Stripe's Customer Portal, cancellation and resumption, and the plans on
 * offer. Every fact is the server's record; nothing is assumed from a
 * Checkout return.
 */
export function BillingCard() {
  const billing = useBilling()
  // The server never has billing, so it renders the skeleton. The shell's
  // billing banner reads the same query and can fill the cache before this
  // page hydrates; the hydration render must still match the server's
  // skeleton (React #418), so the details land one render later.
  const hydrated = useHydrated()
  return (
    <QueryStates
      // Overview already on screen stays there through a failed background
      // refetch; only a first load that failed shows the error.
      status={
        !hydrated ? "pending" : billing.data ? "ready" : queryStatus(billing)
      }
      pending={
        <Card flush aria-busy="true">
          <CardContent className="flex flex-col gap-3 py-(--np-card-pad)">
            <span className="sr-only" role="status">
              Loading billing
            </span>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      }
      error={{
        title: "Billing could not be loaded",
        description: describeActionError(billing.error),
      }}
      onRetry={() => void billing.refetch()}
    >
      {() => <BillingDetails overview={billing.data!} />}
    </QueryStates>
  )
}

/**
 * Stripe's back link from Checkout (`?checkout=canceled`). The query string
 * is the only state, so Dismiss just drops it from the URL; nothing is sent
 * to the server. The notice unmounts with the pressed button, so focus first
 * moves to the Subscription block below it, or to the page heading while
 * billing is still loading or failed, never to the page body.
 */
export function CheckoutCanceledNotice() {
  const router = useRouter()
  const dismiss = () => {
    const target =
      document.querySelector<HTMLElement>(
        "[data-slot='billing-subscription-focus']"
      ) ?? document.querySelector<HTMLElement>("h1[tabindex='-1']")
    target?.focus({ preventScroll: true })
    router.replace("/settings/billing", { scroll: false })
  }
  return (
    <Alert variant="info" data-slot="checkout-canceled">
      <AlertTitle>Checkout was not completed</AlertTitle>
      <AlertDescription>
        Nothing was charged and nothing changed. You can subscribe again below.
      </AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          onClick={dismiss}
        >
          <XIcon strokeWidth={1.75} aria-hidden />
        </Button>
      </AlertAction>
    </Alert>
  )
}

/** Reasons only support can resolve: no action is offered for them. */
const SUPPORT_REASONS = new Set<BillingOverview["access"]["reason"]>([
  "plan_missing",
  "record_incomplete",
  "billing_missing",
])

export function BillingDetails({ overview }: { overview: BillingOverview }) {
  const portal = useOpenBillingPortal()
  const cancel = useCancelSubscription()
  const keep = useChangePlan()
  const [confirmCancel, setConfirmCancel] = React.useState(false)
  const cancelBlockedId = React.useId()
  // Where focus goes once the cancel dialog closes. Only a confirmed
  // cancellation takes the trigger away, so only then does focus move to
  // the Subscription block; "Keep subscription" or Escape leaves it on the
  // trigger (Base UI's default).
  const subscriptionRef = React.useRef<HTMLDivElement>(null)
  const cancelledRef = React.useRef(false)
  const cancelFinalFocus = () =>
    cancelledRef.current ? (subscriptionRef.current ?? true) : true
  const status = billingStatus(overview)
  const subscribed = isSubscribed(overview.state)
  const manageBlocked = overview.canManage
    ? undefined
    : "Only the workspace owner can change billing, and not from a support session."
  const portalBlocked =
    manageBlocked ??
    (overview.checkout.reason === "billing_disabled" ||
    overview.checkout.reason === "billing_paused"
      ? "Billing is not available right now."
      : undefined)
  // A failed payment or a read-only workspace leads the page with what
  // happened and the one thing that fixes it (the same Portal or plans).
  const attention =
    overview.access.mode === "grace" || overview.access.mode === "read_only"
  const supportOnly = SUPPORT_REASONS.has(overview.access.reason)
  const recovery: "portal" | "plans" | null =
    !attention || supportOnly
      ? null
      : subscribed
        ? overview.hasCustomer
          ? "portal"
          : null
        : overview.catalog.length > 0
          ? "plans"
          : null
  // The title names the same cause as describeBilling below it: a payment
  // only when the reason is a failed or missing payment.
  const reason = overview.access.reason
  const attentionTitle =
    overview.access.mode === "grace"
      ? "Your last payment didn’t go through"
      : supportOnly
        ? "This workspace is read-only"
        : reason === "subscription_ended"
          ? "Your subscription has ended"
          : reason === "renewal_unconfirmed"
            ? "Waiting for the renewal payment to be confirmed"
            : subscribed
              ? "Payment needed to restore full access"
              : "Choose a plan to restore full access"
  // An ended subscription is not fixed by a payment method.
  const recoveryAction =
    recovery === "portal" && reason === "subscription_ended" ? null : recovery
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

      {attention ? (
        <Alert
          variant={overview.access.mode === "grace" ? "warning" : "destructive"}
          // Present on load: page content, not an interruption.
          live={false}
          data-slot="billing-attention"
        >
          <AlertTitle>{attentionTitle}</AlertTitle>
          <AlertDescription>{describeBilling(overview)}</AlertDescription>
          {recoveryAction === "portal" ? (
            <AlertActions>
              <Button
                disabledReason={portalBlocked}
                pending={portal.isPending}
                onClick={() => portal.mutate()}
              >
                {reason === "renewal_unconfirmed"
                  ? "Check payment details"
                  : "Update payment method"}
              </Button>
            </AlertActions>
          ) : recoveryAction === "plans" ? (
            <AlertActions>
              <a href="#billing-plans" className={buttonVariants()}>
                See plans
              </a>
            </AlertActions>
          ) : null}
        </Alert>
      ) : null}

      <div
        ref={subscriptionRef}
        tabIndex={-1}
        data-slot="billing-subscription-focus"
        className="rounded-(--np-radius-card) focus-halo outline-none"
      >
        <SettingsSection
          id="billing-subscription"
          title="Subscription"
          // The attention alert above already says it in full.
          description={attention ? undefined : describeBilling(overview)}
          variant="group"
        >
          <SettingsFacts
            columns={2}
            facts={[
              [
                "Status",
                <StatusPill
                  key="status"
                  tone={status.tone}
                  data-slot="billing-status"
                >
                  {status.label}
                </StatusPill>,
              ],
              [
                "Plan",
                overview.plan ? (
                  <span
                    key="plan"
                    className="inline-flex flex-wrap items-center gap-2"
                  >
                    {overview.plan.name}
                    {overview.plan.isTestOffer ? (
                      <Badge variant="warning">Test offer</Badge>
                    ) : null}
                  </span>
                ) : overview.state === "pilot" ? (
                  "Pilot"
                ) : (
                  "No plan"
                ),
              ],
              overview.state === "trialing" && overview.trialEndsAt
                ? [
                    overview.cancelAtPeriodEnd ? "Access ends" : "Trial ends",
                    formatBillingDate(overview.trialEndsAt),
                  ]
                : null,
              overview.state === "active" && overview.currentPeriodEnd
                ? [
                    overview.cancelAtPeriodEnd ? "Access ends" : "Renews on",
                    formatBillingDate(overview.currentPeriodEnd),
                  ]
                : null,
              overview.access.mode === "grace" && overview.access.endsAt
                ? ["Grace ends", formatBillingDate(overview.access.endsAt)]
                : null,
              ["Locations", describeLocationUsage(overview)],
            ]}
          />

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
                  onClick={() =>
                    keep.mutate(overview.plan!.id, {
                      onSuccess: (result) =>
                        showPlanChangeToast(result, overview),
                    })
                  }
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
                disabledReason={portalBlocked}
                pending={portal.isPending}
                onClick={() => portal.mutate()}
              >
                Payment details and invoices
              </Button>
            ) : null}
            {subscribed && overview.cancelAtPeriodEnd ? (
              <Button
                variant="outline"
                disabledReason={manageBlocked}
                pending={cancel.isPending}
                onClick={() =>
                  cancel.mutate(false, {
                    onSuccess: (result) => {
                      if (!result.cancelAtPeriodEnd) {
                        toast.add({
                          type: "success",
                          title: "Subscription resumed",
                        })
                      }
                    },
                  })
                }
              >
                Resume subscription
              </Button>
            ) : null}
          </div>
          {actionError && !confirmCancel ? (
            <p role="alert" className="m-0 text-ui text-danger-ink">
              {billingActionError(actionError)}
            </p>
          ) : null}
        </SettingsSection>
      </div>

      <SettingsSection
        id="billing-plans"
        title="Plans"
        description="Limits apply to linked Google locations, including disconnected ones. Linked locations are never removed automatically."
        variant="group"
      >
        <PlanPicker overview={overview} />
      </SettingsSection>

      {/* The one destructive action goes last on the page, alone and
          centred (REFERENCE-BRIEF §4.3); it still asks first. Blocked, it
          stays focusable and names why, as Button's disabledReason does. */}
      {subscribed && !overview.cancelAtPeriodEnd ? (
        <SettingsDestructiveAction
          aria-disabled={manageBlocked ? "true" : undefined}
          aria-describedby={manageBlocked ? cancelBlockedId : undefined}
          title={manageBlocked}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover-fine:hover:bg-transparent"
          onClick={() => {
            if (manageBlocked) return
            cancel.reset()
            cancelledRef.current = false
            setConfirmCancel(true)
          }}
        >
          Cancel subscription
          {manageBlocked ? (
            <span id={cancelBlockedId} hidden>
              {manageBlocked}
            </span>
          ) : null}
        </SettingsDestructiveAction>
      ) : null}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent
          className="grid-cols-[minmax(0,1fr)]"
          finalFocus={cancelFinalFocus}
        >
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
                  onSuccess: (result) => {
                    cancelledRef.current = result.cancelAtPeriodEnd
                    setConfirmCancel(false)
                    if (result.cancelAtPeriodEnd) {
                      toast.add({
                        type: "success",
                        title: "Subscription cancelled",
                        description:
                          [
                            periodEnd
                              ? `Full access continues until ${formatBillingDate(periodEnd)}.`
                              : null,
                            result.clearedPendingPlan
                              ? "The scheduled plan change was dropped."
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined,
                      })
                    }
                  },
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
