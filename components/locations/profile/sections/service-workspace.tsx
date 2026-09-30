"use client"

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react"
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { fetchServiceMetadata, fetchServiceWorkflows } from "@/lib/api/location-business-information"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { resourceDisabledReason } from "@/lib/locations/gating"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { googleServiceItemsSchema, serviceCategoryId, type GoogleServiceCategory, type GoogleServiceItem } from "@/lib/domain/google-services"
import { servicePriceText } from "@/lib/locations/forms/services"
import { useServiceReview } from "./use-service-review"
import { ServiceApprovalSheet } from "./service-approval-sheet"
import { ApprovalExpiry } from "@/components/editors/change-diff"
import { categoryLabel } from "@/lib/locations/console-labels"

type Workspace = ReturnType<typeof useServiceReview> & { setConfirmedHandler: (handler: ((change: GbpChangeSet) => void) | null) => void }
const Context = createContext<Workspace | null>(null)
export const useServiceWorkspace = () => useContext(Context)
export function ServiceWorkspaceProvider({ locationId, children }: { readonly locationId: string; readonly children: ReactNode }) {
  const confirmed = useRef<((change: GbpChangeSet) => void) | null>(null)
  const workflow = useServiceReview(locationId, (change) => confirmed.current?.(change))
  const setConfirmedHandler = useCallback((handler: ((change: GbpChangeSet) => void) | null) => { confirmed.current = handler }, [])
  return <Context.Provider value={{ ...workflow, setConfirmedHandler }}>{children}</Context.Provider>
}
// The category display name when the services editor has loaded Google's
// category metadata; otherwise a humanised id. Never the raw gcid token.
function describe(item: GoogleServiceItem | undefined, categories: readonly GoogleServiceCategory[]) {
  if (!item) return "No service"
  const name = "freeFormServiceItem" in item ? item.freeFormServiceItem.label.displayName : categoryLabel({ name: item.structuredServiceItem.serviceTypeId, displayName: categories.flatMap((entry) => entry.serviceTypes).find((type) => type.serviceTypeId === item.structuredServiceItem.serviceTypeId)?.displayName })
  const description = "freeFormServiceItem" in item ? item.freeFormServiceItem.label.description : item.structuredServiceItem.description
  const category = "freeFormServiceItem" in item ? categoryLabel({ name: item.freeFormServiceItem.category, displayName: categories.find((entry) => serviceCategoryId(entry.name) === serviceCategoryId(item.freeFormServiceItem.category))?.displayName }) : null
  return [name, category, description ?? "No description", item.price ? `${item.price.currencyCode ?? ""} ${servicePriceText(item.price)}` : "No price"].filter(Boolean).join(" · ")
}
export function serviceReviewRows(review: Pick<GbpChangeSet, "baseline" | "payload"> | null, categories: readonly GoogleServiceCategory[]) {
  const before = googleServiceItemsSchema.safeParse(review?.baseline.serviceItems ?? []), after = googleServiceItemsSchema.safeParse(review?.payload.serviceItems ?? [])
  if (!before.success || !after.success) return null
  return Array.from({ length: Math.max(before.data.length, after.data.length) }, (_, index) => ({ field: `Service ${index + 1}`, before: describe(before.data[index], categories), after: describe(after.data[index], categories) })).filter((row) => row.before !== row.after)
}
export function SavedServiceWorkspace({ locationId }: { readonly locationId: string }) {
  const caps = useLocationCapabilities(locationId).data
  const workflow = useServiceWorkspace()
  const categories = useQueryClient().getQueryData<Awaited<ReturnType<typeof fetchServiceMetadata>>>([...queryKeys.locationBusinessInformation(locationId), "services"])?.categories ?? []
  const enabled = Boolean(caps?.canEditCanonical)
  const query = useInfiniteQuery({ queryKey: [...queryKeys.locationBusinessInformation(locationId), "service-workflows"], initialPageParam: "",
    queryFn: (context) => fetchServiceWorkflows(locationId, context.pageParam || undefined, requestOptions(context)),
    getNextPageParam: (page) => page.nextCursor ?? undefined, enabled,
  })
  if (!enabled || !workflow) return null
  const items = query.data?.pages.flatMap((page) => page.items) ?? [], reviewRows = serviceReviewRows(workflow.review, categories)
  return <section aria-label="Saved service work" className="flex min-w-0 flex-col gap-3">
    <h3 className="text-title font-semibold text-ink">Saved service work</h3>
    <p className="text-ui text-ink-muted">Recorded service outcomes remain available when Google cannot be read. Expired approvals cannot be sent again.</p>
    {query.isPending ? <p role="status">Loading saved service work…</p> : query.isError ? <p role="alert">Saved service work could not be loaded. <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Retry saved service work</Button></p> : items.length === 0 ? <p className="text-ui text-ink-muted">No saved service requests.</p> : items.map((item) => <div key={item.changeSet.id} className="flex min-w-0 flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface p-3">
      <p className="text-ui font-semibold text-ink">Services for {item.changeSet.locationName}</p>
      {item.changeSet.targetResourceName ? <p className="break-all text-caption text-ink-muted">Google target: {item.changeSet.targetResourceName}</p> : null}
      <p className="text-caption text-ink-muted">{item.attemptId ? "Request outcome recorded" : <>{item.changeSet.approvedBy ? "Approved request" : "Awaiting approval"} · <ApprovalExpiry expiresAt={item.changeSet.expiresAt} /></>}</p>
      <Button size="sm" variant="secondary" disabled={workflow.busy || workflow.unresolved && workflow.review?.id !== item.changeSet.id} onClick={() => workflow.restore(item.changeSet)}>{item.attemptId ? "Open service outcome" : "Open service review"}</Button>
    </div>)}
    {query.hasNextPage ? <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Load more service work</Button> : null}
    <ServiceApprovalSheet workflow={workflow} rows={reviewRows ?? []} disabled={!caps?.canPublish || !reviewRows || Boolean(resourceDisabledReason(caps, "businessInformation", true))} />
  </section>
}
