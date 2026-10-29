"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  useInfiniteQuery,
  useIsFetching,
  useQueryClient,
} from "@tanstack/react-query"
import {
  ReviewedWritePanel,
  reviewedWriteStage,
  SavedWorkList,
  type SavedWorkItem,
} from "@/components/reviewed-write"
import { Button } from "@/components/ui/button"
import { fetchAdministrationAccessWorkflows } from "@/lib/api/google-administration-access"
import { queryKeys } from "@/lib/queries/keys"
import { AdministrationProvider, useAdministrationSection } from "./context"
import { useAdministrationAccessController } from "./use-administration-access"
import { ACCESS_OPERATION_LABELS, AccessReview } from "./access-review"
import { AccessOutcome } from "./access-outcome"
import { InviteSheet } from "./invite-sheet"
import { useLifecycleContext } from "./lifecycle-workspace"

type AccessWorkspaceValue = ReturnType<
  typeof useAdministrationAccessController
> & {
  /** The Google roster on screen predates a confirmed change and is being read again. */
  readonly rosterUpdating: boolean
  /** The roster predates a confirmed change and the read after it failed. */
  readonly rosterUnavailable: boolean
  /** Read Google's roster again after a failed post-confirmation read. */
  readonly retryRoster: () => void
  /** Opens the invitation sheet on its form. */
  readonly openInvite: () => void
}
const Context = createContext<AccessWorkspaceValue | null>(null)
/** Why roster actions wait after a confirmed change, shared by the row controls. */
export const ROSTER_UPDATING_REASON =
  "Updating from Google after the confirmed change. The list below may be out of date until Google's current list arrives."
/** Why roster actions wait when Google's list after a confirmed change could not be read. */
export const ROSTER_UNAVAILABLE_REASON =
  "Google's list after the confirmed change could not be read. Read it again before another access change."
function initialCursor(): string | undefined {
  return undefined
}
export function useAdministrationAccess() {
  const value = useContext(Context)
  if (!value)
    throw new Error(
      "Administration access controls require their review workspace."
    )
  return value
}
/**
 * `children` are the access roster; `after` follows "Saved access work" (the
 * explainers and the danger zone), so a second approver reaches a saved
 * invitation without passing destructive controls. Both read the same
 * composed gates, so `after` is blocked by in-progress access exactly as the
 * roster is.
 */
