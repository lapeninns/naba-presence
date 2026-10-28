"use client"

import { LocationTab } from "@/components/locations/location-tab"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { LoadMore } from "@/components/ui/load-more"
import { StatusPill } from "@/components/ui/status-pill"
import { formatNumber, formatShortDate } from "@/lib/format"
import {
  activityConfirmationLabel,
  activityErrorLabel,
  activityExecutionLabel,
  activityMaskLabels,
  activityPillTone,
  activityStatusLabel,
  activityTitle,
} from "@/lib/listings/activity-outcome"
import { useLocationActivityPages } from "@/lib/queries/use-location-activity"
import { confirmIndustry } from "@/lib/api/location-industry"
import { confirmBusinessInformation } from "@/lib/api/location-business-information"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"
import { queryKeys } from "@/lib/queries/keys"

const PAGE_SIZE = 10

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
        description="No changes to Google have been recorded for this listing yet."
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
      <ListRows aria-label="Recent changes">
        {activity.items.map((item) => {
          const meta = [
            item.actorDisplayName,
            item.updateMask.length > 0
              ? activityMaskLabels(item.updateMask).join(", ")
              : null,
            item.lastErrorCode ? activityErrorLabel(item.lastErrorCode) : null,
            item.historicalReason ?? null,
            item.executionState
              ? activityExecutionLabel(item.executionState)
              : null,
            item.confirmationState
              ? activityConfirmationLabel(item.confirmationState)
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
          const createdAt = new Date(item.createdAt)
          const when = Number.isNaN(createdAt.getTime())
            ? "Invalid Date"
            : formatShortDate(createdAt, {
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
          return (
            <ListRow
              key={item.id}
              interactive={false}
              emphasis="neutral"
              data-status={item.status}
              // The drawer's body already has its padding: the rows sit on
              // it flush, the divider runs the full width of the text.
              className="px-0"
              wrapperClassName="after:start-0 after:end-0"
              title={activityTitle(item.operation, item.resourceType)}
              meta={<time dateTime={item.createdAt}>{when}</time>}
              subtitle={
                // The status word and every detail stay readable: wrap
                // rather than truncate.
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 whitespace-normal">
                  <StatusPill tone={activityPillTone(item.status)}>
                    {activityStatusLabel(item.status)}
                  </StatusPill>
                  {meta ? (
                    <span className="min-w-0 text-caption text-ink-muted tabular-nums">
                      {meta}
                    </span>
                  ) : null}
                </span>
              }
              trailing={
                activity.canManage &&
                (item.resourceType === "lodging" ||
                  item.resourceType === "business_info" ||
                  item.resourceType === "attributes") &&
                (item.canConfirm ||
                  (item.resourceType === "lodging" &&
                    item.status === "ambiguous")) ? (
                  <ConfirmManagementButton
                    locationId={locationId}
                    mutationId={item.sourceId ?? item.id}
                    resourceType={item.resourceType}
                  />
                ) : undefined
              }
            />
          )
        })}
      </ListRows>
      <LoadMore
        shown={activity.items.length}
        total={activity.total}
        noun={["change", "changes"]}
        paging={activity.paging}
      />
    </section>
  )
}

function ConfirmManagementButton({
  locationId,
  mutationId,
  resourceType,
}: {
  locationId: string
  mutationId: string
  resourceType: "lodging" | "business_info" | "attributes"
}) {
  const confirmation = useResourceMutation({
    mutationFn: () =>
      resourceType === "lodging"
        ? confirmIndustry(locationId, mutationId)
        : confirmBusinessInformation(locationId, mutationId),
    invalidate: [
      queryKeys.locationActivity(locationId),
      resourceType === "lodging"
        ? queryKeys.locationIndustry(locationId)
        : queryKeys.locationBusinessInformation(locationId),
    ],
    successToast: (result) =>
      result.confirmationState === "confirmed"
        ? `${resourceType === "lodging" ? "Lodging" : "Profile"} change confirmed by Google`
        : null,
  })
  // In the row's trailing column: the button, and under it the one line
  // the check can leave behind, wrapped narrow so it never crowds the row.
  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={confirmation.isPending}
        onClick={() => confirmation.mutate()}
      >
        {confirmation.isPending
          ? "Checking Google…"
          : "Check Google confirmation"}
      </Button>
      {confirmation.data?.confirmationState === "unresolved" ? (
        <span
          role="status"
          className="max-w-40 text-right text-caption text-ink-muted"
        >
          Still unresolved. No change was resent.
        </span>
      ) : null}
    </span>
  )
}
