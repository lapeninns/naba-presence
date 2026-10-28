"use client"

import Link from "next/link"

import { SettingsSection } from "@/components/settings/settings-section"
import { Button, buttonVariants } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  billingStatus,
  describeBilling,
  describeLocationUsage,
  pendingLinkLimitNote,
} from "@/lib/billing/presentation"
import { useHydrated } from "@/lib/hooks/use-hydrated"
import { useBilling } from "@/lib/queries/use-billing"

/**
 * The shared Usage screen's plan card (plan P07-S6): the workspace's plan
 * state and its linked locations against the limit, for every member.
 * Disconnected locations still count; linked locations are never removed
 * automatically. Changing the plan is the owner's Billing screen: the
 * owner (the server's `canManage`) gets a link to it, everyone else is told
 * who can change it.
 */
export function PlanUsageCard() {
  const billing = useBilling()
  // The server never has billing, so it renders the skeleton. The shell's
  // billing banner reads the same query and can fill the cache before this
  // card hydrates; the hydration render must still match the server's
  // skeleton (React #418), so the plan lands one render later.
  const hydrated = useHydrated()
  const data = hydrated ? billing.data : undefined
  const limit = data?.access.locationLimit ?? null
  const status = data ? billingStatus(data) : null
  const linkNote = data ? pendingLinkLimitNote(data) : null
  const atLimit =
    limit !== null && data !== undefined && data.billableLocations >= limit

  return (
    <SettingsSection
      id="settings-usage-plan"
      data-slot="plan-usage-card"
      title="Plan"
      description="Linked Google locations count toward the plan, including disconnected ones."
      variant="group"
      action={
        data?.canManage ? (
          <Link
            href="/settings/billing"
            prefetch={false}
            className={buttonVariants({ variant: "link" })}
          >
            Change plan
          </Link>
        ) : undefined
      }
    >
      {!hydrated || billing.isPending ? (
        // The Skeleton is hidden from assistive tech; this says it instead.
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading plan</span>
          <Skeleton className="h-10 w-full" />
        </div>
      ) : data && status ? (
        <>
          <p className="m-0 flex flex-wrap items-center gap-2 text-body text-ink">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            {/* Without a plan the pill alone says it ("Pilot"). */}
            {data.plan ? <span>{data.plan.name}</span> : null}
          </p>
          <p className="m-0 text-ui text-ink-secondary">
            {describeBilling(data)}
          </p>
          <p className="m-0 text-body text-ink">
            <strong className="font-semibold">
              {describeLocationUsage(data)}
            </strong>
          </p>
          {limit !== null ? (
            <Progress
              label="Locations linked"
              value={data.billableLocations}
              max={Math.max(1, limit)}
              // Exactly full is normal use; red only once it is over.
              tone={data.billableLocations > limit ? "bad" : "default"}
            />
          ) : null}
          {atLimit && data.access.canWrite ? (
            <p
              data-slot="plan-limit-reached"
              className="m-0 text-caption text-ink-secondary"
            >
              The plan’s location limit is reached, so another location can’t be
              linked. Unlink one or change plan to add more.
            </p>
          ) : null}
          {linkNote ? (
            <p className="m-0 text-caption text-ink-muted">{linkNote}</p>
          ) : null}
          {data.canManage ? null : (
            <p
              data-slot="plan-owner-only"
              className="m-0 text-caption text-ink-muted"
            >
              Only the workspace owner can change the plan.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p role="alert" className="m-0 text-ui text-danger-ink">
            The plan could not be loaded.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void billing.refetch()}
          >
            Try again
          </Button>
        </div>
      )}
    </SettingsSection>
  )
}
