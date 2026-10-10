"use client"

import { createContext, useContext, useEffect, type ReactNode } from "react"
import { useInfiniteQuery, useIsFetching, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { fetchAdministrationAccessWorkflows } from "@/lib/api/google-administration-access"
import { queryKeys } from "@/lib/queries/keys"
import { AdministrationProvider, useAdministrationSection } from "./context"
import { useAdministrationAccessController } from "./use-administration-access"
import { ACCESS_OPERATION_LABELS, AccessReview } from "./access-review"
import { AccessOutcome } from "./access-outcome"
import { useLifecycleContext } from "./lifecycle-workspace"

type AccessWorkspaceValue = ReturnType<typeof useAdministrationAccessController> & {
  /** The Google roster on screen predates a confirmed change and is being read again. */
  readonly rosterUpdating: boolean
  /** The roster predates a confirmed change and the read after it failed. */
  readonly rosterUnavailable: boolean
  /** Read Google's roster again after a failed post-confirmation read. */
  readonly retryRoster: () => void
}
const Context = createContext<AccessWorkspaceValue | null>(null)
/** Why roster actions wait after a confirmed change, shared by the row controls. */
export const ROSTER_UPDATING_REASON = "Updating from Google after the confirmed change. The list below may be out of date until Google's current list arrives."
/** Why roster actions wait when Google's list after a confirmed change could not be read. */
export const ROSTER_UNAVAILABLE_REASON = "Google's list after the confirmed change could not be read. Read it again before another access change."
function initialCursor(): string | undefined { return undefined }
export function useAdministrationAccess() {
  const value = useContext(Context)
  if (!value) throw new Error("Administration access controls require their review workspace.")
  return value
}
export function AdministrationAccessWorkspace({ children }: { children: ReactNode }) {
  const section = useAdministrationSection()
  const { locationId, writeBlocked } = section
  const action = useAdministrationAccessController(locationId)
  const setAccessBlocked = useLifecycleContext()?.setAccessBlocked
  const client = useQueryClient(), rosterKey = queryKeys.locationAdministration(locationId)
  const rosterFetching = useIsFetching({ queryKey: rosterKey }) > 0
  const roster = client.getQueryState(rosterKey)
  // A roster read before the confirmed change is stale until a newer read lands.
  const rosterStale = action.confirmedAt !== null && roster !== undefined && roster.dataUpdatedAt < action.confirmedAt
  const rosterUpdating = rosterStale && (rosterFetching || roster.errorUpdatedAt < (action.confirmedAt ?? 0))
  const rosterUnavailable = rosterStale && !rosterUpdating
  const retryRoster = () => { void client.refetchQueries({ queryKey: rosterKey }) }
  useEffect(() => { setAccessBlocked?.(action.busy || action.unresolved) }, [setAccessBlocked, action.busy, action.unresolved])
  const saved = useInfiniteQuery({
    queryKey: ["administration-access-workflows", locationId], initialPageParam: initialCursor(),
    queryFn: ({ pageParam, signal }) => fetchAdministrationAccessWorkflows(locationId, pageParam, { signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = saved.data?.pages.flatMap((page) => page.items) ?? []
  return <Context.Provider value={{ ...action, rosterUpdating, rosterUnavailable, retryRoster }}><div className="flex min-w-0 flex-col gap-6">
    <section aria-labelledby="access-review-workspace" className="flex min-w-0 flex-col gap-3">
      <SectionHeader id="access-review-workspace" title={action.attempt ? "Saved access outcome" : action.review ? "Review access request" : "Review changes before sending"} description="Approve the exact administrator or invitation, then send once and check Google independently." />
      {action.error && <p role="alert" className="text-ui text-danger-ink">{action.error}</p>}
      {action.attempt ? <AccessOutcome attempt={action.attempt} review={action.review} busy={action.busy} onCheck={() => action.check()} onRefresh={() => action.check(true)} onBack={action.reset} /> : action.review ? <AccessReview key={`${action.review.changeSet.id}:${action.selectionRevision}`} review={action.review} busy={action.busy} blocked={writeBlocked} uncertain={action.uncertain} stale={action.stale} onApprove={action.approve} onExecute={action.execute} onCheck={() => action.check()} onBack={action.reset} /> : <p className="text-ui text-ink-secondary">Choose an access change below to save a review. An invitation being sent or disappearing does not by itself prove access.</p>}
    </section>
    <AdministrationProvider locationId={locationId} locationName={section.locationName} disabled={section.disabled} publishReason={section.publishReason ?? (action.busy ? "An access action is in progress. Wait for its saved response before another Google change." : action.unresolved ? "Resolve the saved access outcome before another Google change." : rosterUpdating ? ROSTER_UPDATING_REASON : rosterUnavailable ? ROSTER_UNAVAILABLE_REASON : null)}>{children}</AdministrationProvider>
    <section aria-labelledby="access-saved-work" className="flex min-w-0 flex-col gap-3">
      <SectionHeader id="access-saved-work" title="Saved access work" description="Open an exact review for approval, or read a recorded outcome after reloading this page." />
      {saved.isPending ? <p role="status" className="text-ui text-ink-muted">Loading saved access work…</p> : saved.isError ? <p role="alert" className="text-ui text-danger-ink">Saved access work could not be loaded. Check access and connection.</p> : items.length === 0 ? <p className="text-ui text-ink-muted">No saved access work.</p> : <ul className="divide-y divide-line rounded-(--np-radius-card) border border-line">{items.map((item) => <li key={item.reviewId} className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0"><p className="text-ui">{ACCESS_OPERATION_LABELS[item.request.operation]}</p><p className="text-caption text-ink-muted">{new Date(item.createdAt).toLocaleString("en-GB")} · {item.attemptId ? "Recorded outcome" : "Saved review"}</p></div><Button variant="secondary" size="sm" disabled={action.busy || Boolean(action.unresolved && (action.review?.changeSet.id ?? action.attempt?.reviewId) !== item.reviewId)} onClick={() => action.open(item)}>{item.attemptId ? "Open outcome" : "Open review"}</Button></li>)}</ul>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={saved.isFetching} onClick={() => { void saved.refetch() }}>Reload saved access work</Button>{saved.hasNextPage && <Button variant="secondary" disabled={saved.isFetchingNextPage} onClick={() => { void saved.fetchNextPage() }}>Load earlier access work</Button>}</div>
    </section>
  </div></Context.Provider>
}

/**
 * Stands in for roster rows read before a confirmed access change, so a list
 * Google has since changed is never presented as current.
 */
export function StaleRosterPlaceholder({ what }: { what: string }) {
  const { rosterUpdating, rosterUnavailable, retryRoster } = useAdministrationAccess()
  if (!rosterUpdating && !rosterUnavailable) return null
  return <div role="status" className="flex min-w-0 flex-col items-start gap-2 rounded-(--np-radius-card) border border-dashed border-line bg-surface px-4 py-4 text-ui text-ink-muted">
    {rosterUpdating
      ? <p>{`Updating ${what} from Google after the confirmed change. The earlier list is hidden until Google’s current list arrives.`}</p>
      : <>
        <p>{`Google’s ${what} after the confirmed change could not be read. The earlier list is hidden because it may be out of date.`}</p>
        <Button size="sm" variant="secondary" onClick={retryRoster}>Read Google’s list again</Button>
      </>}
  </div>
}