export function AdministrationAccessWorkspace({
  children,
  after,
}: {
  children: ReactNode
  after?: ReactNode
}) {
  const section = useAdministrationSection()
  const { locationId, writeBlocked } = section
  const action = useAdministrationAccessController(locationId)
  const [inviteOpen, setInviteOpen] = useState(false)
  // The review or outcome the person closed the invitation sheet on while it was unresolved.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const setAccessBlocked = useLifecycleContext()?.setAccessBlocked
  const client = useQueryClient(),
    rosterKey = queryKeys.locationAdministration(locationId)
  const rosterFetching = useIsFetching({ queryKey: rosterKey }) > 0
  const roster = client.getQueryState(rosterKey)
  // A roster read before the confirmed change is stale until a newer read lands.
  const rosterStale =
    action.confirmedAt !== null &&
    roster !== undefined &&
    roster.dataUpdatedAt < action.confirmedAt
  const rosterUpdating =
    rosterStale &&
    (rosterFetching || roster.errorUpdatedAt < (action.confirmedAt ?? 0))
  const rosterUnavailable = rosterStale && !rosterUpdating
  const retryRoster = () => {
    void client.refetchQueries({ queryKey: rosterKey })
  }
  useEffect(() => {
    setAccessBlocked?.(action.busy || action.unresolved)
  }, [setAccessBlocked, action.busy, action.unresolved])
  const saved = useInfiniteQuery({
    queryKey: queryKeys.locationAccessWorkflows(locationId),
    initialPageParam: initialCursor(),
    queryFn: ({ pageParam, signal }) =>
      fetchAdministrationAccessWorkflows(locationId, pageParam, { signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = saved.data?.pages.flatMap((page) => page.items) ?? []
  const review = action.review,
    attempt = action.attempt
  // The panel claims focus (and so scrolls into view) whenever a review or
  // outcome opens: after the dialog that created it closes, or from a saved
  // work row far below. selectionRevision moves on every preview, open and
  // send, but not on approval or a refresh, so those never steal focus.
  const focusKey = attempt
    ? `attempt:${attempt.reviewId}:${action.selectionRevision}`
    : review
      ? `review:${review.changeSet.id}:${action.selectionRevision}`
      : null
  // An invitation reads and sends on its own sheet (the form, the review and
  // the outcome); the page panel holds every other access change.
  const invitation = (attempt ?? review)?.request.operation === "create_admin"
  // The sheet is up while its form is open, and for an invitation review or outcome until it is closed on.
  const inviteShown =
    inviteOpen || (invitation && dismissedAt !== action.selectionRevision)
  const publishReason =
    section.publishReason ??
    (action.busy
      ? "An access action is in progress. Wait for its saved response before another Google change."
      : action.unresolved
        ? "Resolve the saved access outcome before another Google change."
        : rosterUpdating
          ? ROSTER_UPDATING_REASON
          : rosterUnavailable
            ? ROSTER_UNAVAILABLE_REASON
            : null)
  const savedItems: SavedWorkItem[] = items.map((item) => ({
    id: item.reviewId,
    operation: ACCESS_OPERATION_LABELS[item.request.operation],
    stage: item.attemptId ? "Recorded outcome" : "Saved review",
    createdAt: item.createdAt,
    actionLabel: item.attemptId ? "Open outcome" : "Open review",
    disabled:
      action.busy ||
      Boolean(
        action.unresolved &&
        (review?.changeSet.id ?? attempt?.reviewId) !== item.reviewId
      ),
    onOpen: () => action.open(item),
  }))
  return (
    <Context.Provider
      value={{
        ...action,
        rosterUpdating,
        rosterUnavailable,
        retryRoster,
        openInvite: () => {
          setDismissedAt(null)
          setInviteOpen(true)
        },
      }}
    >
      <div className="flex min-w-0 flex-col gap-6">
        {(review || attempt || action.error) && !inviteShown ? (
          <ReviewedWritePanel
            id="access-review-workspace"
            title={
              attempt
                ? "Saved access outcome"
                : review
                  ? "Review access request"
                  : "Access request"
            }
            description={
              review && !attempt
                ? "Review this exact target and action. Approval saves permission to send; it does not change access on Google."
                : undefined
            }
            stage={
              attempt
                ? "outcome"
                : review
                  ? reviewedWriteStage({
                      approved: Boolean(review.changeSet.approvedBy),
                      recorded: false,
                    })
                  : undefined
            }
            secondApprover={review?.changeSet.requiresSecondApprover}
            focusKey={focusKey}
          >
            {action.error && (
              <p role="alert" className="text-ui text-danger-ink">
                {action.error}
              </p>
            )}
            {attempt ? (
              <AccessOutcome
                attempt={attempt}
                review={review}
                busy={action.busy}
                onCheck={() => action.check()}
                onRefresh={() => action.check(true)}
                onBack={action.reset}
              />
            ) : review ? (
              <AccessReview
                key={`${review.changeSet.id}:${action.selectionRevision}`}
                review={review}
                locationName={section.locationName}
                busy={action.busy}
                blocked={writeBlocked}
                uncertain={action.uncertain}
                stale={action.stale}
                onApprove={action.approve}
                onExecute={action.execute}
                onCheck={() => action.check()}
                onBack={action.reset}
              />
            ) : null}
          </ReviewedWritePanel>
        ) : null}
        <AdministrationProvider
          locationId={locationId}
          locationName={section.locationName}
          disabled={section.disabled}
          publishReason={publishReason}
        >
          {children}
        </AdministrationProvider>
        <InviteSheet
          action={action}
          section={section}
          formBlocked={Boolean(publishReason)}
          open={inviteShown}
          onOpenChange={(next) => {
            setInviteOpen(next)
            if (!next) setDismissedAt(action.selectionRevision)
          }}
        />
        <SavedWorkList
          id="access-saved-work"
          title="Saved access work"
          description="Open an exact review for approval, or read a recorded outcome after reloading this page."
          items={savedItems}
          pending={saved.isPending}
          failed={saved.isError}
          loadingText="Loading saved access work…"
          errorText="Saved access work could not be loaded. Check access and connection."
          emptyText="No saved access work."
          reloadLabel="Reload saved access work"
          reloading={saved.isFetching}
          onReload={() => {
            void saved.refetch()
          }}
          loadMoreLabel="Load earlier access work"
          hasMore={saved.hasNextPage}
          loadingMore={saved.isFetchingNextPage}
          onLoadMore={() => {
            void saved.fetchNextPage()
          }}
        />
        {after ? (
          <AdministrationProvider
            locationId={locationId}
            locationName={section.locationName}
            disabled={section.disabled}
            publishReason={publishReason}
          >
            {after}
          </AdministrationProvider>
        ) : null}
      </div>
    </Context.Provider>
  )
}

/**
 * Stands in for roster rows read before a confirmed access change, so a list
 * Google has since changed is never presented as current.
 */
export function StaleRosterPlaceholder({ what }: { what: string }) {
  const { rosterUpdating, rosterUnavailable, retryRoster } =
    useAdministrationAccess()
  if (!rosterUpdating && !rosterUnavailable) return null
  return (
    <div
      role="status"
      className="flex min-w-0 flex-col items-start gap-2 rounded-(--np-radius-card) border border-dashed border-line bg-surface px-4 py-4 text-ui text-ink-muted"
    >
      {rosterUpdating ? (
        <p>{`Updating ${what} from Google after the confirmed change. The earlier list is hidden until Google’s current list arrives.`}</p>
      ) : (
        <>
          <p>{`Google’s ${what} after the confirmed change could not be read. The earlier list is hidden because it may be out of date.`}</p>
          <Button size="sm" variant="secondary" onClick={retryRoster}>
            Read Google’s list again
          </Button>
        </>
      )}
    </div>
  )
}
