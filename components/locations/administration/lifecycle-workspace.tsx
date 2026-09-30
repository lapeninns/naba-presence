"use client"

import { createContext, useContext, useState, type Dispatch, type SetStateAction, type ReactNode } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/section-header"
import { fetchLifecycleAttempt, fetchLifecycleWorkflows } from "@/lib/api/google-lifecycle"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { lifecycleEnded, type LifecycleEnded } from "./lifecycle-ended"
import { LifecycleOutcome } from "./lifecycle-outcome"
import { LifecycleReview } from "./lifecycle-review"
import { useLifecycle } from "./use-lifecycle"

const Context = createContext<(ReturnType<typeof useLifecycle> & { setAccessBlocked: Dispatch<SetStateAction<boolean>>; ended: LifecycleEnded | null }) | null>(null)
export const useLifecycleContext = () => useContext(Context)
export function LifecycleWorkspace({ locationId, locationName, children }: {
  readonly locationId: string; readonly locationName?: string; readonly children: ReactNode
}) {
  const [accessBlocked, setAccessBlocked] = useState(false)
  const workflow = useLifecycle(locationId, accessBlocked), capabilities = useLocationCapabilities(locationId)
  const role = useSessionRole(), directory = useLocationDirectory(role)
  const name = locationName ?? directory.data?.find((entry) => entry.id === locationId)?.name ?? ""
  const visible = (role === "owner" || role === "admin") && capabilities.data?.canEditCanonical === true
  const saved = useInfiniteQuery({ queryKey: ["lifecycle-workflows", locationId], enabled: visible, initialPageParam: "",
    queryFn: ({ pageParam, signal }) => fetchLifecycleWorkflows(locationId, pageParam, { signal }), getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = saved.data?.pages.flatMap((page) => page.items) ?? []
  // The latest recorded lifecycle outcome decides whether this account still
  // manages the location, so a confirmed deletion survives a reload or reset.
  const latestIndex = items.findIndex((item) => item.attemptId)
  const latestRecorded = latestIndex >= 0 ? items[latestIndex] : undefined
  const latest = useQuery({
    queryKey: ["lifecycle-latest-attempt", locationId, latestRecorded?.reviewId], enabled: visible && Boolean(latestRecorded), retry: false,
    queryFn: ({ signal }) => fetchLifecycleAttempt(locationId, latestRecorded?.reviewId ?? "", { signal }),
  })
  // An outcome held in this session counts unless it belongs to work that is
  // known to be older than the latest recorded outcome.
  const olderReviewIds = new Set(latestIndex >= 0 ? items.slice(latestIndex + 1).map((item) => item.reviewId) : [])
  const sessionAttempt = workflow.attempt && !olderReviewIds.has(workflow.attempt.reviewId) ? workflow.attempt : null
  const ended = visible ? lifecycleEnded(sessionAttempt) ?? lifecycleEnded(latest.data) : null
  return <Context.Provider value={{ ...workflow, setAccessBlocked, ended }}><div className="flex min-w-0 flex-col gap-6">
    {visible && (workflow.review || workflow.attempt || workflow.error) ? <div className="flex min-w-0 flex-col gap-3">
      {workflow.error ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
      {accessBlocked ? <p role="status" className="text-ui text-ink-secondary">Resolve the current access action before approving or sending a lifecycle request.</p> : null}
      {workflow.attempt ? <LifecycleOutcome workflow={workflow} /> : <LifecycleReview workflow={workflow} locationName={name} disabled={!capabilities.data?.canPublish || accessBlocked} />}
    </div> : null}
    {children}
    {visible ? <section aria-labelledby="lifecycle-saved-work" className="flex min-w-0 flex-col gap-3">
      <SectionHeader id="lifecycle-saved-work" title="Saved lifecycle work" description="Read recorded outcomes after reloading, expiry or disconnection. Sending and independent confirmation remain separate." />
      {saved.isPending ? <p role="status" className="text-ui text-ink-muted">Loading saved lifecycle work…</p> : saved.isError ? <p role="alert" className="text-ui text-danger-ink">Saved lifecycle work could not be loaded. Check your current access.</p> : items.length === 0 ? <p className="text-ui text-ink-muted">No saved lifecycle work.</p> : <ul className="divide-y divide-line rounded-(--np-radius-card) border border-line">{items.map((item) => <li key={item.reviewId} className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-3"><div className="min-w-0"><p className="text-ui">{item.request.operation === "transfer_location" ? "Account transfer" : "Managed-location deletion"}</p><p className="text-caption text-ink-muted">{new Date(item.createdAt).toLocaleString("en-GB")} · {item.attemptId ? "Recorded outcome" : "Saved review"}</p></div><Button variant="secondary" size="sm" disabled={workflow.busy || Boolean(workflow.unresolved && (workflow.review?.changeSet.id ?? workflow.attempt?.reviewId) !== item.reviewId)} onClick={() => workflow.open(item)}>{item.attemptId ? "Open lifecycle outcome" : "Open lifecycle review"}</Button></li>)}</ul>}
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={saved.isFetching} onClick={() => { void saved.refetch() }}>Reload saved lifecycle work</Button>{saved.hasNextPage ? <Button variant="secondary" disabled={saved.isFetchingNextPage} onClick={() => { void saved.fetchNextPage() }}>Load earlier lifecycle work</Button> : null}</div>
    </section> : null}
  </div></Context.Provider>
}
