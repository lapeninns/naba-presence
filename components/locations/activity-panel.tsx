"use client"

import { LocationTab } from "@/components/locations/location-tab"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { LoadMore } from "@/components/ui/load-more"
import { StatusPill } from "@/components/ui/status-pill"
import { formatNumber } from "@/lib/format"
import {
  activityPillTone,
  activityStatusLabel,
  humaniseActivity,
} from "@/lib/listings/activity-outcome"
import { useLocationActivityPages } from "@/lib/queries/use-location-activity"
import { confirmIndustry } from "@/lib/api/location-industry"
import { confirmBusinessInformation } from "@/lib/api/location-business-information"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { queryKeys } from "@/lib/queries/keys"

const PAGE_SIZE = 10

const humanise = humaniseActivity

// The shell's resource hook: module-level, so its identity never changes.
function useActivityPages(locationId: string) {
  return useLocationActivityPages(locationId, PAGE_SIZE)
}

type ActivityPages = NonNullable<ReturnType<typeof useActivityPages>["data"]>

export function LocationActivityPanel({ locationId }: { locationId: string }) {
  return (
    <LocationTab locationId={locationId} useResource={useActivityPages}>
      {({ data: activity }) => (
        <ActivityList locationId={locationId} activity={activity} />
      )}
    </LocationTab>
  )
}

/**
 * A plain list of hairline-divided rows (Notion Mail's list): what changed
 * in body text with its time at the trailing edge, then the status word and
 * who / which fields in muted caption. It sits on the sheet's white, so the
 * rows need no card of their own; the separators do the work.
 */
function ActivityList({
  locationId,
  activity,
}: {
  locationId: string
  activity: ActivityPages
}) {
  if (activity.items.length === 0) {
    // Nothing recorded at all: one calm empty state instead of a "0 recorded
    // changes" count over an empty list. The drawer's own SheetTitle is the
    // heading, so the title stays a `p`.
    return (
      <Empty
        size="sm"
        title="No changes yet"
        description="No Google management changes recorded for this location yet."
      />
    )
  }
  return (
    <section className="flex flex-col gap-3">
      {/* The drawer's own SheetTitle is the heading here; a second one would
          repeat it and break heading order inside the dialog. */}
      <p className="text-caption text-ink-muted tabular-nums">
        {formatNumber(activity.total)} recorded{" "}
        {activity.total === 1 ? "change" : "changes"}
      </p>
      <ol
        aria-label="Recent changes"
        className="flex list-none flex-col divide-y divide-line-subtle"
      >
        {activity.items.map((item) => {
          const meta = [
            item.actorDisplayName,
            item.updateMask.length > 0
              ? item.updateMask.map(humanise).join(", ")
              : null,
            item.lastErrorCode ? humanise(item.lastErrorCode) : null,
            item.historicalReason ?? null,
            item.executionState && item.executionState !== "unrecorded" ? `Request ${humanise(item.executionState).toLowerCase()}` : null,
            item.confirmationState && item.confirmationState !== "unrecorded" ? `Google confirmation: ${humanise(item.confirmationState).toLowerCase()}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
          const when = new Date(item.createdAt).toLocaleString("en-GB", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })
          return (
            <li
              key={item.id}
              data-status={item.status}
              className="flex min-w-0 flex-col gap-1 py-3"
            >
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <p className="min-w-0 text-body font-medium text-ink">
                  {humanise(item.operation)} · {humanise(item.resourceType)}
                </p>
                <time
                  dateTime={item.createdAt}
                  className="shrink-0 text-caption whitespace-nowrap text-ink-muted tabular-nums"
                >
                  {when}
                </time>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <StatusPill tone={activityPillTone(item.status)}>
                  {activityStatusLabel(item.status)}
                </StatusPill>
                {meta ? (
                  <span className="min-w-0 text-caption text-ink-muted tabular-nums">
                    {meta}
                  </span>
                ) : null}
              </div>
              {activity.canManage && (item.resourceType === "lodging" || item.resourceType === "business_info" || item.resourceType === "attributes") && (item.canConfirm || (item.resourceType === "lodging" && item.status === "ambiguous")) ? <ConfirmManagementButton locationId={locationId} mutationId={item.sourceId ?? item.id} resourceType={item.resourceType} /> : null}
            </li>
          )
        })}
      </ol>
      <LoadMore
        shown={activity.items.length}
        total={activity.total}
        noun={["change", "changes"]}
        paging={activity.paging}
      />
    </section>
  )
}

function ConfirmManagementButton({ locationId, mutationId, resourceType }: { locationId: string; mutationId: string; resourceType: "lodging" | "business_info" | "attributes" }) {
  const confirmation = useResourceMutation({
    mutationFn: () => resourceType === "lodging" ? confirmIndustry(locationId, mutationId) : confirmBusinessInformation(locationId, mutationId),
    invalidate: [queryKeys.locationActivity(locationId), resourceType === "lodging" ? queryKeys.locationIndustry(locationId) : queryKeys.locationBusinessInformation(locationId)],
    successToast: (result) => result.confirmationState === "confirmed" ? `${resourceType === "lodging" ? "Lodging" : "Profile"} change confirmed by Google` : null,
  })
  return <span className="flex flex-wrap items-center gap-2 pt-1">
    <Button size="sm" variant="outline" disabled={confirmation.isPending} onClick={() => confirmation.mutate()}>
      {confirmation.isPending ? "Checking Google…" : "Check Google confirmation"}
    </Button>
    {confirmation.data?.confirmationState === "unresolved" ? <span role="status" className="text-caption text-ink-muted">Still unresolved. No change was resent.</span> : null}
  </span>
}
