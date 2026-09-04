"use client"

import { Check, UserPlus, X } from "lucide-react"
import * as React from "react"

import { useSelection } from "@/components/inbox/selection-context"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusPill } from "@/components/ui/status-pill"
import { useToastManager } from "@/components/ui/toast"
import type { BulkReviewResult, ReviewRow } from "@/lib/contracts/reviews"
import { describeErrorCode } from "@/lib/errors/action-errors"
import { useBulkReviewAction } from "@/lib/queries/use-bulk-review-action"
import { useMembers } from "@/lib/queries/use-members"

/**
 * Actions over a selection.
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
    (row) => row.workflowStatus === "awaiting_approval" && row.capabilities.canPublish
  )

  const run = async (
    action: "approve" | "assign" | "mark_reviewed",
    assigneeId?: string | null
  ) => {
    const ids =
      action === "approve" ? approvable.map((row) => row.id) : chosen.map((row) => row.id)
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

  return (
    <div className="flex flex-col gap-2 border-t border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ui font-medium tabular-nums">
          {chosen.length} selected
        </span>

        <Button
          size="sm"
          disabled={approvable.length === 0 || bulk.isPending}
          onClick={() => void run("approve")}
        >
          <Check className="size-3.5" aria-hidden />
          {approvable.length === chosen.length
            ? "Approve"
            : `Approve ${approvable.length} of ${chosen.length}`}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="sm" variant="outline" disabled={bulk.isPending} />}
          >
            <UserPlus className="size-3.5" aria-hidden />
            Assign
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {(members.data?.members ?? []).map((member) => (
              <DropdownMenuItem
                key={member.userId}
                onClick={() => void run("assign", member.userId)}
              >
                {member.displayName ?? member.email}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => void run("assign", null)}>
              Unassign
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="outline"
          disabled={bulk.isPending}
          onClick={() => void run("mark_reviewed")}
        >
          Mark reviewed
        </Button>

        <Button size="sm" variant="ghost" onClick={clear} className="ml-auto">
          <X className="size-3.5" aria-hidden />
          Clear
        </Button>
      </div>

      {approvable.length < chosen.length && approvable.length > 0 ? (
        <p className="text-caption text-ink-muted">
          {chosen.length - approvable.length} of these are not awaiting your
          approval, so Approve will skip them.
        </p>
      ) : null}

      {outcome && outcome.results.some((row) => row.status !== "ok") ? (
        <ul className="flex flex-col gap-1" aria-live="polite">
          {outcome.results
            .filter((row) => row.status !== "ok")
            .map((row) => (
              <li key={row.reviewId} className="flex items-center gap-2 text-caption">
                <StatusPill
                  tone={row.status === "failed" ? "at-risk" : "attention"}
                  variant="inline"
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
