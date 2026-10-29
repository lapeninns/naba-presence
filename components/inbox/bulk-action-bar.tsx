"use client"

import {
  Check,
  CircleSlash,
  ListChecks,
  MessageSquareText,
  Ellipsis,
  UserPlus,
  X,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import * as React from "react"

import {
  AssigneeItems,
  assignReviews,
  markNoReplyNeeded,
  useAssignees,
  useReviewTriage,
} from "@/components/inbox/review-triage"
import {
  LazyDialogBoundary,
  whileLoading,
} from "@/components/inbox/lazy-dialog-boundary"
import { useSelection } from "@/components/inbox/selection-context"
import { importTemplateReplyDialog } from "@/components/inbox/template-dialog-loader"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMenuSheet } from "@/components/ui/menu-surface"
import {
  SelectionBar,
  SelectionBarLinkTile,
  SelectionBarTile,
} from "@/components/ui/selection-bar"
import type {
  BulkReviewActionInput,
  BulkReviewResult,
  ReviewRow,
} from "@/lib/contracts/reviews"
import { describeErrorCode } from "@/lib/errors/action-errors"
import {
  BULK_ROW_STATUS_LABEL,
  summariseBulkOutcome,
} from "@/lib/inbox/bulk-outcome"
import { isRatingOnly } from "@/lib/inbox/template-batch"
import { sessionScopeToken } from "@/lib/queries/session-scope"
import { useSession } from "@/lib/queries/use-session"

// The template batch is a 580-line dialog used on rating-only selections, so
// it is not part of the Inbox's first load. It is fetched as soon as a
// selection that offers it exists (the click that follows then finds it
// loaded) and mounted only once asked for. It is closed on the server.
type TemplateReplyDialogComponent =
  typeof import("@/components/inbox/template-reply-dialog").TemplateReplyDialog
const loadTemplateReplyDialog = () =>
  importTemplateReplyDialog().then((module) => {
    // Once it is here the component is used as it is, with no Suspense
    // beat between the click and the dialog; and "has it arrived" is what
    // tells a pending open (cancellable) from an open dialog (not).
    lazyTemplate.Loaded = module.TemplateReplyDialog
    return module.TemplateReplyDialog
  })
// A preload that fails is not an error yet: the dialog's own load, when it
// is asked for, retries and reports.
const preloadTemplateReplyDialog = () =>
  void loadTemplateReplyDialog().catch(() => {})

/** What the loading shell needs from the bar that asked for the batch. */
const TemplateShellContext = React.createContext<{
  close: () => void
  finalFocus: React.RefObject<HTMLElement | null>
} | null>(null)

/**
 * The modal that stands in while the template dialog's code is on the way.
 * The batch is already a modal question, so it is one from the click: focus
 * is held, and nothing behind it (the selection, the bulk actions, the
 * client switcher) can be reached until it is answered or cancelled. It is
 * the same size and wording as the real dialog, which replaces it.
 */
function TemplateLoadingShell() {
  const shell = React.useContext(TemplateShellContext)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) shell?.close()
      }}
    >
      <DialogContent size="wide" finalFocus={shell?.finalFocus}>
        <DialogHeader>
          <DialogTitle>Reply with the rating template</DialogTitle>
          <DialogDescription>
            For reviews with stars and no words. Each reply is checked before it
            can be published, exactly as one you write yourself.
          </DialogDescription>
        </DialogHeader>
        <p role="status" className="text-ui text-ink-secondary">
          Loading…
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={() => shell?.close()}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// A failed load is cached by React for the life of the component, so after a
// failure (see LazyDialogBoundary) a fresh one replaces it for the next open.
const createTemplateReplyDialog = () =>
  dynamic(loadTemplateReplyDialog, {
    ssr: false,
    loading: whileLoading(<TemplateLoadingShell />),
  })
const lazyTemplate: {
  Dialog: ReturnType<typeof createTemplateReplyDialog>
  /** The real component, once its code has arrived. */
  Loaded: TemplateReplyDialogComponent | null
} = { Dialog: createTemplateReplyDialog(), Loaded: null }

