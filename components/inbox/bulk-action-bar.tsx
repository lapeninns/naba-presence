"use client"

import { Check, UserPlus, X } from "lucide-react"
import * as React from "react"

import { useSelection } from "@/components/inbox/selection-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import type { BulkReviewResult, ReviewRow } from "@/lib/contracts/reviews"
import { describeErrorCode } from "@/lib/errors/action-errors"
import { useBulkReviewAction } from "@/lib/queries/use-bulk-review-action"
import { useMembers } from "@/lib/queries/use-members"
import { cn } from "@/lib/utils"

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
  const { selected, clear } = useSelection()
  const bulk = useBulkReviewAction()
  const toast = useToastManager()
  const [outcome, setOutcome] = React.useState<BulkReviewResult | null>(null)

  const chosen = rows.filter((row) => selected.has(row.id))
  // The member list is only needed to assign, so it is fetched when a
  // selection exists rather than on every visit to the inbox.
  const members = useMembers({ enabled: chosen.length > 0 })

  if (chosen.length === 0) return null

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
      })
      if (skipped === 0) clear()
    } catch (error) {
      toast.add({
        title: "That batch did not run",
        description: describeErrorCode(error),
      })
    }
  }

  const partial = approvable.length < chosen.length && approvable.length > 0
  const failures = outcome
    ? outcome.results.filter((row) => row.status !== "ok")
    : []
  // A single row of tools is a capsule; once there is a note or a list of
  // outcomes under it, the panel radius keeps the corners concentric.
  const hasNotes = partial || failures.length > 0

  return (
    <div
      role="region"
      aria-label="Selected reviews"
      data-slot="bulk-action-bar"
      className={cn(
        "absolute bottom-4 left-1/2 z-20 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col gap-2 material-popover shadow-(--np-shadow-pop)",
        "transition-[opacity,translate] duration-(--np-duration-overlay) ease-spring starting:translate-y-2 starting:opacity-0",
        hasNotes
          ? "rounded-(--np-radius-panel) px-3 py-2.5"
          : "rounded-(--np-radius-pill) py-1.5 pr-1.5 pl-3"
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="pr-1.5 text-ui font-medium text-ink tabular-nums">
          {chosen.length} selected
        </span>

        <Button
          size="sm"
          pill
          disabled={approvable.length === 0 || bulk.isPending}
          onClick={() => void run("approve")}
        >
          <Check aria-hidden strokeWidth={1.75} data-icon="inline-start" />
          {approvable.length === chosen.length
            ? "Approve"
            : `Approve ${approvable.length} of ${chosen.length}`}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="secondary"
                pill
                disabled={bulk.isPending}
              />
            }
          >
            <UserPlus aria-hidden strokeWidth={1.75} data-icon="inline-start" />
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

        <Button
          size="sm"
          variant="secondary"
          pill
          disabled={bulk.isPending}
          onClick={() => void run("mark_reviewed")}
        >
          Mark reviewed
        </Button>

        <Button
          size="icon-sm"
          variant="ghost"
          pill
          aria-label="Clear selection"
          onClick={clear}
        >
          <X aria-hidden strokeWidth={1.75} />
        </Button>
      </div>

      {partial ? (
        <p className="text-caption text-ink-muted">
          {chosen.length - approvable.length} of these are not awaiting your
          approval, so Approve will skip them.
        </p>
      ) : null}

      {failures.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-live="polite">
          {failures.map((row) => (
            <li
              key={row.reviewId}
              className="flex items-center gap-2 text-caption"
            >
              <StatusPill
                tone={row.status === "failed" ? "at-risk" : "attention"}
                variant="inline"
                className="text-caption"
              >
                {row.status === "failed" ? "Failed" : "Skipped"}
              </StatusPill>
              <span className="text-ink-muted">
                {row.code ? describeErrorCode(row.code) : "No reason given."}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export { BulkActionBar }
