"use client"

import { useRouter, useSearchParams } from "next/navigation"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import { useClientScopeHandler } from "@/components/app-shell/client-context"
import { PageChrome } from "@/components/app-shell/page-chrome"
import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import { InboxHotkeys } from "@/components/inbox/inbox-hotkeys"
import { InboxBottomToolbarSpacer } from "@/components/inbox/inbox-bottom-toolbar"
import { InboxToolbar } from "@/components/inbox/inbox-toolbar"
import { LazyBulkActionBar } from "@/components/inbox/lazy-bulk-action-bar"
import { ListHeader } from "@/components/inbox/list-header"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
import { ReviewList, ReviewRowsSkeleton } from "@/components/inbox/review-list"
import { EmptyState, Statement } from "@/components/inbox/empty-states"
import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"
import {
  LazyReviewPane,
  reloadReviewPane,
  useIdlePreloadReviewPane,
} from "@/components/inbox/lazy-review-pane"
import {
  DirtyGuardProvider,
  useDirtyGate,
  useReadIsDirty,
} from "@/components/inbox/dirty-context"
import { cn } from "@/lib/utils"
import { useWorkspaceMode } from "@/lib/workspace/mode"
import { Button } from "@/components/ui/button"
import { QueryStates } from "@/components/ui/query-states"
import { Spinner } from "@/components/ui/spinner"
import { emptyCounts, emptyReason } from "@/lib/inbox/empty-reason"
import { useClients } from "@/lib/queries/use-clients"
import {
  autoSelectId,
  DESKTOP_MEDIA_QUERY,
  hasActiveFilters,
  parseInboxState,
  scopeInboxState,
  serializeInboxState,
  toReviewsFilters,
  visibleQueue,
  type InboxState,
  type Queue,
} from "@/lib/inbox/url-state"
import {
  DEFAULT_REVIEW_SORT,
  REVIEW_QUEUE_LABELS,
} from "@/lib/contracts/review-values"
import { inboxWaiting } from "@/lib/inbox/waiting"
import { INBOX_SPLIT_STYLE } from "@/lib/inbox/layout"
import { adjacentReviewId, type AdjacentDirection } from "@/lib/inbox/queue-nav"
import {
  PRIMARY_ACTION_EVENT,
  PUBLISH_PULSE_EVENT,
  PUBLISH_PULSE_MS,
  REPLY_FOCUS_EVENT,
  REPLY_GENERATE_EVENT,
  SEARCH_FOCUS_EVENT,
  type PublishPulseDetail,
} from "@/lib/inbox/events"
import type { ReviewRow } from "@/lib/api/reviews"
import { flattenReviews, useReviews } from "@/lib/queries/use-reviews"
import { useReviewCounts } from "@/lib/queries/use-review-counts"
import { useHydrated } from "@/lib/hooks/use-hydrated"
import { useHydratedBreakpoint } from "@/lib/hooks/use-media-query"
import { useConnectionHealth } from "@/lib/queries/use-connection-health"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { formatNumber } from "@/lib/format"
import { useNowHour } from "@/lib/time/server-now"
import { pushUrl, replaceUrl } from "@/lib/navigation/shallow-url"

/**
 * On a phone the panes run edge to edge (reference `.panel` below md): the
 * page's phone gutter (`max-md:px-4`, app/(dashboard)/inbox/page.tsx) is
 * cancelled, so a row's hairline and fill reach the screen's edges.
 */
const PHONE_BLEED = "max-md:-mx-4"

