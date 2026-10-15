"use client"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { SettingsGroup } from "@/components/ui/settings-row"
import { cn } from "@/lib/utils"
import { fetchPlaceActionWorkflows } from "@/lib/api/place-action-reviews"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { ApprovalExpiry } from "@/components/editors/change-diff"
import { SupportDetails } from "@/components/editors/support-details"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { placeActionBaselineSchema } from "@/lib/contracts/place-action-observation"
import { reviewedPlaceActionPayloadSchema } from "@/lib/contracts/place-action-review"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"
import { useDeadlineWithin } from "@/lib/editors/use-deadline"
import type { usePlaceActionReview } from "./use-place-action-review"
import { PlaceActionApprovalSheet } from "./place-action-approval-sheet"
/**
 * What a saved request does, in the customer's words: "Add Shop online link"
 * plus the link it concerns. Never the raw Google resource name.
 */
export function placeActionWorkLabel(
  changeSet: Pick<GbpChangeSet, "payload" | "baseline">
): { title: string; uri: string | null } {
  const payload = reviewedPlaceActionPayloadSchema.safeParse(changeSet.payload)
  if (!payload.success) return { title: "Booking link change", uri: null }
  const request = payload.data.request
  if (request.operation !== "delete") {
    const type = actionTypeLabel(request.payload.placeActionType)
    return {
      title: `${request.operation === "create" ? "Add" : "Change"} ${type} link`,
      uri: request.payload.uri,
    }
  }
  const baseline = placeActionBaselineSchema.safeParse(changeSet.baseline)
  const link = baseline.success
    ? baseline.data.links.find((entry) => entry.name === request.name)
    : undefined
  return {
    title: link
      ? `Remove ${actionTypeLabel(link.placeActionType)} link`
      : "Remove booking link",
    uri: link?.uri ?? null,
  }
}

/** The approval deadline, but only once it is close (within the hour) or past. */
function ExpiryNearby({ expiresAt }: { readonly expiresAt: string }) {
  const soon = useDeadlineWithin(expiresAt, 60 * 60_000)
  if (!soon) return null
  return (
    <>
      {" "}
      · <ApprovalExpiry expiresAt={expiresAt} />
    </>
  )
}

export function SavedPlaceActionWork({
  locationId,
  workflow,
}: {
  readonly locationId: string
  readonly workflow: ReturnType<typeof usePlaceActionReview>
}) {
  const caps = useLocationCapabilities(locationId).data,
    enabled = Boolean(caps?.canEditCanonical)
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.locationBooking(locationId), "workflows"],
    initialPageParam: "",
    queryFn: (context) =>
      fetchPlaceActionWorkflows(
        locationId,
        context.pageParam || undefined,
        requestOptions(context)
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  })
  if (!enabled) return null
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <>
      <SettingsGroup
        // The region keeps its own name (an e2e capture selects it by
        // `aria-label`); the heading says the same words.
        aria-label="Saved booking link work"
        aria-labelledby={undefined}
        label="Saved booking link work"
        caption="Outcomes stay here even when Google can’t be read."
        bodyAs="div"
        card
        className="mt-0 min-w-0"
        footer={
          query.hasNextPage ? (
            <Button
              variant="secondary"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Load more booking link work
            </Button>
          ) : undefined
        }
      >
        {workflow.error && !workflow.open ? (
          <p role="alert" className={cn(blockClassName, "text-danger-ink")}>
            {workflow.error}
          </p>
        ) : null}
        {query.isPending ? (
          <p role="status" className={cn(blockClassName, "text-ink-muted")}>
            Loading saved booking link work…
          </p>
        ) : query.isError ? (
          <p
            role="alert"
            className={cn(
              blockClassName,
              "flex flex-wrap items-center gap-2 text-ink"
            )}
          >
            Saved booking link work could not be loaded.{" "}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void query.refetch()}
            >
              Retry saved booking link work
            </Button>
          </p>
        ) : items.length === 0 ? (
          <p className={cn(blockClassName, "text-ink-muted")}>
            No saved booking link requests.
          </p>
        ) : (
          // One list row per saved request, its state and its one action
          // under the words.
          <ListRows>
            {items.map((item) => {
              const label = placeActionWorkLabel(item.changeSet)
              return (
                <ListRow
                  key={item.changeSet.id}
                  flush
                  wrap
                  interactive={false}
                  emphasis="neutral"
                  wrapperClassName="desk:px-2"
                  title={label.title}
                  subtitle={label.uri ?? undefined}
                  footerLayout="stack"
                  footer={
                    <>
                      <p className="text-caption text-ink-muted">
                        {item.attemptId ? (
                          "Request outcome recorded"
                        ) : (
                          <>
                            {item.changeSet.approvedBy
                              ? "Approved request"
                              : "Awaiting approval"}
                            <ExpiryNearby
                              expiresAt={item.changeSet.expiresAt}
                            />
                          </>
                        )}
                      </p>
                      {/* Google's resource name is for support, not for
                          deciding. */}
                      <SupportDetails
                        items={[
                          item.changeSet.targetResourceName
                            ? `Google target: ${item.changeSet.targetResourceName}`
                            : null,
                        ]}
                      />
                      <div className="flex">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={
                            workflow.busy ||
                            (workflow.unresolved &&
                              workflow.review?.changeSet.id !==
                                item.changeSet.id)
                          }
                          onClick={() => workflow.restore(item.changeSet)}
                        >
                          {item.attemptId
                            ? "Open booking link outcome"
                            : "Open booking link review"}
                        </Button>
                      </div>
                    </>
                  }
                />
              )
            })}
          </ListRows>
        )}
      </SettingsGroup>
      <PlaceActionApprovalSheet
        workflow={workflow}
        disabled={
          !caps?.canPublish ||
          Boolean(resourceDisabledReason(caps, "booking", true))
        }
      />
    </>
  )
}

/** A plain block in the group, aligned with the rows' words. */
const blockClassName = "py-2 text-ui desk:px-2"
