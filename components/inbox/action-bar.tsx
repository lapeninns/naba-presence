"use client"

import { useState } from "react"
import { MoreHorizontalIcon } from "lucide-react"

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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToastManager } from "@/components/ui/toast"
import { Textarea } from "@/components/ui/textarea"
import { useIsDirty } from "@/components/inbox/dirty-context"
import {
  describeOutcomeToast,
  evaluateApproval,
  evaluateDelete,
  evaluatePublish,
} from "@/lib/inbox/actions"
import { describeActionError } from "@/lib/inbox/action-errors"
import { useApprovalDecision } from "@/lib/queries/use-approval-decision"
import { useDeleteReply } from "@/lib/queries/use-delete-reply"
import { usePublishReview } from "@/lib/queries/use-publish-review"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

const VERIFIED = new Set(["pass", "warn"])
// The only `review_reply.publish_status` value that means "actually live on
// Google" (see the check constraint in supabase/migrations/0001_initial.sql:
// 'not_published' | 'awaiting_approval' | 'accepted' | 'published' |
// 'rejected' | 'failed' | 'deleted'). 'accepted' is an in-flight/ambiguous
// state, not a confirmed live reply — fix-round-1 IMPORTANT #4.
const LIVE_ON_GOOGLE = new Set(["published"])

function ActionBar({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const publish = usePublishReview(reviewId)
  const approval = useApprovalDecision(reviewId)
  const remove = useDeleteReply(reviewId)
  const toasts = useToastManager()
  // Live composer dirtiness (reactive; only this sibling re-renders on it), so
  // Publish disables with "Save your draft before publishing" while the
  // on-screen text differs from the persisted verified draft (LOCKED #4).
  const isDirty = useIsDirty()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState("")

  const review = detail.data?.review
  if (!review) return null

  const verifiedDraft = review.drafts.find(
    (draft) => draft.verificationStatus && VERIFIED.has(draft.verificationStatus)
  )
  const publishState = evaluatePublish({
    status: review.workflowStatus,
    canPublish: review.capabilities.canPublish,
    hasVerifiedDraft: Boolean(verifiedDraft),
    isDirty,
  })
  const approvalState = evaluateApproval({
    status: review.workflowStatus,
    canPublish: review.capabilities.canPublish,
  })
  const deleteState = evaluateDelete({
    hasPublishedReply: Boolean(
      review.reply?.publishStatus && LIVE_ON_GOOGLE.has(review.reply.publishStatus)
    ),
    canPublish: review.capabilities.canPublish,
  })

  // Arrow function expressions, not function declarations: TS control-flow
  // narrowing of `review` (from the `if (!review) return null` guard above)
  // only propagates into closures defined as expressions, not into hoisted
  // function declarations — see task-7-report.md for the minimal repro.
  const onPublish = async () => {
    if (!verifiedDraft) return
    try {
      const result = await publish.mutateAsync({
        draftId: verifiedDraft.id,
        expectedReviewUpdateTime: review.updateTime,
      })
      // Server-confirmed only (D7): the resolved status — never a thrown
      // ApiClientError — decides the toast, so a `rejected` (Google declined
      // the reply) or any other non-published outcome can never render as
      // "published" (fix-round-1 CRITICAL #1).
      toasts.add(describeOutcomeToast(result.status))
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const onDecision = async (decision: "approve" | "reject", note?: string) => {
    try {
      const result = await approval.mutateAsync({ decision, note })
      toasts.add(describeOutcomeToast(result.status))
      if (decision === "reject") {
        setRejectOpen(false)
        setRejectNote("")
      }
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const onDelete = async () => {
    try {
      await remove.mutateAsync()
      toasts.add({ title: "Published reply deleted", type: "success" })
      setDeleteOpen(false)
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const awaitingApproval = review.workflowStatus === "awaiting_approval"

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {awaitingApproval ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={!approvalState.enabled || approval.isPending}
            title={approvalState.reason}
            onClick={() => setRejectOpen(true)}
          >
            Reject reply
          </Button>
          <Button
            size="sm"
            disabled={!approvalState.enabled || approval.isPending}
            title={approvalState.reason}
            onClick={() => void onDecision("approve")}
          >
            {approval.isPending ? "Working…" : "Approve reply"}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          disabled={!publishState.enabled || publish.isPending}
          title={publishState.reason}
          onClick={() => void onPublish()}
        >
          {publish.isPending ? "Publishing…" : "Publish reply"}
        </Button>
      )}

      {deleteState.enabled ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Review actions" />}
          >
            <MoreHorizontalIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setDeleteOpen(true)}>
              Delete published reply
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent aria-label="Delete published reply?">
          <AlertDialogTitle>Delete published reply?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your reply from Google. You can write a new one
            afterwards.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Keep reply
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => void onDelete()}
            >
              Delete reply
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject reverts workflow_status→drafted and clears
          approval_requested_by server-side, so — like Delete — it must be
          confirmed rather than fired straight from the trigger button
          (fix-round-1 IMPORTANT #3). The note is optional and mirrors the
          approval route's accepted length (note ≤2000 chars). */}
      <AlertDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open)
          if (!open) setRejectNote("")
        }}
      >
        <AlertDialogContent aria-label="Reject this reply?">
          <AlertDialogTitle>Reject this reply?</AlertDialogTitle>
          <AlertDialogDescription>
            The draft returns to its author to edit. You can add a note
            explaining why.
          </AlertDialogDescription>
          <label htmlFor="reject-note" className="text-ui font-semibold">
            Note (optional)
          </label>
          <Textarea
            id="reject-note"
            maxLength={2000}
            value={rejectNote}
            onChange={(event) => setRejectNote(event.target.value)}
            placeholder="Explain what needs to change…"
          />
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              size="sm"
              disabled={approval.isPending}
              onClick={() =>
                void onDecision("reject", rejectNote.trim() || undefined)
              }
            >
              Confirm reject
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ActionBar }
