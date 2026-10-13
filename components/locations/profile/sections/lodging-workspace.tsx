"use client"

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { SavedWorkList } from "@/components/reviewed-write"
import { fetchLodgingWorkflows } from "@/lib/api/location-industry"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { LodgingApprovalSheet } from "./lodging-approval-sheet"
import { savedChangeItem } from "./saved-change-work"
import { useLodgingReview } from "./use-lodging-review"

type DraftStatus = { dirty: boolean; blocked: string | null }
type DraftActions = { review: () => void; discard: () => void }
type Workspace = ReturnType<typeof useLodgingReview> & {
  draftStatus: DraftStatus
  reportDraft: (status: DraftStatus, actions: DraftActions | null) => void
  reviewDraft: () => void
  discardDraft: () => void
}
const Context = createContext<Workspace | null>(null)
export function LodgingWorkspaceProvider({ locationId, children }: { readonly locationId: string; readonly children: ReactNode }) {
  const workflow = useLodgingReview(locationId)
  const [draftStatus, setDraftStatus] = useState<DraftStatus>({ dirty: false, blocked: null })
  const actions = useRef<DraftActions | null>(null)
  const reportDraft = useCallback((status: DraftStatus, next: DraftActions | null) => {
    actions.current = next
    setDraftStatus((previous) => previous.dirty === status.dirty && previous.blocked === status.blocked ? previous : status)
  }, [])
  return <Context.Provider value={{ ...workflow, draftStatus, reportDraft,
    reviewDraft: () => actions.current?.review(), discardDraft: () => actions.current?.discard(),
  }}>{children}</Context.Provider>
}
export const useLodgingWorkspace = () => useContext(Context)

/** The jump target for saved lodging work on the profile page. */
export const SAVED_LODGING_ID = "section-saved-lodging"

export function SavedLodgingWorkspace({ locationId }: { readonly locationId: string }) {
  const caps = useLocationCapabilities(locationId).data
  return <SavedLodgingWork locationId={locationId} enabled={Boolean(caps?.canEditCanonical)} disabled={!caps?.canPublish || Boolean(resourceDisabledReason(caps, "industry", true))} />
}

export function SavedLodgingWork({ locationId, enabled, disabled }: { readonly locationId: string; readonly enabled: boolean; readonly disabled: boolean }) {
  const workflow = useLodgingWorkspace()
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.locationIndustry(locationId), "workflows"], initialPageParam: "",
    queryFn: ({ pageParam }) => fetchLodgingWorkflows(locationId, pageParam || undefined),
    getNextPageParam: (page) => page.nextCursor ?? undefined, enabled,
  })
  if (!enabled || !workflow) return null
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  return <div id={SAVED_LODGING_ID} className="flex min-w-0 scroll-mt-18 flex-col desk:scroll-mt-4">
    <SavedWorkList
      id={`${SAVED_LODGING_ID}-heading`}
      headingLevel="h3"
      title="Saved lodging work"
      description="Saved requests remain available when Google cannot be read. Expired approvals cannot be sent again; recorded outcomes can still be checked."
      items={items.map((item) => savedChangeItem({
        change: item.changeSet, recorded: Boolean(item.attemptId),
        operation: `Lodging details for ${item.changeSet.locationName}`,
        actionLabel: item.attemptId ? "Open lodging outcome" : "Open lodging review",
        onOpen: () => workflow.restore(item.changeSet),
        disabled: workflow.busy || workflow.unresolved && workflow.review?.id !== item.changeSet.id,
      }))}
      pending={query.isPending}
      failed={query.isError}
      loadingText="Loading saved lodging work…"
      errorText="Saved lodging work could not be loaded."
      emptyText="No saved lodging requests."
      reloadLabel="Reload saved lodging work"
      reloading={query.isFetching}
      onReload={() => void query.refetch()}
      loadMoreLabel="Load more lodging work"
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
    <LodgingApprovalSheet workflow={workflow} disabled={disabled} />
  </div>
}
