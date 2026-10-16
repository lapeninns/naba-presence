"use client"

import {
  Check,
  CircleSlash,
  MessageSquareText,
  Ellipsis,
  UserPlus,
} from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import * as React from "react"

import {
  AssigneeItems,
  assignReviews,
  markNoReplyNeeded,
  NoReplyNeededDialog,
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
import { SelectionBar, SelectionBarTile } from "@/components/ui/selection-bar"
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
}: {
  rows: ReviewRow[]
  /** Approve and template replies run as a bulk batch (the job runner sends them). */
  bulkEngine?: boolean
}) {
  const { selected, replace, setSelectMode } = useSelection()
  const bulk = useReviewTriage()
  // On a phone the overflow is a bottom action sheet, where a flyout
  // submenu has nowhere to fly to; the assignees are listed in the sheet.
  const menuIsSheet = useMenuSheet()
  const [outcome, setOutcome] = React.useState<BulkReviewResult | null>(null)
  const [confirmApprove, setConfirmApprove] = React.useState(false)
  const [confirmReviewed, setConfirmReviewed] = React.useState(false)
  // The selection as it was when the template batch opened. Replies that
  // publish leave the list (and so the selection's visible rows) while the
  // dialog is still showing its summary, so it works from this copy and is
  // rendered even once nothing selected is on screen.
  const [templateRows, setTemplateRows] = React.useState<ReviewRow[] | null>(
    null
  )
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

  const openTemplate = (from: "primary" | "more") => {
    templateOpenerRef.current =
      from === "primary" ? primaryRef.current : moreRef.current
    setTemplateRows(chosen)
  }
  const closeTemplate = () => setTemplateRows(null)

  // An open that is still waiting for the dialog's code is cancelled with the
  // selection it was made on (cleared, or a scope that moved the rows), so a
  // batch the operator walked away from cannot appear later, over something
  // else. Once the dialog has arrived it is a different matter: it keeps its
  // own copy of the rows on purpose, to show its summary after replies have
  // left the list.
  const chosenIds = new Set(chosen.map((row) => row.id))
  const templateStale =
    templateRows !== null &&
    !lazyTemplate.Loaded &&
    templateRows.some((row) => !chosenIds.has(row.id))
  if (templateStale) setTemplateRows(null)

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
              replace([...selected].filter((id) => !sent.has(id)))
            }}
          />
        </LazyDialogBoundary>
      </TemplateShellContext.Provider>
    ) : null

  if (chosen.length === 0) return <>{templateDialog}</>

  // Approval is bound to the draft the list showed: the parked one (what the
  // server approves and single approve names), not the newest. A row with no
  // draft has nothing the operator could have read, so it cannot be approved
  // here. `pendingDraftId` is absent from older servers; fall back to the
  // newest draft as before.
  const approvalDraftId = (row: (typeof chosen)[number]) =>
    row.pendingDraftId ?? row.draftId
  const approvable = chosen.filter(
    (row) =>
      row.workflowStatus === "awaiting_approval" &&
      row.capabilities.canPublish &&
      // Under two-person approval the approval route refuses a reply this
      // person asked for or drafted (`second_approver_required`). An older
      // server sends no `canApprove`; it is then approvable as before.
      row.canApprove !== false &&
      approvalDraftId(row) !== null
  )

  const run = async (
    action: "approve" | "assign" | "mark_reviewed",
    assigneeId?: string | null
  ) => {
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
    const result = await bulk.run(input)
    if (!result) return
    setOutcome(result)
    // Every row done: the batch is over, so select mode ends with it
    // (which also clears). Anything left over stays ticked to retry.
    if (summariseBulkOutcome(result).allOk) setSelectMode(false)
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
          approvable.length === chosen.length
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
        label="No reply needed"
        disabled={bulk.isPending}
        onClick={() => setConfirmReviewed(true)}
      />
    )

  // Results and notes sit above the header and the tiles, so the tiles
  // never move under a thumb.
  const notes =
    partial || outcome?.operationId || failures.length > 0 ? (
      <div className="flex flex-col gap-1">
        {partial ? (
          <p>
            {chosen.length - approvable.length} of these are not ready for your
            approval, so Approve will skip them.
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
              might do either. Confirmed, because there is no way back. */}
            {primary !== "mark_reviewed" ? (
              <DropdownMenuItem onClick={() => setConfirmReviewed(true)}>
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

      <NoReplyNeededDialog
        count={chosen.length}
        open={confirmReviewed}
        onOpenChange={setConfirmReviewed}
        pending={bulk.isPending}
        onConfirm={() => void run("mark_reviewed")}
      />
      {templateDialog}
    </>
  )
}

export { BulkActionBar }
