"use client"

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ApprovalExpiry } from "@/components/editors/change-diff"
import { Button } from "@/components/ui/button"
import { fetchLodgingWorkflows } from "@/lib/api/location-industry"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { LodgingApprovalSheet } from "./lodging-approval-sheet"
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
  return <section aria-label="Saved lodging work" className="flex min-w-0 flex-col gap-3">
    <h3 className="text-title font-semibold text-ink">Saved lodging work</h3>
    <p className="text-ui text-ink-muted">Saved requests remain available when Google cannot be read. Expired approvals cannot be sent again; recorded outcomes can still be checked.</p>
    {query.isPending ? <p role="status">Loading saved lodging work…</p> : query.isError ? <p role="alert">Saved lodging work could not be loaded. <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry saved work</Button></p> : items.length === 0 ? <p className="text-ui text-ink-muted">No saved lodging requests.</p> : items.map((item) => <div key={item.changeSet.id} className="flex min-w-0 flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-3">
      <p className="text-ui font-semibold text-ink">Lodging details for {item.changeSet.locationName}</p>
      {item.changeSet.targetResourceName ? <p className="break-all text-caption text-ink-muted">Google target: {item.changeSet.targetResourceName}</p> : null}
      <p className="text-caption text-ink-muted">{item.attemptId ? "Request outcome recorded" : <>{item.changeSet.approvedBy ? "Approved request" : "Awaiting approval"} · <ApprovalExpiry expiresAt={item.changeSet.expiresAt} /></>}</p>
      <Button size="sm" variant="secondary" disabled={workflow.busy || workflow.unresolved && workflow.review?.id !== item.changeSet.id} onClick={() => workflow.restore(item.changeSet)}>{item.attemptId ? "Open lodging outcome" : "Open lodging review"}</Button>
    </div>)}
    {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more lodging work</Button> : null}
    <LodgingApprovalSheet workflow={workflow} disabled={disabled} />
  </section>
}
