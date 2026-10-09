"use client"

import { Check, MessageSquareText, UserPlus, X } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToastManager } from "@/components/ui/toast"
import type { BulkReviewResult, ReviewRow } from "@/lib/contracts/reviews"
import { describeErrorCode } from "@/lib/errors/action-errors"
import { isRatingOnly } from "@/lib/inbox/template-batch"
import { useBulkReviewAction } from "@/lib/queries/use-bulk-review-action"
import { useMembers } from "@/lib/queries/use-members"

/**
 * Actions over a selection, floating over the workspace as a capsule on the
 * popover material — the way a Mac shows a selection's tools without moving
 * the rows underneath.
 *
 * Reports eligibility BEFORE acting — "3 of 5 can be approved" — because the
 * alternative is an operator pressing Approve on five rows and being told
 * afterwards that two were not theirs to approve. Results come back per row,
 * so a stale row never discards the rest of the batch.
 */
function BulkActionBar({ rows }: { rows: ReviewRow[] }) {
  const { selected, clear, replace } = useSelection()
  const bulk = useBulkReviewAction()
  const toast = useToastManager()
  const [outcome, setOutcome] = React.useState<BulkReviewResult | null>(null)
  const [confirmApprove, setConfirmApprove] = React.useState(false)
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

  const templateDialog = templateRows ? (
    <TemplateReplyDialog
      open
      rows={templateRows}
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

  const approvable = chosen.filter(
    (row) =>
      row.workflowStatus === "awaiting_approval" && row.capabilities.canPublish
  )

  const run = async (
    action: "approve" | "assign" | "mark_reviewed",
    assigneeId?: string | null
  ) => {
    const ids =
      action === "approve"
        ? approvable.map((row) => row.id)
        : chosen.map((row) => row.id)
    if (ids.length === 0) return
    try {
      const result = await bulk.mutateAsync({
        action,
        reviewIds: ids,
        ...(action === "assign" ? { assigneeId: assigneeId ?? null } : {}),
      })
      setOutcome(result)
      const ok = result.results.filter((row) => row.status === "ok").length
      const skipped = result.results.length - ok
      toast.add({
        title:
          skipped === 0
            ? `${ok} ${ok === 1 ? "review" : "reviews"} updated`
            : `${ok} updated, ${skipped} skipped`,
        description:
          skipped === 0 ? undefined : "The bar lists which, and why.",
        type: skipped === 0 ? "success" : "warning",
      })
      if (skipped === 0) clear()
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
  const failures = outcome
    ? outcome.results.filter((row) => row.status !== "ok")
    : []

  return (
    <div
      role="region"
      aria-label="Selected reviews"
      data-slot="bulk-action-bar"
      // Reference `.bulkbar`: the list's own charcoal bar, pinned under the
      // rows — sticky at the foot of the screen where the page scrolls.
      className="sticky bottom-0 z-20 flex shrink-0 flex-col gap-2 rounded-b-[calc(var(--np-radius-card)-1px)] on-charcoal px-3 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] [&_:focus-visible]:outline-ink-on-charcoal md:[@media(min-height:620px)]:pb-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto text-ui font-semibold text-ink-on-charcoal tabular-nums">
          {chosen.length} selected
        </strong>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost-dark"
                disabled={bulk.isPending}
              />
            }
          >
            <UserPlus aria-hidden data-icon="inline-start" />
            Assign
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center">
            {(members.data?.members ?? []).map((member) => (
              <DropdownMenuItem
                key={member.userId}
                onClick={() => void run("assign", member.userId)}
              >
                {member.displayName ?? member.email}
              </DropdownMenuItem>
            ))}
            {(members.data?.members ?? []).length > 0 ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem onClick={() => void run("assign", null)}>
              Unassign
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Triage, not a reply: it clears the reviews from Needs reply and
            sends nothing to Google. "Mark reviewed" read as though it might
            do either. */}
        <Button
          size="sm"
          variant="ghost-dark"
          disabled={bulk.isPending}
          title="Clears these from Needs reply. Nothing is posted to Google."
          onClick={() => void run("mark_reviewed")}
        >
          No reply needed
        </Button>

        {/* Stars with no words: one standard reply each, checked and then
            published (or submitted) as a batch. Offered only when the
            selection has some. */}
        {chosen.some(isRatingOnly) ? (
          <Button
            size="sm"
            variant="ghost-dark"
            disabled={bulk.isPending}
            onClick={() => setTemplateRows(chosen)}
          >
            <MessageSquareText aria-hidden data-icon="inline-start" />
            Reply with template
          </Button>
        ) : null}

        {/* Approving publishes: each approved reply goes to Google at once.
            A batch of that is confirmed, like every other publish. */}
        <Button
          size="sm"
          variant="on-dark"
          disabled={approvable.length === 0 || bulk.isPending}
          onClick={() => setConfirmApprove(true)}
        >
          <Check aria-hidden data-icon="inline-start" />
          {approvable.length === chosen.length
            ? "Approve"
            : `Approve ${approvable.length} of ${chosen.length}`}
        </Button>

        <Button
          size="icon-sm"
          variant="ghost-dark"
          aria-label="Clear selection"
          onClick={clear}
        >
          <X aria-hidden />
        </Button>
      </div>

      {partial ? (
        <p className="text-caption text-ink-muted-on-charcoal">
          {chosen.length - approvable.length} of these are not awaiting your
          approval, so Approve will skip them.
        </p>
      ) : null}

      {failures.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-live="polite">
          {failures.map((row) => (
            <li
              key={row.reviewId}
              className="flex items-center gap-2 text-caption text-ink-on-charcoal"
            >
              <span className="font-semibold">
                {row.status === "failed" ? "Failed" : "Skipped"}
              </span>
              <span className="min-w-0 truncate">
                {describeRow(row.reviewId)}
              </span>
              <span className="text-ink-muted-on-charcoal">
                {row.code ? describeErrorCode(row.code) : "No reason given."}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent
          aria-label={`Approve and publish ${approvable.length} ${approvable.length === 1 ? "reply" : "replies"} to Google?`}
        >
          <AlertDialogTitle>
            Approve and publish {approvable.length}{" "}
            {approvable.length === 1 ? "reply" : "replies"} to Google?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Each approved reply is sent to Google straight away and appears on
            the business&apos;s profile under its name.
            {approvable.length < chosen.length
              ? ` The other ${chosen.length - approvable.length} selected are not awaiting your approval and are left as they are.`
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
    </div>
  )
}

export { BulkActionBar }
