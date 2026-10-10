"use client"
import { useInfiniteQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { fetchPlaceActionWorkflows } from "@/lib/api/place-action-reviews"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { ApprovalExpiry } from "@/components/editors/change-diff"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { placeActionBaselineSchema } from "@/lib/contracts/place-action-observation"
import { reviewedPlaceActionPayloadSchema } from "@/lib/contracts/place-action-review"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"
import type { usePlaceActionReview } from "./use-place-action-review"
import { PlaceActionApprovalSheet } from "./place-action-approval-sheet"
/**
 * What a saved request does, in the customer's words: "Add Shop online link"
 * plus the link it concerns. Never the raw Google resource name.
 */
export function placeActionWorkLabel(changeSet: Pick<GbpChangeSet, "payload" | "baseline">): { title: string; uri: string | null } {
  const payload = reviewedPlaceActionPayloadSchema.safeParse(changeSet.payload)
  if (!payload.success) return { title: "Action link change", uri: null }
  const request = payload.data.request
  if (request.operation !== "delete") {
    const type = actionTypeLabel(request.payload.placeActionType)
    return { title: `${request.operation === "create" ? "Add" : "Change"} ${type} link`, uri: request.payload.uri }
  }
  const baseline = placeActionBaselineSchema.safeParse(changeSet.baseline)
  const link = baseline.success ? baseline.data.links.find((entry) => entry.name === request.name) : undefined
  return { title: link ? `Remove ${actionTypeLabel(link.placeActionType)} link` : "Remove action link", uri: link?.uri ?? null }
}

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
      <SavedPlaceActionLabel changeSet={item.changeSet} />
      <p className="text-caption text-ink-muted">{item.attemptId ? "Request outcome recorded" : <>{item.changeSet.approvedBy ? "Approved request" : "Awaiting approval"} · <ApprovalExpiry expiresAt={item.changeSet.expiresAt} /></>}</p>
      <Button size="sm" variant="secondary" disabled={workflow.busy || workflow.unresolved && workflow.review?.changeSet.id !== item.changeSet.id} onClick={() => workflow.restore(item.changeSet)}>{item.attemptId ? "Open action link outcome" : "Open action link review"}</Button>
    </div>)}
    {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more action link work</Button> : null}
    <PlaceActionApprovalSheet workflow={workflow} disabled={!caps?.canPublish || Boolean(resourceDisabledReason(caps, "booking", true))} />
  </section>
}

function SavedPlaceActionLabel({ changeSet }: { readonly changeSet: GbpChangeSet }) {
  const label = placeActionWorkLabel(changeSet)
  return <>
    <p className="text-ui font-semibold text-ink">{label.title}</p>
    {label.uri ? <p className="break-all text-ui text-ink">{label.uri}</p> : null}
    {changeSet.targetResourceName ? <p className="break-all text-caption text-ink-muted">Google target: {changeSet.targetResourceName}</p> : null}
  </>
}
