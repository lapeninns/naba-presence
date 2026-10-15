"use client"

import {
  Check,
  CircleSlash,
  MessageSquareText,
  Ellipsis,
  UserPlus,
} from "lucide-react"
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

/**
 * Actions over a selection: the shared SelectionBar, docked to the bottom
 * of a phone while anything is ticked, where it takes the tab bar's slot
 * (D4), and sticky at the foot of the list from md. Its header is "N
 * selected" and "Clear selection"; its tiles are an overflow (⋯) for the
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
  const { selected, clear, replace, setSelectMode } = useSelection()
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

  const chosen = rows.filter((row) => selected.has(row.id))
  // The member list is only needed to assign, so it is fetched when a
  // selection exists rather than on every visit to the inbox.
  const assignees = useAssignees(
    chosen.map((row) => row.location.id),
    { enabled: chosen.length > 0 }
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
    <AssigneeItems
      assignees={assignees}
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
        tone="charcoal"
        icon={<MessageSquareText aria-hidden />}
        label="Reply with template"
        disabled={bulk.isPending}
        onClick={() => setTemplateRows(chosen)}
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
          page while something is ticked (the early return above). Its
          "Clear selection" empties the selection and leaves select mode as
          it is; the list header's Cancel/Done leaves select mode. */}
      <SelectionBar
        data-slot="bulk-action-bar"
        label="Selected reviews"
        count={chosen.length}
        onCancel={clear}
        cancelLabel="Clear selection"
        notes={notes}
        className="shrink-0"
      >
        <DropdownMenu>
          <DropdownMenuTrigger
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
            {ratingOnly && primary !== "template" ? (
              <DropdownMenuItem onClick={() => setTemplateRows(chosen)}>
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
