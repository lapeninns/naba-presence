"use client"

import { SettingsSection } from "@/components/settings/settings-section"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import {
  billingStatus,
  describeBilling,
  describeLocationUsage,
  pendingLinkLimitNote,
} from "@/lib/billing/presentation"
import { useBilling } from "@/lib/queries/use-billing"

/**
 * The shared Usage screen's plan card (plan P07-S6): the workspace's plan
 * state and its linked locations against the limit, for every member.
 * Disconnected locations still count; linked locations are never removed
 * automatically. Changing the plan is the owner's Billing screen.
 */
export function PlanUsageCard() {
  const billing = useBilling()
  const data = billing.data
  const limit = data?.access.locationLimit ?? null
  const status = data ? billingStatus(data) : null
  const linkNote = data ? pendingLinkLimitNote(data) : null

  return (
    <SettingsSection
      id="settings-usage-plan"
      data-slot="plan-usage-card"
      title="Plan"
      description="Linked Google locations count toward the plan, including disconnected ones."
      variant="group"
    >
      {billing.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : data && status ? (
        <>
          <p className="m-0 flex flex-wrap items-center gap-2 text-body text-ink">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <span>
              {data.plan?.name ??
                (data.state === "pilot" ? "Pilot" : "No plan")}
            </span>
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
              tone={data.billableLocations >= limit ? "bad" : "default"}
            />
          ) : null}
          {linkNote ? (
            <p className="m-0 text-caption text-ink-muted">{linkNote}</p>
          ) : null}
        </>
      ) : (
        <p role="alert" className="m-0 text-caption text-danger-ink">
          The plan could not be loaded.
        </p>
      )}
    </SettingsSection>
  )
}