/**
 * The real dialog if its code is already here, the lazy one (whose fallback is
 * the shell) if not. Chosen once, when the batch is opened: a component's type
 * must not change while it is open, or a re-render after the code arrives
 * (a refetch, a window refocus) would unmount the dialog and mount a new one,
 * losing its outcomes and its retry intent. The shell-to-dialog swap happens
 * inside the one lazy component instead.
 */
function TemplateDialogSlot(
  props: React.ComponentProps<TemplateReplyDialogComponent>
) {
  const [Dialog] = React.useState(
    () => lazyTemplate.Loaded ?? lazyTemplate.Dialog
  )
  return <Dialog {...props} />
}

/**
 * Where focus goes when the open that held it is cancelled by a change of
 * scope: the opener is gone with the rows, so the list header's control that
 * starts a selection (the select-all box on a desk, "Select" on a phone), or
 * failing that the list itself. Only if focus has been left on the page.
 */
function focusSurvivor(leaving: HTMLElement | null) {
  const settle = () => {
    // Only from the page, or from the opener the dialog handed focus back to
    // (it goes with the old rows); never from where the operator has moved.
    const active = document.activeElement
    if (active && active !== document.body && active !== leaving) return
    const candidates = document.querySelectorAll<HTMLElement>(
      '[data-slot="inbox-list-header"] [role="checkbox"], [data-slot="inbox-list-header"] button'
    )
    for (const candidate of candidates) {
      // Not the one a breakpoint hides (jsdom has no layout: it answers true).
      if (
        candidate.hasAttribute("disabled") ||
        candidate.checkVisibility?.() === false
      )
        continue
      candidate.focus()
      if (document.activeElement === candidate) return
    }
  }
  settle()
  // The dialog's own focus return runs as it unmounts; look again after it.
  requestAnimationFrame(() => requestAnimationFrame(settle))
}

type BulkAction = "approve" | "assign" | "mark_reviewed"

/** A request on its way: what it does, and to how many rows. */
type PendingRun = { action: BulkAction; count: number; unassign: boolean }

const reviews = (count: number) =>
  `${count} ${count === 1 ? "review" : "reviews"}`
const replies = (count: number) =>
  `${count} ${count === 1 ? "reply" : "replies"}`

/**
 * What the bar says while a request runs. A direct approve publishes one
 * row after another inside the route's two-minute budget, so it says that
 * it can take a while; the bulk engine only queues, which is quick.
 */
function pendingStatus(run: PendingRun, bulkEngine: boolean) {
  switch (run.action) {
    case "approve":
      if (bulkEngine) return `Approving ${replies(run.count)}…`
      return run.count === 1
        ? "Approving and publishing 1 reply to Google…"
        : `Approving and publishing ${replies(run.count)} to Google, one after another. This can take a minute or two.`
    case "assign":
      return `${run.unassign ? "Unassigning" : "Assigning"} ${reviews(run.count)}…`
    case "mark_reviewed":
      return `Marking ${reviews(run.count)} as no reply needed…`
  }
}

/**
 * Why Approve leaves a row out, by the first of its checks the row fails:
 * the same checks, in the same order, as `approvable` in the bar.
 */
type SkipReason = "not_waiting" | "cannot_publish" | "own_request" | "no_draft"

const SKIP_REASON_COPY: Record<SkipReason, (count: number) => string> = {
  not_waiting: (count) =>
    `${count} ${count === 1 ? "isn’t" : "aren’t"} waiting for approval`,
  cannot_publish: (count) =>
    count === 1
      ? "1 is at a venue you can’t publish for"
      : `${count} are at venues you can’t publish for`,
  own_request: (count) =>
    count === 1
      ? "1 is a reply you asked for or drafted, so another approver must approve it"
      : `${count} are replies you asked for or drafted, so another approver must approve them`,
  no_draft: (count) =>
    `${count} ${count === 1 ? "has" : "have"} no draft to approve`,
}

