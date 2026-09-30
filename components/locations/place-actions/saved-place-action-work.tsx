"use client"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { fetchPlaceActionWorkflows } from "@/lib/api/place-action-reviews"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import type { usePlaceActionReview } from "./use-place-action-review"
import { PlaceActionApprovalSheet } from "./place-action-approval-sheet"
export function SavedPlaceActionWork({ locationId, workflow }: { readonly locationId: string; readonly workflow: ReturnType<typeof usePlaceActionReview> }) {
  const caps = useLocationCapabilities(locationId).data, enabled = Boolean(caps?.canEditCanonical)
  const query = useInfiniteQuery({ queryKey: [...queryKeys.locationBooking(locationId), "workflows"], initialPageParam: "",
    queryFn: (context) => fetchPlaceActionWorkflows(locationId, context.pageParam || undefined, requestOptions(context)),
    getNextPageParam: (page) => page.nextCursor ?? undefined, enabled,
  })
  if (!enabled) return null
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  return <section aria-label="Saved action link work" className="flex min-w-0 flex-col gap-3">
    <h2 className="text-title font-semibold text-ink">Saved action link work</h2>
    <p className="text-ui text-ink-muted">Recorded outcomes remain available when Google cannot be read. Expired approvals cannot be sent again.</p>
    {workflow.error && !workflow.open ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
    {query.isPending ? <p role="status">Loading saved action link work…</p> : query.isError ? <p role="alert">Saved action link work could not be loaded. <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry saved action link work</Button></p> : items.length === 0 ? <p className="text-ui text-ink-muted">No saved action link requests.</p> : items.map((item) => <div key={item.changeSet.id} className="flex min-w-0 flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-3">
      <p className="break-all text-ui text-ink">{item.changeSet.targetResourceName}</p>
      <p className="text-caption text-ink-muted">{item.attemptId ? "Request outcome recorded" : item.changeSet.approvedBy ? "Approved request" : "Awaiting approval"} · Approval expires {item.changeSet.expiresAt}</p>
      <Button size="sm" variant="secondary" disabled={workflow.busy || workflow.unresolved && workflow.review?.changeSet.id !== item.changeSet.id} onClick={() => workflow.restore(item.changeSet)}>{item.attemptId ? "Open action link outcome" : "Open action link review"}</Button>
    </div>)}
    {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more action link work</Button> : null}
    <PlaceActionApprovalSheet workflow={workflow} disabled={!caps?.canPublish || Boolean(resourceDisabledReason(caps, "booking", true))} />
  </section>
}
