"use client"

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactNode,
} from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { SavedWorkList } from "@/components/reviewed-write/saved-work-list"
import {
  fetchServiceMetadata,
  fetchServiceWorkflows,
} from "@/lib/api/location-business-information"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { serviceReviewRows } from "@/lib/locations/forms/services"
import { useServiceReview } from "./use-service-review"
import { ServiceApprovalSheet } from "@/components/reviewed-write/lazy-sheets"
import { savedChangeItem } from "./saved-change-work"

type Workspace = ReturnType<typeof useServiceReview> & {
  setConfirmedHandler: (
    handler: ((change: GbpChangeSet) => void) | null
  ) => void
}
const Context = createContext<Workspace | null>(null)
export const useServiceWorkspace = () => useContext(Context)
export function ServiceWorkspaceProvider({
  locationId,
  children,
}: {
  readonly locationId: string
  readonly children: ReactNode
}) {
  const confirmed = useRef<((change: GbpChangeSet) => void) | null>(null)
  const workflow = useServiceReview(locationId, (change) =>
    confirmed.current?.(change)
  )
  const setConfirmedHandler = useCallback(
    (handler: ((change: GbpChangeSet) => void) | null) => {
      confirmed.current = handler
    },
    []
  )
  return (
    <Context.Provider value={{ ...workflow, setConfirmedHandler }}>
      {children}
    </Context.Provider>
  )
}
/** The review rows now live with the services form helpers. */
export { serviceReviewRows }

/** The jump target for saved service work on the profile page. */
export const SAVED_SERVICES_ID = "section-saved-services"

/**
 * `hideWhenEmpty`: draw no section while the list loads or when it is empty.
 * A failed read still shows, and the review sheet stays mounted: the
 * services section opens its reviews through this workspace.
 */
export function SavedServiceWorkspace({
  locationId,
  hideWhenEmpty = false,
}: {
  readonly locationId: string
  readonly hideWhenEmpty?: boolean
}) {
  const caps = useLocationCapabilities(locationId).data
  const workflow = useServiceWorkspace()
  const categories =
    useQueryClient().getQueryData<
      Awaited<ReturnType<typeof fetchServiceMetadata>>
    >([...queryKeys.locationBusinessInformation(locationId), "services"])
      ?.categories ?? []
  const enabled = Boolean(caps?.canEditCanonical)
  const query = useInfiniteQuery({
    queryKey: [
      ...queryKeys.locationBusinessInformation(locationId),
      "service-workflows",
    ],
    initialPageParam: "",
    queryFn: (context) =>
      fetchServiceWorkflows(
        locationId,
        context.pageParam || undefined,
        requestOptions(context)
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  })
  if (!enabled || !workflow) return null
  const items = query.data?.pages.flatMap((page) => page.items) ?? [],
    reviewRows = serviceReviewRows(workflow.review, categories)
  const sheet = (
    <ServiceApprovalSheet
      workflow={workflow}
      rows={reviewRows ?? []}
      disabled={
        !caps?.canPublish ||
        !reviewRows ||
        Boolean(resourceDisabledReason(caps, "businessInformation", true))
      }
    />
  )
  // The sheet keeps its place in the tree whether the list shows or not, so
  // a review opened while the list was hidden isn't remounted when it lands.
  const hidden =
    hideWhenEmpty && (query.isPending || (!query.isError && items.length === 0))
  return (
    <>
      {hidden ? null : (
        <div
          id={SAVED_SERVICES_ID}
          className="flex min-w-0 scroll-mt-18 flex-col desk:scroll-mt-4"
        >
          <SavedWorkList
            id={`${SAVED_SERVICES_ID}-heading`}
            headingLevel="h3"
            title="Saved service work"
            description="Recorded service outcomes remain available when Google cannot be read. Expired approvals cannot be sent again."
            items={items.map((item) =>
              savedChangeItem({
                change: item.changeSet,
                recorded: Boolean(item.attemptId),
                operation: `Services for ${item.changeSet.locationName}`,
                actionLabel: item.attemptId
                  ? "Open service outcome"
                  : "Open service review",
                onOpen: () => workflow.restore(item.changeSet),
                disabled:
                  workflow.busy ||
                  (workflow.unresolved &&
                    workflow.review?.id !== item.changeSet.id),
              })
            )}
            pending={query.isPending}
            failed={query.isError}
            loadingText="Loading saved service work…"
            errorText="Saved service work could not be loaded."
            emptyText="No saved service requests."
            reloadLabel="Reload saved service work"
            reloading={query.isFetching}
            onReload={() => void query.refetch()}
            loadMoreLabel="Load more service work"
            hasMore={query.hasNextPage}
            loadingMore={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
          />
        </div>
      )}
      {sheet}
    </>
  )
}