/**
 * Actions over a selection: the shared SelectionBar, docked to the bottom
 * of a phone while anything is ticked, where it takes the tab bar's slot
 * (D4), and sticky at the foot of the list from md. It holds only actions:
 * "N selected" and the one "Cancel" are in the list header (list-header.tsx),
 * so there is a single way out. Its tiles are an overflow (⋯) for the
 * rarer actions and one primary — 64px tiles, icon over label, on a phone,
 * inline buttons from md. The primary is the charcoal tile when it leads to
 * Google (approve and publish, the template batch), the plain tile when it
 * is local (no reply needed).
 *
 * Reports eligibility BEFORE acting — "3 of 5 can be approved" — because the
 * alternative is an operator pressing Approve on five rows and being told
 * afterwards that two were not theirs to approve. Results come back per row,
 * so a stale row never discards the rest of the batch.
 */
function BulkActionBar({
  rows,
  bulkEngine = false,
  scopeKey = "",
  hasMore = false,
}: {
  rows: ReviewRow[]
  /** Approve and template replies run as a bulk batch (the job runner sends them). */
  bulkEngine?: boolean
  /** The client the list is scoped to; a change of it is a change of scope. */
  scopeKey?: string
  /** More reviews follow the loaded `rows` (a selection covers only these). */
  hasMore?: boolean
}) {
  const { selected, replace, setSelectMode } = useSelection()
  // What is ticked when a run comes back: the checkboxes stay live while it
  // runs, so ticks added or removed meanwhile (or a selection cancelled) are
  // the person's answer, and the result does not undo them.
  const selectedRef = React.useRef(selected)
  React.useEffect(() => {
    selectedRef.current = selected
  }, [selected])
  const bulk = useReviewTriage()
  // On a phone the overflow is a bottom action sheet, where a flyout
  // submenu has nowhere to fly to; the assignees are listed in the sheet.
  const menuIsSheet = useMenuSheet()
  // The per-row result of the last run, for the rows it left ticked. It
  // belongs to that selection: a new run, or an emptied selection, clears it.
  const [outcome, setOutcome] = React.useState<BulkReviewResult | null>(null)
  // The request on its way, for the words the bar shows while it runs.
  const [pending, setPending] = React.useState<PendingRun | null>(null)
  // A batch the bulk engine took in full: nothing is left ticked, so the bar
  // stays as a short receipt with the link to follow it (until dismissed, a
  // new selection, or a change of scope).
  const [receipt, setReceipt] = React.useState<{
    operationId: string
    queued: number
    scope: string
  } | null>(null)
  const [confirmApprove, setConfirmApprove] = React.useState(false)
  // The selection as it was when the template batch opened. Replies that
  // publish leave the list (and so the selection's visible rows) while the
  // dialog is still showing its summary, so it works from this copy and is
  // rendered even once nothing selected is on screen.
  const [templateRows, setTemplateRows] = React.useState<ReviewRow[] | null>(
    null
  )
  // The scope it was opened under, and a count of opens dropped by a change
  // of scope (each is a reason to find focus a new home).
  const [templateScope, setTemplateScope] = React.useState("")
  const [templateDropped, setTemplateDropped] = React.useState(0)
  // Focus returns to the control that asked for the batch (the primary tile,
  // or the ⋯ trigger when it came from the menu), never to the page.
  const moreRef = React.useRef<HTMLButtonElement>(null)
  const primaryRef = React.useRef<HTMLButtonElement>(null)
  const templateOpenerRef = React.useRef<HTMLElement | null>(null)

  const chosen = rows.filter((row) => selected.has(row.id))
  // The member list is only needed to assign, so it is fetched when a
  // selection exists rather than on every visit to the inbox.
  const assignees = useAssignees(
    chosen.map((row) => row.location.id),
    { enabled: chosen.length > 0 }
  )

  const offersTemplate = chosen.some(isRatingOnly)
  React.useEffect(() => {
    if (offersTemplate) preloadTemplateReplyDialog()
  }, [offersTemplate])

  // What the list is scoped to (the client, and the session's own scope): the
  // template batch belongs to the one it was opened under. Read when it opens.
  const session = useSession()
  const scope = `${scopeKey}\n${sessionScopeToken(session.data?.session)}`
  const openTemplate = (from: "primary" | "more") => {
    templateOpenerRef.current =
      from === "primary" ? primaryRef.current : moreRef.current
    setTemplateScope(scope)
    setTemplateRows(chosen)
  }
  const closeTemplate = () => setTemplateRows(null)

  // An open that is still waiting for the dialog's code is cancelled with the
  // selection it was made on (cleared, or a scope that moved the rows), so a
  // batch the operator walked away from cannot appear later, over something
  // else. Once the dialog has arrived it is a different matter: it keeps its
  // own copy of the rows on purpose, to show its summary after replies have
  // left the list.
  //
  // A change of scope cancels it whatever has arrived: it is judged on the
  // scope the batch was opened under, not on whether the new client's rows
  // have come in yet (the list keeps the old rows until they do) or whether
  // the code is here, so another client's reviews are never left open.
  const chosenIds = new Set(chosen.map((row) => row.id))
  const templateStale =
    templateRows !== null &&
    (templateScope !== scope ||
      (!lazyTemplate.Loaded &&
        templateRows.some((row) => !chosenIds.has(row.id))))
  // Nothing is drawn for it from this render, and the open is dropped; focus
  // goes somewhere that is still there (its opener may be gone with the rows).
  if (templateStale) {
    setTemplateRows(null)
    setTemplateDropped((count) => count + 1)
  }
  React.useEffect(() => {
    if (templateDropped === 0) return
    const opener = templateOpenerRef.current
    templateOpenerRef.current = null
    focusSurvivor(opener)
  }, [templateDropped])

  const templateDialog =
    templateRows && !templateStale ? (
      <TemplateShellContext.Provider
        // Keyed, so the dialog is the same one whether the bar is drawn
        // beside it or (nothing selected any more) it stands alone.
        key="template-batch"
        value={{ close: closeTemplate, finalFocus: templateOpenerRef }}
      >
        <LazyDialogBoundary
          what="the template reply"
          onFail={() => {
            setTemplateRows(null)
            lazyTemplate.Loaded = null
            lazyTemplate.Dialog = createTemplateReplyDialog()
          }}
        >
          <TemplateDialogSlot
            open
            rows={templateRows}
            bulkEngine={bulkEngine}
            finalFocus={templateOpenerRef}
            onOpenChange={(open) => {
              if (!open) closeTemplate()
            }}
            onFinished={(sentIds) => {
              const sent = new Set(sentIds)
              replace([...selectedRef.current].filter((id) => !sent.has(id)))
            }}
          />
        </LazyDialogBoundary>
      </TemplateShellContext.Provider>
    ) : null

  // A result is about the rows it was reported on: once none are ticked
  // (Cancel, or they left the list), the next selection starts clean. A
  // receipt goes with a new selection or a change of scope.
  if (outcome && chosen.length === 0) setOutcome(null)
  if (receipt && (chosen.length > 0 || receipt.scope !== scope))
    setReceipt(null)

  const pendingWords = pending ? pendingStatus(pending, bulkEngine) : null
  // Always on the page, so the words are announced as they arrive (a live
  // region that mounts with its words already in it may not be).
  const liveStatus = (
    <p role="status" data-slot="bulk-action-status" className="sr-only">
      {pendingWords ?? ""}
    </p>
  )

  if (chosen.length === 0) {
    return (
      <>
        {liveStatus}
        {receipt ? (
          // Inline at the list's foot rather than docked on a phone: it can
          // stay until dismissed, and a docked bar would keep the tab bar
          // stepped aside all that while. The toast has already said it.
          <SelectionBar
            data-slot="bulk-batch-receipt"
            label="Batch started"
            dock={false}
            className="shrink-0"
            notes={
              <p className="text-ink">
                {receipt.queued}{" "}
                {receipt.queued === 1 ? "reply is" : "replies are"} queued: each
                is approved and sent to Google in the background. You can close
                this tab.
              </p>
            }
          >
            <SelectionBarTile
              icon={<X aria-hidden />}
              label="Dismiss"
              onClick={() => setReceipt(null)}
            />
            <SelectionBarLinkTile
              href={`/listings/bulk/${receipt.operationId}`}
              icon={<ListChecks aria-hidden />}
              label="Follow batch"
            />
          </SelectionBar>
        ) : null}
        {templateDialog}
      </>
    )
  }

  // Approval is bound to the draft the list showed: the parked one (what the
  // server approves and single approve names), not the newest. A row with no
  // draft has nothing the operator could have read, so it cannot be approved
  // here. `pendingDraftId` is absent from older servers; fall back to the
  // newest draft as before.
  const approvalDraftId = (row: (typeof chosen)[number]) =>
    row.pendingDraftId ?? row.draftId
  // Why a row cannot be approved here, or null when it can. The order is
  // the order the reasons are worth hearing in.
  const skipReason = (row: (typeof chosen)[number]): SkipReason | null => {
    if (row.workflowStatus !== "awaiting_approval") return "not_waiting"
    if (!row.capabilities.canPublish) return "cannot_publish"
    // Under two-person approval the approval route refuses a reply this
    // person asked for or drafted (`second_approver_required`). An older
    // server sends no `canApprove`; it is then approvable as before.
    if (row.canApprove === false) return "own_request"
    if (approvalDraftId(row) === null) return "no_draft"
    return null
  }
  const approvable = chosen.filter((row) => skipReason(row) === null)

  const run = async (action: BulkAction, assigneeId?: string | null) => {
    // Never send an empty batch (a stale tick, a list that moved on).
    if (chosen.length === 0) return
    const ids = chosen.map((row) => row.id)
    const input: BulkReviewActionInput | null =
      action === "approve"
        ? approvable.length === 0
          ? null
          : {
              action,
              // Exactly what this list showed: the server refuses a row whose
              // draft or review has moved since (approval_draft_changed,
              // review_changed) instead of approving it unread.
              approvals: approvable.map((row) => ({
                reviewId: row.id,
                draftId: approvalDraftId(row)!,
                reviewUpdateTime: row.updateTime,
              })),
            }
        : action === "assign"
          ? assignReviews(ids, assigneeId ?? null)
          : markNoReplyNeeded(ids)
    if (!input) return
    // The last run's notes are not about this one, whatever it brings back
    // (a batch refused outright brings back nothing).
    setOutcome(null)
    setReceipt(null)
    setPending({
      action,
      count: action === "approve" ? approvable.length : ids.length,
      unassign: action === "assign" && !assigneeId,
    })
    let result: BulkReviewResult | null = null
    try {
      result = await bulk.run(input)
    } finally {
      setPending(null)
    }
    if (!result) return
    if (summariseBulkOutcome(result).allOk) {
      // Every row done: the batch is over, so select mode ends with it
      // (which also clears). A batch the engine queued keeps its link.
      if (result.operationId) {
        setReceipt({
          operationId: result.operationId,
          queued: result.results.filter((row) => row.status === "queued")
            .length,
          scope,
        })
      }
      setSelectMode(false)
      return
    }
    setOutcome(result)
    // Only the rows that did not take effect stay ticked, to retry or look
    // at: those the server did, or queued, leave the selection (as after a
    // template batch), so the bar's notes are about what is left. That
    // includes the rows Approve skipped before asking (never sent, so not in
    // the results). The selection as it is now is trimmed, not the one the
    // run started with: a selection cancelled while the request ran stays
    // cancelled, and rows ticked or unticked meanwhile stay as they are. The
    // toast still says what happened.
    const current = selectedRef.current
    if (current.size === 0) return
    const settled = new Set(
      result.results
        .filter((row) => row.status === "ok" || row.status === "queued")
        .map((row) => row.reviewId)
    )
    setSelectMode(true)
    replace([...current].filter((id) => !settled.has(id)))
  }

  // Per-row results come back as ids; the operator knows reviews by who
  // wrote them and where.
  const describeRow = (reviewId: string) => {
    const match = rows.find((row) => row.id === reviewId)
    if (!match) return "A review no longer in this list"
    const name = match.reviewer.isAnonymous
      ? "Anonymous"
      : (match.reviewer.displayName ?? "Anonymous")
    return `${name} · ${match.location.name}`
  }

  const partial = approvable.length < chosen.length && approvable.length > 0
  const failures = outcome
    ? outcome.results.filter(
        (row) => row.status !== "ok" && row.status !== "queued"
      )
    : []
  // One primary, whatever is most likely next: approving what is waiting,
  // else answering the rating-only reviews, else clearing them as needing
  // nothing. Everything else lives in the overflow menu.
  const primary: "approve" | "template" | "mark_reviewed" =
    approvable.length > 0
      ? "approve"
      : offersTemplate
        ? "template"
        : "mark_reviewed"
  const assigneeItems = (
    <AssigneeItems
      {...assignees}
      onAssign={(assigneeId) => void run("assign", assigneeId)}
    />
  )

  const primaryTile =
    primary === "approve" ? (
      <SelectionBarTile
        tone="charcoal"
        icon={<Check aria-hidden />}
        label={
          pending?.action === "approve"
            ? "Approving…"
            : approvable.length === chosen.length
              ? `Approve ${approvable.length}`
              : `Approve ${approvable.length} of ${chosen.length}`
        }
        disabled={bulk.isPending}
        onClick={() => setConfirmApprove(true)}
      />
    ) : primary === "template" ? (
      <SelectionBarTile
        ref={primaryRef}
        tone="charcoal"
        icon={<MessageSquareText aria-hidden />}
        label="Reply with template"
        disabled={bulk.isPending}
        onClick={() => openTemplate("primary")}
      />
    ) : (
      <SelectionBarTile
        icon={<CircleSlash aria-hidden />}
        label={
          pending?.action === "mark_reviewed" ? "Marking…" : "No reply needed"
        }
        disabled={bulk.isPending}
        onClick={() => void run("mark_reviewed")}
      />
    )

  // Each reason Approve leaves rows out, counted: "…skip them: 1 isn't
  // waiting for approval; 1 has no draft to approve."
  const skipCounts = new Map<SkipReason, number>()
  for (const row of chosen) {
    const reason = skipReason(row)
    if (reason) skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1)
  }
  const skipReasons = [...skipCounts]
    .map(([reason, count]) => SKIP_REASON_COPY[reason](count))
    .join("; ")
  // Select all ticks the loaded rows only; more may follow them.
  const onlyLoaded = hasMore && chosen.length === rows.length

  // Results and notes sit above the header and the tiles, so the tiles
  // never move under a thumb.
  const notes =
    pendingWords ||
    partial ||
    onlyLoaded ||
    outcome?.operationId ||
    failures.length > 0 ? (
      <div className="flex flex-col gap-1">
        {/* Spoken by the status region above; shown here too, because the
            tiles alone only go grey. */}
        {pendingWords ? (
          <p className="text-ink" aria-hidden>
            {pendingWords}
          </p>
        ) : null}

        {partial ? (
          <p>
            {chosen.length - approvable.length} of these are not ready for your
            approval, so Approve will skip them: {skipReasons}.
          </p>
        ) : null}

        {onlyLoaded ? (
          <p>
            Only the {reviews(chosen.length)} loaded so far{" "}
            {chosen.length === 1 ? "is" : "are"} selected. Load more to add the
            rest.
          </p>
        ) : null}

        {outcome?.operationId ? (
          <p className="text-ink" aria-live="polite">
            The approved replies are sent in the background.{" "}
            <Link
              href={`/listings/bulk/${outcome.operationId}`}
              className="font-semibold underline underline-offset-2"
            >
              Follow this batch
            </Link>
          </p>
        ) : null}

        {failures.length > 0 ? (
          <ul
            className="flex max-h-32 flex-col gap-1 overflow-y-auto"
            aria-live="polite"
          >
            {failures.map((row) => (
              <li
                key={row.reviewId}
                className="flex flex-wrap items-baseline gap-x-2 text-ink"
              >
                <span className="font-semibold">
                  {BULK_ROW_STATUS_LABEL[row.status]}
                </span>
                <span className="min-w-0 truncate">
                  {describeRow(row.reviewId)}
                </span>
                <span className="text-ink-muted">
                  {row.code ? describeErrorCode(row.code) : "No reason given."}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ) : undefined

  return (
    <>
      {liveStatus}
      {/* The one bar that owns the bottom edge while rows are ticked: on a
          phone it is fixed to the bottom of the screen (the chrome contract
          in globals.css steps the tab bar aside for it, and it rides the
          keyboard); from md it sticks to the foot of the list. Only on the
          page while something is ticked (the early return above). The count
          and the Cancel are the list header's. */}
      <SelectionBar
        data-slot="bulk-action-bar"
        label="Selected reviews"
        notes={notes}
        className="shrink-0"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            ref={moreRef}
            disabled={bulk.isPending}
            render={
              <SelectionBarTile
                icon={<Ellipsis aria-hidden />}
                // The tile's caption is "More"; the name "More actions"
                // begins with the words on screen (2.5.3).
                label="More"
                aria-label="More actions"
              />
            }
          />
          <DropdownMenuContent
            side="top"
            align="end"
            title={`${chosen.length} selected`}
          >
            {menuIsSheet ? null : (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UserPlus aria-hidden />
                  Assign…
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>{assigneeItems}</DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {/* Triage, not a reply: it clears the reviews from Needs reply
              and sends nothing to Google. "Mark reviewed" read as though it
              might do either. Done at once, with Undo in its toast. */}
            {primary !== "mark_reviewed" ? (
              <DropdownMenuItem onClick={() => void run("mark_reviewed")}>
                <CircleSlash aria-hidden />
                No reply needed
              </DropdownMenuItem>
            ) : null}
            {/* Stars with no words: one standard reply each, checked and then
              published (or submitted) as a batch. Offered only when the
              selection has some. */}
            {offersTemplate && primary !== "template" ? (
              <DropdownMenuItem onClick={() => openTemplate("more")}>
                <MessageSquareText aria-hidden />
                Reply with template
              </DropdownMenuItem>
            ) : null}
            {/* The people come last in the sheet: a long team would
              otherwise push the actions out of reach. */}
            {menuIsSheet ? (
              <>
                {/* A rule only under an action row: with "No reply
                  needed" as the primary (so no rating-only rows either),
                  the people are the sheet's only rows. */}
                {primary !== "mark_reviewed" ? <DropdownMenuSeparator /> : null}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                  {assigneeItems}
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Approving publishes: each approved reply goes to Google at once.
          A batch of that is confirmed, like every other publish. */}
        {primaryTile}
      </SelectionBar>

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent
          aria-label={`Approve and publish ${approvable.length} ${approvable.length === 1 ? "reply" : "replies"} to Google?`}
        >
          <AlertDialogTitle>
            Approve and publish {approvable.length}{" "}
            {approvable.length === 1 ? "reply" : "replies"} to Google?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {bulkEngine
              ? "Each approved reply is sent to Google in the background, one after another, and appears on the business’s profile under its name. You can close this tab; the batch page shows each result."
              : "Each approved reply is sent to Google straight away and appears on the business’s profile under its name."}
            {approvable.length < chosen.length
              ? ` The other ${chosen.length - approvable.length} selected are not ready for your approval and are left as they are.`
              : ""}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              Cancel
            </AlertDialogClose>
            <Button
              disabled={bulk.isPending}
              onClick={() => {
                setConfirmApprove(false)
                void run("approve")
              }}
            >
              Approve and publish {approvable.length}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {templateDialog}
    </>
  )
}

export { BulkActionBar }