/** The nearest ancestor that scrolls: the shell's column, or the document. */
function scrollParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null
  while (current) {
    const { overflowY } = window.getComputedStyle(current)
    if (overflowY === "auto" || overflowY === "scroll") return current
    current = current.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

/**
 * Whether the list and the review sit side by side (from lg). Read at the
 * moment a behaviour needs it — never to choose which tree renders: the
 * layout is CSS keyed on `data-view`, so a phone opened on `?selected=` is
 * served the review, not a desktop page that flips after hydration. Without
 * matchMedia (a test double, an old engine) it answers as the desk does.
 */
function isSplitView(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return true
  return Boolean(window.matchMedia(DESKTOP_MEDIA_QUERY)?.matches)
}

/** "14:32" — when this list was last fetched, in the viewer's own clock. */
function refreshedAt(timestamp: number | undefined): string | null {
  if (!timestamp) return null
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

/**
 * Where an empty queue sends the operator: the queues that hold work, in
 * order. Done is history, never the next piece of work, so it is not here.
 */
const NEXT_WORK = ["needs_reply", "failed", "approval", "publishing"] as const

/**
 * Filters that hide rows. The client scope is the app bar's, and a sort only
 * orders the rows, so neither makes an empty list a filtered one (the queue
 * tabs ask the same question the same way).
 */
function narrowsList(state: InboxState): boolean {
  return hasActiveFilters({
    ...state,
    clientId: undefined,
    sort: DEFAULT_REVIEW_SORT,
  })
}

/**
 * Focuses the Filters button that is on screen, the control that narrows the
 * list again, after the filters were cleared from somewhere that then went
 * away (the chip strip, the empty state). On a phone in search mode the
 * button comes back a render later, so it is looked for over a few frames.
 */
function focusFiltersButton(root: HTMLElement | null, frames = 10) {
  const target = [
    ...(root?.querySelectorAll<HTMLElement>(
      '[data-slot="inbox-filter-toolbar"] button[aria-haspopup="dialog"]'
    ) ?? []),
  ].find((element) => element.checkVisibility?.() ?? true)
  if (target) {
    target.focus({ preventScroll: true })
    return
  }
  if (frames > 0) {
    requestAnimationFrame(() => focusFiltersButton(root, frames - 1))
  }
}

function InboxViewInner({
  showLocationFilter,
  actions,
  sync,
  bulkEngine,
}: {
  showLocationFilter: boolean
  actions?: ReactNode
  sync?: ReactNode
  bulkEngine: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // A business has no client scope: a stale `?clientId=` is ignored, so it
  // can neither filter the list nor surface a "Client" chip.
  const business = useWorkspaceMode() === "business"
  const state = useMemo(() => {
    const parsed = parseInboxState(new URLSearchParams(searchParams.toString()))
    return business ? { ...parsed, clientId: undefined } : parsed
  }, [business, searchParams])
  // An age preset's window moves on the hour. The hour comes from the
  // hydration-stable clock, so the server and the hydrating browser build
  // the same query key however far the device clock is off. Read to the
  // hour, not the millisecond: the clock ticks every 15 s, and re-rendering
  // the whole inbox (list, rows, review) on each tick bought nothing.
  const hour = useNowHour()
  const filters = useMemo(
    () => toReviewsFilters(state, { now: hour }),
    [state, hour]
  )
  const dirtyGate = useDirtyGate()
  const readIsDirty = useReadIsDirty()

  const reviewsQuery = useReviews(filters)
  // Scoped to the client in view, so a queue's badge counts the rows that
  // queue will show. Unscoped, this is the key the dashboard layout
  // hydrates for the shell badge; scoped, the inbox page prefetches it.
  const countsQuery = useReviewCounts({ clientId: state.clientId })
  // The sidebar badge registers the same organisation-wide counts key in the
  // shell before this page's HydrationBoundary runs, and TanStack defers
  // hydrating an existing query to an effect. The server render and the
  // first client render could therefore disagree on whether counts exist,
  // which threw a hydration error on every inbox load. The queue tabs show
  // their skeleton until hydration has finished, on both sides. (The
  // dashboard layout now hydrates that key above the shell, so both renders
  // normally agree; the gate stays as the cheap guarantee that they do.)
  const hydrated = useHydrated()
  const toolbarCounts = hydrated ? countsQuery.data : undefined
  const toolbarCountsPending = !hydrated || countsQuery.isPending

  // One h1 per view. With a review open, a phone's h1 is the reviewer's name
  // and the toolbar (hidden with the list) is not; from lg the list is beside
  // the review, the name is a plain h2 and "Inbox" is the h1. CSS already
  // hides the toolbar below lg, but a hidden h1
  // is still a second h1 in the document, so once the client knows its
  // width the hidden one is drawn as plain text — same classes, so nothing
  // moves. Until then (server, hydration) both stay headings: the CSS-only
  // shape.
  const splitView = useHydratedBreakpoint("lg")
  const detailOpen = Boolean(state.selected)
  const toolbarTitleIsHeading = !detailOpen || splitView !== false
  const headTitleIsHeading = splitView !== true
  const clientsQuery = useClients()
  // Narrowed to the client in view when the inbox is filtered to one, so the
  // empty state describes the client the operator is looking at rather than
  // the whole agency.
  const scopedClients = (clientsQuery.data?.items ?? []).filter(
    (client) => !state.clientId || client.id === state.clientId
  )
  const selection = useSelection()
  const health = useConnectionHealth()
  // Via the shared directory hook, not a bare useQuery on the same key: this
  // view and LocationsIndex share one QueryClient across client navigation,
  // and writing the raw `{locations: […]}` envelope here while the hook writes
  // a mapped array meant whichever mounted last corrupted the other.
  const role = useSessionRole()
  const locationsQuery = useLocationDirectory(role)
  // A viewer cannot assign, mark or approve, so the bulk tools — the tick
  // boxes and the bar they raise — are not offered (reference: the bulk bar
  // is hidden for view-only access). The server refuses them regardless.
  const canBatch = role !== "viewer"

  // One array per fetched result, not per render: the list's effects and
  // observers, the handlers below and the hotkeys all follow it. The query
  // result itself is a new object every render, so callbacks depend on the
  // fields they read rather than on it.
  const reviews = useMemo(
    () => flattenReviews(reviewsQuery.data),
    [reviewsQuery.data]
  )
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = reviewsQuery

  // No page state: the list loads continuously. The seven-per-page control
  // over a fifty-row window meant "Page 3 of 8" was only ever true of the rows
  // already fetched, and an operator working a backlog spent as much time
  // paging as replying.
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Selection, queue, filters and search live in the address, but only the
  // client reads them: each change rewrites the URL through the history API
  // (lib/navigation/shallow-url.ts), so a row click or a keystroke costs no
  // server round trip. The page's server prefetch reads the address on the
  // first load only.
  const updateState = useCallback(
    (partial: Partial<InboxState>, mode: "replace" | "push") => {
      const next = serializeInboxState({ ...state, ...partial })
      const query = next.toString()
      const href = query ? `/inbox?${query}` : "/inbox"
      if (mode === "push") pushUrl(href)
      else replaceUrl(href)
    },
    [state]
  )

  // One change of client scope, made by the top-bar switcher (through the
  // shell's handler). The queue and the other filters stay (see
  // `scopeInboxState`); an open review of another client closes, and if it
  // holds an unsaved reply the operator is asked first. Resolves false when
  // they kept editing, so the switcher leaves its preference alone.
  const applyClientScope = useCallback(
    async (clientId: string | undefined): Promise<boolean> => {
      const next = scopeInboxState(state, clientId, {
        locationClientIds: new Map(
          (locationsQuery.data ?? []).map((location) => [
            location.id,
            location.clientId ?? null,
          ])
        ),
        selectedClientId:
          reviews.find((review) => review.id === state.selected)?.location
            .clientId ?? null,
      })
      if (state.selected && !next.selected && !(await dirtyGate())) return false
      updateState(next, "replace")
      return true
    },
    [dirtyGate, locationsQuery.data, reviews, state, updateState]
  )
  useClientScopeHandler((clientId) => applyClientScope(clientId ?? undefined))

  // Filters use replace (no history spam) and drop any stale selection —
  // unless the open reply holds unsaved edits. Then the review stays open
  // and only the list narrows: the discard confirm used to pop up a moment
  // after each debounced keystroke in the search, for an edit the search had
  // no reason to touch. The review is fetched by id, so it keeps rendering
  // whether or not the narrowed list still contains it.
  const onFilterChange = useCallback(
    (partial: Partial<InboxState>) => {
      if (readIsDirty()) {
        updateState(partial, "replace")
        return
      }
      updateState({ ...partial, selected: undefined }, "replace")
    },
    [readIsDirty, updateState]
  )
  const onQueueChange = useCallback(
    (queue: Queue) => {
      void (async () => {
        if (!(await dirtyGate())) return
        // The client scope survives a queue change: an operator moving from
        // one client's Needs reply to its Failed queue is still working that
        // client.
        updateState({ queue, selected: undefined }, "replace")
      })()
    },
    [dirtyGate, updateState]
  )
  // Opening a review from the list on a phone pushes, so Back returns to the
  // list (spec §6). Every other change of selection — a click beside the
  // list, the arrows, j / k, the advance after a publish — replaces: walking
  // a backlog of fifty reviews used to leave fifty history entries between
  // the operator and the page they came from. Gated behind the dirty guard:
  // while the composer is dirty this either confirms discarding the edit
  // (AlertDialog) or blocks the selection change. The boolean return tells
  // ReviewList's arrow-key handler whether it's safe to move DOM focus onto
  // the target row (see review-list.tsx).
  // Notes where the list was scrolled before a narrow screen swaps it for the
  // detail (kept current by an effect further down, beside the restore).
  const onBeforeOpenRef = useRef<() => void>(() => {})
  const rootRef = useRef<HTMLDivElement>(null)
  // The review pane loads separately from the list; fetch it ahead of a tap.
  useIdlePreloadReviewPane()
  const listScrollRef = useRef<HTMLElement>(null)
  const savedScroll = useRef<{ page: number; list: number } | null>(null)
  // The open review was pushed over the list (opened from it below lg), so
  // the way back is to pop that entry rather than add another.
  const openedByPushRef = useRef(false)
  const onSelect = useCallback(
    async (id: string): Promise<boolean> => {
      if (!(await dirtyGate())) return false
      onBeforeOpenRef.current()
      const opensFromList = !isSplitView() && !state.selected
      openedByPushRef.current = opensFromList
      updateState({ selected: id }, opensFromList ? "push" : "replace")
      return true
    },
    [dirtyGate, state.selected, updateState]
  )
  // Like a filter change: a dirty reply stays open while the list widens.
  const onClearFilters = useCallback(() => {
    const query = serializeInboxState({
      queue: state.queue,
      locationIds: [],
      ratings: [],
      search: "",
      sort: "updated_desc",
      // The client scope is the app bar's, not a filter: it stays.
      clientId: state.clientId,
      selected: readIsDirty() ? state.selected : undefined,
    }).toString()
    replaceUrl(query ? `/inbox?${query}` : "/inbox")
  }, [readIsDirty, state.clientId, state.queue, state.selected])
  // The chip strip and the empty state's button go away once nothing is
  // filtered, taking keyboard focus with them; it goes to the Filters
  // button, as leaving search mode does (inbox-toolbar.tsx).
  const focusFilters = useCallback(() => {
    focusFiltersButton(rootRef.current)
  }, [])
  // Same gate as the handlers above: returning to the list also drops
  // `selected`, which would otherwise silently unmount a dirty composer.
  // When the review was pushed over the list, Back to Inbox pops that entry
  // (as the OS back gesture would), so history stays list → review and no
  // list entry piles up on top of it. Every other open replaced, so this
  // replaces too.
  //
  // A pushed review with an unsaved reply is the exception: the leave guard
  // keeps its sentinel entry on top of the history while the reply is dirty,
  // so stepping back lands on it and the guard asks — once, and its
  // "Discard" goes on back to the list. Asking here first put a second
  // "Discard unsaved reply?" up after the first was answered.
  const onBackToList = useCallback(() => {
    if (openedByPushRef.current && readIsDirty()) {
      router.back()
      return
    }
    void (async () => {
      if (!(await dirtyGate())) return
      if (openedByPushRef.current) {
        openedByPushRef.current = false
        router.back()
        return
      }
      updateState({ selected: undefined }, "replace")
    })()
  }, [dirtyGate, readIsDirty, router, updateState])

  // Resolves to the review it moved to, or null when it did not move.
  const onAdjacentReview = useCallback(
    async (direction: AdjacentDirection): Promise<ReviewRow | null> => {
      if (!(await dirtyGate())) return null
      const nextId = adjacentReviewId(reviews, state.selected, direction)
      if (nextId) {
        updateState({ selected: nextId }, "replace")
        return reviews.find((review) => review.id === nextId) ?? null
      }
      if (direction === "next" && hasNextPage && !isFetchingNextPage) {
        const result = await fetchNextPage()
        const newItems = result.data?.pages.at(-1)?.items ?? []
        const firstNew = newItems[0]
        if (firstNew) {
          updateState({ selected: firstNew.id }, "replace")
          return firstNew
        }
      }
      return null
    },
    [
      dirtyGate,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      reviews,
      state.selected,
      updateState,
    ]
  )

  // Spec §6 auto-selection: on desktop, when the URL carries no selection, pick
  // the first row (replace, so it adds no history). Reads live dirtiness
  // imperatively via `useReadIsDirty()` for the (rare) cleared-while-dirty edge.
  // `keepPreviousData` keeps the OLD queue's rows on screen while the new
  // one loads. Auto-selecting from them re-adds a `selected` id that does not
  // belong to the queue the operator just chose — it reappeared in the URL
  // moments after the handler cleared it, and the pane showed a review the
  // list no longer contained.
  const reviewsReady =
    !reviewsQuery.isPending &&
    !reviewsQuery.isError &&
    !reviewsQuery.isPlaceholderData
  useEffect(() => {
    if (!reviewsReady) return
    const id = autoSelectId({
      selected: state.selected,
      reviews,
      isDirty: readIsDirty(),
      isDesktop: isSplitView(),
    })
    if (id) {
      // Nobody asked for this navigation, so it must not move the page. A
      // history rewrite neither scrolls nor focuses (Next's navigation did
      // both, which slid the org-wide reconnect banner under the toolbar on
      // every desktop load).
      replaceUrl(
        `/inbox?${serializeInboxState({ ...state, selected: id }).toString()}`
      )
    }
  }, [reviewsReady, reviews, state, readIsDirty])

  // After a successful publish, move to the next review so the 674-item
  // backlog is a loop rather than "Back to reviews" + another click. The move
  // waits PUBLISH_PULSE_MS so the situation strip's success ring (which lives
  // in the detail pane keyed on `state.selected`, and so unmounts on
  // navigation) is actually seen. The latest handler and selection are read
  // through refs so the window listener subscribes once, not every time the
  // list or the selection changes.
  //
  // The advance was the operator's doing — they pressed Publish or Approve —
  // so it says what happened and where they now are, and puts focus on the
  // new review's name. Without that, keyboard and screen-reader users were
  // left on a Publish button that had been unmounted under them.
  const [advance, setAdvance] = useState<{
    reviewId: string
    message: string
  } | null>(null)
  const advanceTargetRef = useRef<string | null>(null)
  const onAdjacentReviewRef = useRef(onAdjacentReview)
  const selectedRef = useRef(state.selected)
  const reviewsRef = useRef(reviews)
  const selectReviewRef = useRef((id: string) => {
    updateState({ selected: id }, "replace")
  })
  useEffect(() => {
    onAdjacentReviewRef.current = onAdjacentReview
    selectedRef.current = state.selected
    reviewsRef.current = reviews
    selectReviewRef.current = (id: string) => {
      updateState({ selected: id }, "replace")
    }
  }, [onAdjacentReview, reviews, state.selected, updateState])
  useEffect(() => {
    let timer: number | undefined
    function onPublished(event: Event) {
      const detail = (event as CustomEvent<PublishPulseDetail>).detail
      const reviewId = detail?.reviewId
      if (!reviewId || reviewId !== selectedRef.current) return
      const outcome =
        detail.status === "pending"
          ? "Reply sent to Google."
          : "Reply published."
      const arrivedAt = (row: ReviewRow | null | undefined) => {
        if (!row) return
        advanceTargetRef.current = row.id
        const name = row.reviewer.isAnonymous ? null : row.reviewer.displayName
        setAdvance({
          reviewId: row.id,
          message: name
            ? `${outcome} Now showing ${name}'s review.`
            : `${outcome} Now showing the next review.`,
        })
      }
      // Decide the target NOW: the publish mutation invalidates the list, and
      // in the Needs reply queue the refetch drops the just-published review
      // out of it well inside the pulse, after which "next of the selected
      // review" no longer resolves. Fall back to whatever row now sits at the
      // same index (the list shifted up), then to the next API page.
      const loaded = reviewsRef.current
      const index = loaded.findIndex((review) => review.id === reviewId)
      const target = adjacentReviewId(loaded, reviewId, "next")
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = undefined
        // The operator moved on during the pulse — do not yank them again.
        if (selectedRef.current !== reviewId) return
        const current = reviewsRef.current
        const stillThere =
          target && current.some((review) => review.id === target)
        if (stillThere) {
          selectReviewRef.current(target)
          arrivedAt(current.find((review) => review.id === target))
          return
        }
        const shifted = index >= 0 ? current[index] : undefined
        if (shifted && shifted.id !== reviewId) {
          selectReviewRef.current(shifted.id)
          arrivedAt(shifted)
          return
        }
        void onAdjacentReviewRef.current("next").then(arrivedAt)
      }, PUBLISH_PULSE_MS)
    }
    window.addEventListener(PUBLISH_PULSE_EVENT, onPublished)
    return () => {
      window.removeEventListener(PUBLISH_PULSE_EVENT, onPublished)
      window.clearTimeout(timer)
    }
  }, [])

  const isListRefreshing =
    reviewsQuery.isFetching &&
    !reviewsQuery.isPending &&
    !reviewsQuery.isFetchingNextPage
  // TanStack's `isError` is also true when a refresh or the next page failed
  // over rows already loaded. Those rows stay: only a first load that failed
  // is the error state (as `usePagedResource` treats a failed load-more).
  const { isFetchNextPageError, isRefetchError } = reviewsQuery
  const listStatus = reviewsQuery.isPending
    ? "pending"
    : reviewsQuery.isError && reviewsQuery.data === undefined
      ? "error"
      : "ready"
  // A queue switch keeps the previous queue's rows while the new one loads.
  // Kept rows are covered by the refresh bar; kept NO rows would draw the new
  // queue's empty state ("Nothing needs a reply.") before the server has
  // said so, so that case is still loading.
  const switchingFromEmpty =
    reviews.length === 0 && Boolean(reviewsQuery.isPlaceholderData)

  // The rows a real list draws, in outline: the avatar, then the name and
  // age, the stars and venue, and the review's words — at the rows' own
  // heights, so nothing moves when they arrive.
  function renderListSkeleton() {
    return <ReviewRowsSkeleton aria-busy="true" />
  }

  function renderList() {
    // A failed fetch is NOT "no reviews yet" (the empty-state copy for a
    // genuinely empty queue) -- that would silently mask a real error with no
    // way to retry. QueryStates renders the retry alert; the queue-specific
    // empty states stay in renderLoadedList.
    return (
      <QueryStates
        status={listStatus}
        pending={renderListSkeleton()}
        error={{
          title: "We could not load your reviews.",
          cause: reviewsQuery.error,
          className: "p-(--np-card-pad)",
        }}
        onRetry={() => void reviewsQuery.refetch()}
      >
        {renderLoadedList}
      </QueryStates>
    )
  }

  function renderLoadedList() {
    if (switchingFromEmpty) return renderListSkeleton()
    if (reviews.length === 0) {
      // The clients this view already has in cache carry the import facts, so
      // the empty state can name which of the reasons it is instead of
      // guessing the reassuring one.
      // The counts are already scoped to the client in view, so the client
      // filter is the scope here rather than a filter hiding rows: an empty
      // queue for one client is that client's queue being clear.
      const facts = {
        hasActiveFilters: narrowsList(state),
        queue: state.queue,
        totalOutsideFilters: countsQuery.data?.total ?? 0,
        connection:
          health.status === "disconnected"
            ? ("disconnected" as const)
            : health.status === "connected"
              ? ("connected" as const)
              : ("unknown" as const),
        clients: scopedClients,
        noClients:
          clientsQuery.isSuccess &&
          (clientsQuery.data?.items ?? []).length === 0,
      }
      // From an empty queue, the first other queue that has work in it.
      const current = visibleQueue(state.queue)
      const next = NEXT_WORK.find(
        (queue) =>
          queue !== current && (countsQuery.data?.byQueue[queue] ?? 0) > 0
      )
      // An approver's Inbox count includes the replies parked for them, so
      // an empty Needs reply says where those are.
      const approvalsWaiting =
        current === "needs_reply"
          ? (inboxWaiting(countsQuery.data)?.awaitingMyApproval ?? 0)
          : 0
      // What matched nothing, and where. A search runs inside the queue on
      // screen, so the queue is named ("All reviews" is not a queue to name).
      const shownQueue = current ? state.queue : undefined
      const filtered = {
        search: state.search || undefined,
        searchOnly:
          Boolean(state.search) && !narrowsList({ ...state, search: "" }),
        queueLabel: shownQueue && REVIEW_QUEUE_LABELS[shownQueue],
        queueTotal: shownQueue
          ? countsQuery.data?.byQueue[shownQueue]
          : undefined,
      }
      return (
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <EmptyState
            reason={emptyReason(facts)}
            counts={emptyCounts(facts)}
            onClear={() => {
              // "Clear search" clears the search alone, as the search
              // field's own clear does; anything else clears every filter.
              if (filtered.searchOnly) onFilterChange({ search: "" })
              else onClearFilters()
              focusFilters()
            }}
            filtered={filtered}
            approvalsWaiting={
              approvalsWaiting > 0
                ? {
                    count: approvalsWaiting,
                    onSelect: () => onQueueChange("awaiting_my_approval"),
                  }
                : undefined
            }
            queue={state.queue}
            nextQueue={
              next
                ? {
                    label: REVIEW_QUEUE_LABELS[next],
                    count: countsQuery.data?.byQueue[next] ?? 0,
                    onSelect: () => onQueueChange(next),
                  }
                : undefined
            }
            canManageClients={role === "owner" || role === "admin"}
          />
        </div>
      )
    }
    return (
      <ReviewList
        ref={listScrollRef}
        reviews={reviews}
        selectedId={state.selected}
        queue={state.queue}
        onSelect={onSelect}
        onMovePastEnd={(direction) => {
          void onAdjacentReview(direction)
        }}
        isRefreshing={isListRefreshing}
        onReachEnd={loadMore}
        isLoadingMore={reviewsQuery.isFetchingNextPage}
        selection={
          canBatch
            ? {
                selected: selection.selected,
                selectMode: selection.selectMode,
                toggle: (id) => selection.toggle(id),
                extendTo: (id) =>
                  selection.extendTo(
                    id,
                    reviews.map((r) => r.id)
                  ),
              }
            : undefined
        }
      />
    )
  }

  // Below lg the detail replaces the list in place; its "Back to Inbox"
  // control takes focus so keyboard and screen-reader users land somewhere
  // meaningful instead of losing their place (ReviewList re-focuses the
  // originating row on the way back).
  // After an advance the new review's name takes focus instead (ReviewDetail's
  // `focusHeading`). After a step from the review's Previous / Next, the same
  // button in the new review keeps it, so the operator can tap on.
  const headStepRef = useRef<AdjacentDirection | null>(null)
  // A page that arrives already on a review (a deep link, a reload) leaves
  // focus where the browser puts it: nothing replaced the list, and a ring
  // on Back at first paint only says something moved that did not.
  const focusedFor = useRef(state.selected)
  useEffect(() => {
    if (focusedFor.current === state.selected) return
    focusedFor.current = state.selected
    if (!state.selected) return
    const step = headStepRef.current
    headStepRef.current = null
    if (advanceTargetRef.current === state.selected) {
      advanceTargetRef.current = null
      return
    }
    if (isSplitView()) return
    if (step) {
      const button = rootRef.current?.querySelector<HTMLButtonElement>(
        `[data-slot="review-steps"] [data-nav="${step === "prev" ? "previous" : "next"}"]`
      )
      if (button && !button.disabled) {
        button.focus({ preventScroll: true })
        return
      }
    }
    focusBackControl()
  }, [state.selected])

  // `r`, `g` and `a` are handled by the detail pane's own controls, which
  // know whether they are currently allowed; the hotkey layer only asks.
  // Firing a publish from here would bypass every gate the action bar
  // applies, so `a` asks the bar to press its own main button.
  const hotkeyHandlers = useMemo(
    () => ({
      next: () => void onAdjacentReview("next"),
      previous: () => void onAdjacentReview("prev"),
      // A viewer has no bulk tools, so the selection keys are not bound
      // (and not listed in the shortcuts dialog) for them.
      ...(canBatch
        ? {
            "toggle-selection": () => {
              if (state.selected) selection.toggle(state.selected)
            },
            "extend-selection": () => {
              if (state.selected)
                selection.extendTo(
                  state.selected,
                  reviews.map((review) => review.id)
                )
            },
            "clear-selection": () => selection.clear(),
          }
        : {}),
      // `r` asks the composer to open and take focus. It does not decide
      // whether editing is allowed — the composer knows the review's
      // capabilities and its workflow status, and the hotkey layer must not
      // second-guess either.
      reply: () => {
        if (!state.selected) return
        window.dispatchEvent(new Event(REPLY_FOCUS_EVENT))
      },
      // A viewer can neither draft nor publish, so these are not bound (and
      // not listed) for them.
      ...(canBatch
        ? {
            generate: () => {
              if (!state.selected) return
              window.dispatchEvent(new Event(REPLY_GENERATE_EVENT))
            },
            approve: () => {
              if (!state.selected) return
              window.dispatchEvent(new Event(PRIMARY_ACTION_EVENT))
            },
          }
        : {}),
      search: () => window.dispatchEvent(new Event(SEARCH_FOCUS_EVENT)),
    }),
    [canBatch, onAdjacentReview, reviews, selection, state.selected]
  )

  // The app bar's switcher only appears with more than one client. Without it
  // nothing there shows or clears a `?clientId=` scope, so the chip row does.
  const clientChip =
    state.clientId && clientsQuery.data && clientsQuery.data.items.length <= 1
      ? {
          name: clientsQuery.data.items.find(
            (client) => client.id === state.clientId
          )?.name,
          onRemove: () => void applyClientScope(undefined),
        }
      : undefined
  const loaded = listStatus === "ready"
  // In the viewer's own clock, which the server rendering a prefetched list
  // does not share: held back until hydration so the two renders agree.
  const refreshed = hydrated ? refreshedAt(reviewsQuery.dataUpdatedAt) : null
  const countLabel =
    listStatus === "pending" || switchingFromEmpty
      ? "Loading reviews…"
      : listStatus === "error"
        ? "Queue unavailable"
        : `${formatNumber(reviews.length)} ${
            reviews.length === 1 ? "review" : "reviews"
          }${reviewsQuery.hasNextPage ? " so far" : ""}`
  // "Adjusting state when a prop changes": the announcement follows the
  // filter set, and only once its first page has landed.
  const filtersKey = JSON.stringify(filters)
  const [countAnnouncement, setCountAnnouncement] = useState({
    key: "",
    text: "",
  })
  if (reviewsReady && countAnnouncement.key !== filtersKey) {
    setCountAnnouncement({ key: filtersKey, text: countLabel })
  }

  // One compact toolbar (title, search, queues, filters), then the chips of
  // what is applied — one block above the two panes. Every change goes
  // through the same dirty-gated handlers as the list.
  const workspaceControls = (
    <div
      data-slot="inbox-workspace-controls"
      // Edge to edge on a phone like the panes below it, with the page's
      // own gutter as padding, so the white band has no grey margins.
      className={cn(
        "flex shrink-0 flex-col gap-2 bg-surface px-4 pt-4 pb-2 md:px-5 md:pt-5",
        PHONE_BLEED
      )}
    >
      <InboxToolbar
        state={state}
        counts={toolbarCounts}
        countsPending={toolbarCountsPending}
        locations={locationsQuery.data ?? []}
        showLocationFilter={showLocationFilter}
        actions={actions}
        sync={sync}
        titleIsHeading={toolbarTitleIsHeading}
        onFilterChange={onFilterChange}
        onQueueChange={onQueueChange}
        onClear={onClearFilters}
        resultLabel={countLabel}
      />
      <ActiveFilterChips
        state={state}
        locations={locationsQuery.data ?? []}
        clientChip={clientChip}
        onChange={onFilterChange}
        onClear={onClearFilters}
        onEmpty={focusFilters}
      />
    </div>
  )

  // The load-more button had focus when the last page was asked for: the end
  // of the list takes it when the button goes.
  const loadMoreRef = useRef<HTMLButtonElement>(null)
  const listEndRef = useRef<HTMLParagraphElement>(null)
  const loadMoreHadFocus = useRef(false)
  const pageCount = reviewsQuery.data?.pages.length ?? 0
  useEffect(() => {
    if (!hasNextPage && loadMoreHadFocus.current) {
      loadMoreHadFocus.current = false
      listEndRef.current?.focus({ preventScroll: true })
    }
  }, [hasNextPage])

  // Reference `.queue`: a card with a quiet head (select all, how many,
  // when the list was fetched), the rows, and the bulk bar pinned under
  // them when something is ticked. Where the workspace is locked to the
  // window the rows scroll inside the card; everywhere else the page does.
  // On a phone the card runs edge to edge, as the whole screen is the list.
  const listPane = (
    <section
      aria-label="Reviews"
      data-slot="inbox-list-pane"
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col bg-surface lg:[@media(min-height:620px)]:overflow-hidden",
        PHONE_BLEED
      )}
    >
      <ListHeader
        canBatch={canBatch}
        reviews={reviews}
        loaded={loaded}
        countLabel={countLabel}
        countAnnouncement={countAnnouncement.text}
        refreshed={refreshed}
        clientId={state.clientId}
      />
      {/* A refresh that failed leaves the rows as they were, and says so. */}
      {isRefetchError && reviews.length > 0 ? (
        <div
          data-slot="inbox-refresh-failed"
          className="flex shrink-0 items-center justify-between gap-2 border-b border-line-subtle py-1 pr-1 pl-(--np-page-pad-x)"
        >
          <span role="status" className="text-caption text-ink-muted">
            {refreshed
              ? `Couldn’t refresh this list. Showing it as of ${refreshed}.`
              : "Couldn’t refresh this list."}
          </span>
          <Button variant="ghost" onClick={() => void reviewsQuery.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {renderList()}
      {/* The list has no known total, so this is not the shared LoadMore
          ("Showing 50 of 120"): it says only that more follow. The rows
          also load on their own as the end scrolls into view. The button
          stays focusable while the page loads (aria-disabled, not disabled),
          and when the last page lands the end of the list takes its focus,
          as LoadMore does. */}
      {loaded && reviews.length > 0 && hasNextPage ? (
        <div
          data-slot="inbox-load-more"
          className="flex shrink-0 items-center justify-between gap-2 border-t border-line-subtle py-1 pr-1 pl-(--np-page-pad-x)"
        >
          {isFetchNextPageError && !isFetchingNextPage ? (
            <span role="alert" className="text-caption text-danger-ink">
              We couldn’t load more reviews.
            </span>
          ) : (
            <span className="text-caption text-ink-muted">
              More reviews below
            </span>
          )}
          <Button
            ref={loadMoreRef}
            variant="ghost"
            aria-disabled={isFetchingNextPage || undefined}
            onClick={() => {
              loadMoreHadFocus.current =
                document.activeElement === loadMoreRef.current
              loadMore()
            }}
          >
            {isFetchingNextPage
              ? "Loading…"
              : isFetchNextPageError
                ? "Try again"
                : "Load more reviews"}
          </Button>
        </div>
      ) : loaded && reviews.length > 0 && pageCount > 1 ? (
        <p
          ref={listEndRef}
          role="status"
          tabIndex={-1}
          data-slot="inbox-list-end"
          className="shrink-0 border-t border-line-subtle py-2.5 pl-(--np-page-pad-x) text-caption text-ink-muted outline-none"
        >
          {narrowsList(state)
            ? "That’s every review that matches."
            : visibleQueue(state.queue)
              ? `That’s every review in ${REVIEW_QUEUE_LABELS[state.queue]}.`
              : "That’s every review."}
        </p>
      ) : null}
      {canBatch ? (
        <LazyBulkActionBar
          rows={reviews}
          bulkEngine={bulkEngine}
          scopeKey={state.clientId ?? ""}
          // Select all ticks the loaded rows only; the bar says so while
          // more follow.
          hasMore={Boolean(hasNextPage)}
        />
      ) : null}
      <InboxBottomToolbarSpacer />
    </section>
  )

  const selectedIndex = state.selected
    ? reviews.findIndex((review) => review.id === state.selected)
    : -1
  const selectedRow = selectedIndex >= 0 ? reviews[selectedIndex] : undefined
  // Where the open review sits in what is loaded, for its steps. A review
  // opened from a link may not be in the list at all: then there is no
  // position to give, and no steps.
  const hasMore = Boolean(reviewsQuery.hasNextPage)
  const stepFromHead = (direction: AdjacentDirection) => {
    headStepRef.current = direction
    void onAdjacentReview(direction).then((row) => {
      if (!row) headStepRef.current = null
    })
  }
  const nav =
    selectedIndex >= 0
      ? {
          position: selectedIndex + 1,
          total: reviews.length,
          more: hasMore,
          onPrevious:
            selectedIndex > 0 ? () => stepFromHead("prev") : undefined,
          onNext:
            selectedIndex < reviews.length - 1 || hasMore
              ? () => stepFromHead("next")
              : undefined,
        }
      : undefined
  // Back also works because opening from the list pushed (spec §6). The way
  // back of a pushed review is the shell's app bar ("‹ Inbox", the
  // PageChrome below), so the review draws none of its own.

  // The detail is mounted in exactly one place, so the composer's dirty guard
  // is registered once. ReviewDetail draws its own boundary around the
  // review; this outer one catches a failure outside it.
  const detail = state.selected ? (
    <DetailErrorBoundary
      key={state.selected}
      onBack={onBackToList}
      onLoadFailure={reloadReviewPane}
    >
      <LazyReviewPane
        key={state.selected}
        reviewId={state.selected}
        heading={
          selectedRow
            ? selectedRow.reviewer.isAnonymous
              ? "Anonymous"
              : (selectedRow.reviewer.displayName ?? "Anonymous")
            : undefined
        }
        // Client first in an agency, as the row says it; a business has no
        // client to name.
        clientName={
          business ? null : (selectedRow?.location.clientName ?? null)
        }
        focusHeading={advance?.reviewId === state.selected}
        onBack={onBackToList}
        nav={nav}
        titleIsHeading={headTitleIsHeading}
        // A viewer has nothing to press, so no publish bar is drawn for
        // them — not even its loading outline, which would dock and hide
        // the tab bar for a moment (inbox-08).
        withActions={canBatch}
      />
    </DetailErrorBoundary>
  ) : null

  // Reference `.detail`: a card whose head and publish bar stay put while
  // the thread scrolls — where the workspace is locked to the window (lg and
  // tall enough). Below that it is an ordinary block in the page and the
  // publish bar is docked at the foot of the screen instead, so it is never
  // out of reach and never clipped. From lg it is always there, saying so
  // when nothing is open.
  const inspector = (
    <section
      aria-label="Selected review"
      data-slot="inbox-inspector"
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-surface group-data-[view=list]/inbox:max-lg:hidden lg:[@media(min-height:620px)]:overflow-hidden",
        PHONE_BLEED
      )}
    >
      {/* Only what is true beside the list: while it loads, the route
          outline's words (loading.tsx), so nothing changes when the list
          takes over from it; beside an empty or failed list, that nothing
          is open; and beside rows, to pick one. */}
      {detail ??
        (listStatus === "pending" || switchingFromEmpty ? (
          <p className="my-auto flex items-center justify-center gap-2 text-ui text-ink-muted">
            <Spinner decorative size="sm" />
            Loading reviews
          </p>
        ) : reviews.length === 0 ? (
          <Statement
            title="No review open"
            description="Reviews in this list open here."
            className="my-auto"
          />
        ) : (
          <Statement
            title="No review selected"
            description="Pick a review from the list."
            className="my-auto"
          />
        ))}
    </section>
  )

  // Below lg the list and the detail take turns (reference `data-view`):
  // opening a review hides the list and the controls above it, and Back
  // brings them back where they were. The view comes from the URL, so the
  // server renders the right one; CSS does the hiding.
  const detailView = Boolean(state.selected)

  // Where the list was when a review was opened, so returning to it lands on
  // the same rows rather than at the top. Both scrollers are kept: the page
  // (phones, short windows) and the list's own (a locked workspace). Only
  // below lg, where the review replaces the list.
  const wasDetailView = useRef(detailView)
  useLayoutEffect(() => {
    const opened = detailView && !wasDetailView.current
    const closed = !detailView && wasDetailView.current
    wasDetailView.current = detailView
    // However the review closed (Back, the OS gesture, a queue change), a
    // later open decides afresh whether it pushed.
    if (closed) openedByPushRef.current = false
    if (!opened && !closed) return
    const scroller = scrollParent(rootRef.current)
    if (opened) {
      // Opening: start the review at its head.
      if (!isSplitView() && scroller) scroller.scrollTop = 0
    } else if (savedScroll.current) {
      const saved = savedScroll.current
      savedScroll.current = null
      if (scroller) scroller.scrollTop = saved.page
      if (listScrollRef.current) listScrollRef.current.scrollTop = saved.list
    }
  }, [detailView])
  useEffect(() => {
    onBeforeOpenRef.current = () => {
      if (state.selected || isSplitView()) return
      savedScroll.current = {
        page: scrollParent(rootRef.current)?.scrollTop ?? 0,
        list: listScrollRef.current?.scrollTop ?? 0,
      }
    }
  }, [state.selected])

  // The list this review was opened from: the same inbox state, closed.
  const listHref = `/inbox?${serializeInboxState({
    ...state,
    selected: undefined,
  }).toString()}`

  // Kept in the tree while a review is open below lg — the controls and the
  // list — so the selected row keeps its aria-current and the list its
  // place, but `display: none` hides them from everyone.
  const hiddenInDetail = "group-data-[view=detail]/inbox:max-lg:hidden"

  return (
    <div
      ref={rootRef}
      data-slot="inbox"
      data-view={detailView ? "detail" : "list"}
      // `min-h-0` only where the workspace is locked to the window: there
      // the panes share the height and scroll inside. Everywhere else the
      // inbox is as tall as its content and the page scrolls.
      // One white surface, no gaps: the controls, a single hairline, then
      // the list and the review side by side (or in turn on a phone).
      className="group/inbox relative flex flex-1 flex-col bg-surface lg:[@media(min-height:620px)]:min-h-0"
    >
      <InboxHotkeys handlers={hotkeyHandlers} />
      {/* A review pushed over the list (below lg) is a level down from the
          Inbox, so the shell's app bar and tablet toolbar lead with the
          labelled way back, "‹ Inbox", as every deep page's does. It is a
          link to the list it came from, but a plain activation runs the
          same back as the review head's: pop the pushed entry, ask the
          leave guard about an unsaved reply, and refocus the row. Not where
          the list is beside the review (lg), and not before the client
          knows its width. */}
      {detailView && splitView === false ? (
        <PageChrome
          back={{ href: listHref, label: "Inbox" }}
          onBack={onBackToList}
        />
      ) : null}
      <p role="status" className="sr-only" data-slot="inbox-advance-status">
        {advance?.message}
      </p>

      <div
        data-slot="inbox-split"
        // Reference `.work`: the queue beside the thread from lg, a third of
        // the room between 300px and 420px (shared with loading.tsx).
        style={INBOX_SPLIT_STYLE}
        className="grid flex-1 grid-cols-1 border-t border-line lg:grid-cols-[var(--inbox-list-w)_minmax(0,1fr)] lg:[@media(min-height:620px)]:min-h-0 lg:[@media(min-height:620px)]:grid-rows-[minmax(0,1fr)]"
      >
        <div
          data-slot="inbox-list-column"
          className={cn(
            "flex min-w-0 flex-col lg:border-r lg:border-line lg:[@media(min-height:620px)]:min-h-0",
            hiddenInDetail
          )}
        >
          <div
            data-slot="inbox-controls"
            className={cn("flex shrink-0 flex-col", hiddenInDetail)}
          >
            {workspaceControls}
          </div>
          {listPane}
        </div>
        {inspector}
      </div>
    </div>
  )
}

