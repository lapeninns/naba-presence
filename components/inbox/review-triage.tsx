"use client"

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { showToast, toast } from "@/components/ui/toast"
import type {
  BulkReviewActionInput,
  BulkReviewResult,
} from "@/lib/contracts/reviews"
import { describeErrorCode } from "@/lib/errors/action-errors"
import { summariseBulkOutcome } from "@/lib/inbox/bulk-outcome"
import { useBulkReviewAction } from "@/lib/queries/use-bulk-review-action"
import { useMembers } from "@/lib/queries/use-members"
import { useSession } from "@/lib/queries/use-session"

/**
 * Triage over one review or many, shared by the bulk bar, the review's own
 * ⋯ menu and a list row's swipe: one mutation, one outcome toast, one
 * Undo for "No reply needed", one list of people who can be assigned. Each surface says
 * where the reviews come from; what happens to them is said here once.
 */

const reviewCount = (input: BulkReviewActionInput) =>
  input.action === "approve" ? input.approvals.length : input.reviewIds.length

/**
 * Runs a bulk action and says how it went. Resolves with the per-row
 * result, or `null` when the batch did not run at all (the error toast has
 * then been shown). Callers decide what the result means for them: the bulk
 * bar keeps it for its notes and leaves select mode, a single review has
 * nothing more to do.
 */
export function useReviewTriage() {
  const bulk = useBulkReviewAction()
  const run = async (
    input: BulkReviewActionInput
  ): Promise<BulkReviewResult | null> => {
    try {
      const result = await bulk.mutateAsync(input)
      const summary = summariseBulkOutcome(result)
      const marked =
        input.action === "mark_reviewed"
          ? result.results
              .filter((row) => row.status === "ok")
              .map((row) => row.reviewId)
          : []
      if (marked.length > 0) {
        // Local and reversible, so it is done at once and Undo is the way
        // back, not a confirmation first (the P07 recipe). Undo puts back
        // only the reviews this press marked.
        showToast({
          title:
            summary.allOk && marked.length === 1
              ? "Marked as no reply needed"
              : summary.allOk
                ? `${marked.length} reviews marked as no reply needed`
                : summary.title,
          description: summary.allOk ? undefined : summary.description,
          type: summary.tone,
          undo: { onUndo: () => void undoNoReplyNeeded(marked) },
        })
        return result
      }
      if (input.action === "mark_unreviewed" && summary.allOk) {
        toast.add({
          title: `${reviewCount(input) === 1 ? "Review" : "Reviews"} back in Needs reply`,
          type: "success",
        })
        return result
      }
      toast.add({
        title: summary.title,
        description: summary.description,
        type: summary.tone,
      })
      return result
    } catch (error) {
      toast.add({
        title:
          reviewCount(input) === 1
            ? "That review was not updated"
            : "That batch did not run",
        description: describeErrorCode(error),
        type: "error",
      })
      return null
    }
  }
  const undoNoReplyNeeded = (reviewIds: string[]) =>
    run({ action: "mark_unreviewed", reviewIds })
  return { run, isPending: bulk.isPending }
}

/** "Mark reviewed" for these reviews: local triage, nothing goes to Google. */
export function markNoReplyNeeded(reviewIds: string[]): BulkReviewActionInput {
  return { action: "mark_reviewed", reviewIds }
}

/** Assign these reviews to someone, or to no one (`null`). */
export function assignReviews(
  reviewIds: string[],
  assigneeId: string | null
): BulkReviewActionInput {
  return { action: "assign", reviewIds, assigneeId }
}

export type Assignee = { userId: string; label: string }

export type AssigneeState = {
  assignees: Assignee[]
  /** `error` is a refused or failed team read; `loading` is still on its way. */
  status: "loading" | "ready" | "error"
}

/**
 * The people a review can be offered to: never a viewer, and a member scoped
 * to locations only when one of the reviews is at one of them. The server
 * still checks every row (`assignee_not_eligible`); this just keeps certain
 * refusals off the menu.
 *
 * The team list is `/api/members`, which only an owner or admin may read. An
 * ordinary member can still assign (at a location they may edit) but cannot
 * list the team, so they are offered themselves and Unassign, and the
 * endpoint is never called for them. Fetched only when `enabled`.
 */
export function useAssignees(
  locationIds: Iterable<string>,
  { enabled = true }: { enabled?: boolean } = {}
): AssigneeState {
  const session = useSession()
  const me = session.data?.session ?? null
  const canListTeam = me?.role === "owner" || me?.role === "admin"
  const members = useMembers({ enabled: enabled && canListTeam })

  if (session.isError) return { assignees: [], status: "error" }
  if (!me) return { assignees: [], status: "loading" }
  if (!canListTeam) {
    return {
      assignees:
        me.role === "member" ? [{ userId: me.userId, label: "Me" }] : [],
      status: "ready",
    }
  }
  if (members.isError) return { assignees: [], status: "error" }
  if (!members.data) return { assignees: [], status: "loading" }

  const locations = new Set(locationIds)
  return {
    assignees: members.data.members
      .filter(
        (member) =>
          member.role !== "viewer" &&
          (member.locations.length === 0 ||
            member.locations.some((grant) => locations.has(grant.locationId)))
      )
      .map((member) => ({
        userId: member.userId,
        label: member.displayName ?? member.email,
      })),
    status: "ready",
  }
}

/** The people, then "Unassign": the body of an Assign… submenu or sheet group. */
export function AssigneeItems({
  assignees,
  status,
  onAssign,
}: AssigneeState & {
  onAssign: (assigneeId: string | null) => void
}) {
  return (
    <>
      {assignees.map((member) => (
        <DropdownMenuItem
          key={member.userId}
          onClick={() => onAssign(member.userId)}
        >
          {member.label}
        </DropdownMenuItem>
      ))}
      {status === "loading" ? (
        <DropdownMenuItem disabled>Loading people…</DropdownMenuItem>
      ) : null}
      {status === "error" ? (
        <DropdownMenuItem disabled>Couldn&apos;t load people</DropdownMenuItem>
      ) : null}
      {assignees.length > 0 || status !== "ready" ? (
        <DropdownMenuSeparator />
      ) : null}
      <DropdownMenuItem onClick={() => onAssign(null)}>
        Unassign
      </DropdownMenuItem>
    </>
  )
}
