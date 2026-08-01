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
import { useIsDirty } from "@/components/inbox/dirty-context"
import { evaluateApproval, evaluateDelete, evaluatePublish } from "@/lib/inbox/actions"
import { describeActionError } from "@/lib/inbox/action-errors"
import { useApprovalDecision } from "@/lib/queries/use-approval-decision"
import { useDeleteReply } from "@/lib/queries/use-delete-reply"
import { usePublishReview } from "@/lib/queries/use-publish-review"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

const VERIFIED = new Set(["pass", "warn"])

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
    hasPublishedReply: Boolean(review.reply?.body),
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
      toasts.add({
        title:
          result.status === "awaiting_approval"
            ? "Reply submitted for approval."
            : "Reply published",
        type: result.status === "awaiting_approval" ? "info" : "success",
      })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const onDecision = async (decision: "approve" | "reject") => {
    try {
      await approval.mutateAsync({ decision })
      toasts.add({
        title: decision === "approve" ? "Reply published" : "Reply returned to draft.",
        type: "success",
      })
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
            onClick={() => void onDecision("reject")}
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
    </div>
  )
}

export { ActionBar }
