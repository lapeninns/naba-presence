"use client"

import {
  Check,
  CircleSlash,
  MessageSquareText,
  Ellipsis,
  UserPlus,
  X,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { useSelection } from "@/components/inbox/selection-context"
import { TemplateReplyDialog } from "@/components/inbox/template-reply-dialog"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ActionBar } from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
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
import { useToastManager } from "@/components/ui/toast"
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
import { useBulkReviewAction } from "@/lib/queries/use-bulk-review-action"
import { useMembers } from "@/lib/queries/use-members"
import { cn } from "@/lib/utils"

/**
 * The SelectionBar tile (REFERENCE-BRIEF §4.3): below md each of the bar's
 * actions is a 64px tile, its icon over a caption label, so a thumb gets a
 * target well past the 44px floor and the words stay readable at 320px.
 * From md the same buttons are the desk's one-row controls again. Pure CSS,
 * so the server's HTML is right for both widths.
 */
const TILE_CLASS =
  "max-md:h-auto max-md:min-h-16 max-md:min-w-16 max-md:flex-col max-md:gap-1 max-md:px-2.5 max-md:py-2 max-md:text-caption max-md:font-medium"
/** A quiet tile: a faint on-charcoal fill in place of the outline. */
const QUIET_TILE_CLASS =
  "max-md:border-transparent max-md:bg-ink-on-charcoal/10"

