"use client"

import type { ReactNode } from "react"
import type { SavedWorkItem } from "@/components/reviewed-write"
import { StatusPill } from "@/components/ui/status-pill"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { useDeadline } from "@/lib/editors/use-deadline"

/**
 * Where a saved review stands, after its deadline (the instant the saved-work
 * row prints): "Approval expired · Approved request". The deadline is the
 * only instant a saved review carries, so the words say what it is.
 */
function DeadlineStage({
  change,
  recorded,
}: {
  readonly change: GbpChangeSet
  readonly recorded: boolean
}) {
  const expired = useDeadline(change.expiresAt)
  const subject = change.approvedBy ? "Approval" : "Review"
  const status = recorded
    ? "Request outcome recorded"
    : change.approvedBy
      ? "Approved request"
      : "Awaiting approval"
  // The stage is a status word with its tone's dot (words first, the dot
  // only reinforces): an expired or recorded request needs nothing more, an
  // approved one can be sent, one awaiting approval needs someone.
  const tone =
    recorded || expired
      ? "neutral"
      : change.approvedBy
        ? "pending"
        : "attention"
  return (
    <>
      {`${subject} ${expired ? "expired" : "expires"} · `}
      <StatusPill
        tone={tone}
        variant="inline"
        className="align-baseline text-caption"
      >
        {status}
      </StatusPill>
    </>
  )
}

/**
 * One saved Google change as a saved-work row: what it changes (with the
 * exact Google target as secondary detail), its deadline and stage, and the
 * action that reopens it in its sheet.
 */
export function savedChangeItem({
  change,
  recorded,
  operation,
  actionLabel,
  onOpen,
  disabled,
}: {
  readonly change: GbpChangeSet
  readonly recorded: boolean
  readonly operation: string
  readonly actionLabel: string
  readonly onOpen: () => void
  readonly disabled: boolean
}): SavedWorkItem {
  const title: ReactNode = (
    <>
      {operation}
      {change.targetResourceName ? (
        <span className="block text-caption break-all text-ink-muted">
          Google target: {change.targetResourceName}
        </span>
      ) : null}
    </>
  )
  return {
    id: change.id,
    operation: title,
    stage: <DeadlineStage change={change} recorded={recorded} />,
    createdAt: change.expiresAt,
    actionLabel,
    onOpen,
    disabled,
  }
}