// `showLocationFilter` is resolved on the server (app/(dashboard)/inbox/page.tsx)
// rather than from the fetched location list, because the list is empty on the
// first paint: a client-side length check would either flash the control in
// for multi-location orgs or — worse — flash it out from under a single-location
// user who was already reaching for it. Defaults to true so every existing
// caller and test keeps a visible filter; a redundant control is a much better
// failure mode than a silently missing one.
/**
 * Focuses the way back that is on screen: the shell's "‹ Inbox" link
 * (`[data-slot="back-control"]`, the visible one: the tablet toolbar draws
 * its own copy). The app bar takes the page's back from PageChrome a render
 * after the review opens, so the link is looked for over a few frames.
 */
function focusBackControl(frames = 10) {
  const target = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="back-control"]'),
  ].find((element) => element.checkVisibility?.() ?? true)
  if (target) {
    target.focus({ preventScroll: true })
    return
  }
  if (frames > 0) {
    requestAnimationFrame(() => focusBackControl(frames - 1))
  }
}

function InboxView({
  showLocationFilter = true,
  actions,
  sync,
  bulkEngine = false,
}: {
  showLocationFilter?: boolean
  /** The route's page actions (shortcuts), drawn in the toolbar. */
  actions?: ReactNode
  /**
   * The sync control: in the page header from `md`, in the phone's bottom
   * toolbar below it (R10).
   */
  sync?: ReactNode
  /**
   * The organisation has bulk changes on: bulk approve and template replies
   * are sent by the job runner as a batch (lib/server/bulk-reviews.ts).
   */
  bulkEngine?: boolean
}) {
  return (
    <DirtyGuardProvider>
      <SelectionProvider>
        <InboxViewInner
          showLocationFilter={showLocationFilter}
          actions={actions}
          sync={sync}
          bulkEngine={bulkEngine}
        />
      </SelectionProvider>
    </DirtyGuardProvider>
  )
}

export { InboxView }