/**
 * Actions over a selection (the SelectionBar): the list's charcoal bar —
 * charcoal because its Approve publishes to Google (D4) — pinned under the
 * rows and docked to the bottom of a phone while anything is ticked, where
 * it takes the tab bar's slot. One row: how many are selected, an overflow
 * (⋯) for the rarer actions, and one primary. On a phone the two actions are
 * 64px tiles (icon over label); a desk keeps compact buttons and adds a
 * quick ✕ to clear. On touch, Clear is in the overflow (and the list
 * header's Cancel clears too).
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
  const { selected, clear, replace, setSelectMode } = useSelection()
  const bulk = useBulkReviewAction()
  const toast = useToastManager()
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

  const chosen = rows.filter((row) => selected.has(row.id))
  // The member list is only needed to assign, so it is fetched when a
  // selection exists rather than on every visit to the inbox.
  const members = useMembers({ enabled: chosen.length > 0 })
  // Offer only people the server would accept for at least one chosen row:
  // never a viewer, and a member scoped to locations only when one of the
  // chosen reviews is at one of them. The server still checks every row
  // (`assignee_not_eligible`); this just keeps certain refusals off the menu.
  const chosenLocations = new Set(chosen.map((row) => row.location.id))
  const assignees = (members.data?.members ?? []).filter(
    (member) =>
      member.role !== "viewer" &&
      (member.locations.length === 0 ||
        member.locations.some((grant) => chosenLocations.has(grant.locationId)))
  )

  const templateDialog = templateRows ? (
    <TemplateReplyDialog
      open
      rows={templateRows}
      bulkEngine={bulkEngine}
      onOpenChange={(open) => {
        if (!open) setTemplateRows(null)
      }}
      onFinished={(sentIds) => {
        const sent = new Set(sentIds)
        replace([...selected].filter((id) => !sent.has(id)))
      }}
    />
  ) : null

  if (chosen.length === 0) return templateDialog

  // Approval is bound to the draft on screen: a row with no draft has
  // nothing the operator could have read, so it cannot be approved here.
  const approvable = chosen.filter(
    (row) =>
      row.workflowStatus === "awaiting_approval" &&
      row.capabilities.canPublish &&
      row.draftId !== null
  )

  const run = async (
    action: "approve" | "assign" | "mark_reviewed",
    assigneeId?: string | null
  ) => {
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
                draftId: row.draftId!,
                reviewUpdateTime: row.updateTime,
              })),
            }
        : chosen.length === 0
          ? null
          : action === "assign"
            ? {
                action,
                reviewIds: chosen.map((row) => row.id),
                assigneeId: assigneeId ?? null,
              }
            : { action, reviewIds: chosen.map((row) => row.id) }
    if (!input) return
    try {
      const result = await bulk.mutateAsync(input)
      setOutcome(result)
      const summary = summariseBulkOutcome(result)
      toast.add({
        title: summary.title,
        description: summary.description,
        type: summary.tone,
      })
      // Every row done: the batch is over, so select mode ends with it
      // (which also clears). Anything left over stays ticked to retry.
      if (summary.allOk) setSelectMode(false)
    } catch (error) {
      toast.add({
        title: "That batch did not run",
        description: describeErrorCode(error),
        type: "error",
      })
    }
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
  const ratingOnly = chosen.some(isRatingOnly)
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
      : ratingOnly
        ? "template"
        : "mark_reviewed"
  const assigneeItems = (
    <>
      {assignees.map((member) => (
        <DropdownMenuItem
          key={member.userId}
          onClick={() => void run("assign", member.userId)}
        >
          {member.displayName ?? member.email}
        </DropdownMenuItem>
      ))}
      {assignees.length > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem onClick={() => void run("assign", null)}>
        Unassign
      </DropdownMenuItem>
    </>
  )
  const plural = (count: number) => (count === 1 ? "review" : "reviews")

  const primaryButton =
    primary === "approve" ? (
      <Button
        variant="on-dark"
        className={TILE_CLASS}
        disabled={bulk.isPending}
        onClick={() => setConfirmApprove(true)}
      >
        <Check aria-hidden data-icon="inline-start" />
        {approvable.length === chosen.length
          ? `Approve ${approvable.length}`
          : `Approve ${approvable.length} of ${chosen.length}`}
      </Button>
    ) : primary === "template" ? (
      <Button
        variant="on-dark"
        className={TILE_CLASS}
        disabled={bulk.isPending}
        onClick={() => setTemplateRows(chosen)}
      >
        <MessageSquareText aria-hidden data-icon="inline-start" />
        Reply with template
      </Button>
    ) : (
      <Button
        variant="on-dark"
        className={TILE_CLASS}
        disabled={bulk.isPending}
        onClick={() => setConfirmReviewed(true)}
      >
        <CircleSlash aria-hidden data-icon="inline-start" />
        No reply needed
      </Button>
    )

  return (
    <>
      {/* The shared ActionBar, docked: the one bar that owns the bottom edge
          while rows are ticked. On a phone it is fixed to the bottom of the
          screen (the chrome contract in globals.css steps the tab bar aside for
          it, and it rides the keyboard); from md it sticks to the foot of the
          list. Only on the page while something is ticked (the early return
          above). The bar's own padding is dropped for this one's two stacked
          parts, notes over a single row; the dock edge stays under them. */}
      <ActionBar
        data-slot="bulk-action-bar"
        label="Selected reviews"
        dock
        safeArea={false}
        className="shrink-0 flex-col flex-nowrap items-stretch gap-0 rounded-none p-0 pb-[var(--np-dock-bottom)] shadow-none max-md:p-0 max-md:pb-[var(--np-dock-bottom)] md:rounded-b-(--np-radius-card)"
      >
        {/* Results and notes sit above the row, so the row itself stays one
          line (64px at most) and the buttons never move under a thumb. */}
        {partial || outcome?.operationId || failures.length > 0 ? (
          <div className="flex flex-col gap-1 px-3 pt-2.5">
            {partial ? (
              <p className="text-caption text-ink-muted-on-charcoal">
                {chosen.length - approvable.length} of these are not ready for
                your approval, so Approve will skip them.
              </p>
            ) : null}

            {outcome?.operationId ? (
              <p
                className="text-caption text-ink-on-charcoal"
                aria-live="polite"
              >
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
                    className="flex flex-wrap items-baseline gap-x-2 text-caption text-ink-on-charcoal"
                  >
                    <span className="font-semibold">
                      {BULK_ROW_STATUS_LABEL[row.status]}
                    </span>
                    <span className="min-w-0 truncate">
                      {describeRow(row.reviewId)}
                    </span>
                    <span className="text-ink-muted-on-charcoal">
                      {row.code
                        ? describeErrorCode(row.code)
                        : "No reason given."}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div
          data-slot="selection-bar-row"
          className="flex items-center gap-2 px-3 py-2.5 max-md:py-2"
        >
          <strong className="min-w-0 flex-1 truncate text-ui font-semibold text-ink-on-charcoal tabular-nums max-md:text-body">
            {chosen.length} selected
          </strong>

          <Button
            size="icon"
            variant="ghost-dark"
            aria-label="Clear selection"
            // Desk only: on touch the row keeps to count, ⋯ and one primary,
            // and Clear is an overflow item.
            className="hidden desk:inline-flex"
            onClick={clear}
          >
            <X aria-hidden />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon"
                  variant="ghost-dark"
                  aria-label="More actions"
                  disabled={bulk.isPending}
                  className={cn(TILE_CLASS, QUIET_TILE_CLASS, "max-md:w-auto")}
                />
              }
            >
              <Ellipsis aria-hidden />
              {/* The tile's caption; the name stays "More actions", which
                  begins with the words on screen (2.5.3). */}
              <span aria-hidden className="md:hidden">
                More
              </span>
            </DropdownMenuTrigger>
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
                  <DropdownMenuSubContent>
                    {assigneeItems}
                  </DropdownMenuSubContent>
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
              {ratingOnly && primary !== "template" ? (
                <DropdownMenuItem onClick={() => setTemplateRows(chosen)}>
                  <MessageSquareText aria-hidden />
                  Reply with template
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem className="desk:hidden" onClick={clear}>
                <X aria-hidden />
                Clear selection
              </DropdownMenuItem>
              {/* The people come last in the sheet: a long team would
                otherwise push the actions out of reach. */}
              {menuIsSheet ? (
                <>
                  <DropdownMenuSeparator />
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
          {primaryButton}
        </div>
      </ActionBar>

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

      {/* There is no API to put a review back in Needs reply, so this asks
          first rather than offering an Undo it could not keep. */}
      <AlertDialog open={confirmReviewed} onOpenChange={setConfirmReviewed}>
        <AlertDialogContent
          aria-label={`Mark ${chosen.length} ${plural(chosen.length)} as no reply needed?`}
        >
          <AlertDialogTitle>
            Mark {chosen.length} {plural(chosen.length)} as no reply needed?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They leave Needs reply. Nothing is posted to Google.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              Cancel
            </AlertDialogClose>
            <Button
              disabled={bulk.isPending}
              onClick={() => {
                setConfirmReviewed(false)
                void run("mark_reviewed")
              }}
            >
              Mark {chosen.length} {plural(chosen.length)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {templateDialog}
    </>
  )
}

export { BulkActionBar }
