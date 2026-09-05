"use client"

import { useId, useState } from "react"
import {
  CheckIcon,
  CloudUploadIcon,
  MoreHorizontalIcon,
  SendHorizonalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

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
  evaluateRequestApproval,
} from "@/lib/inbox/actions"
import { describeActionError } from "@/lib/errors/action-errors"
import { useApprovalDecision } from "@/lib/queries/use-approval-decision"
import { useDeleteReply } from "@/lib/queries/use-delete-reply"
import { usePublishReview } from "@/lib/queries/use-publish-review"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { isLiveOnGoogle, replyWork } from "@/lib/inbox/review-situation"
import { PUBLISH_PULSE_EVENT } from "@/lib/inbox/events"

const VERIFIED = new Set(["pass", "warn"])
const REJECT_NOTE_LIMIT = 2000

/**
 * The pane's footer: one filled capsule for the irreversible step (publish,
 * submit, approve), a grey capsule for the way back (reject), and the rest
 * behind an ellipsis. Why a button is off is written next to it, not hidden
 * in a title attribute.
 */
function ActionBar({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const reasonId = useId()
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

  // `replyWork` centralises the "is anything actually pending?" question that
  // the composer, the status strip and this bar all have to agree on — the
  // same `publish_status === 'published'` test that used to live here as a
  // local Set (see supabase/migrations/0001_initial.sql for the full enum;
  // 'accepted' is in-flight, not a confirmed live reply — fix-round-1
  // IMPORTANT #4).
  const work = replyWork(review)

  const verifiedDraft = review.drafts.find(
    (draft) =>
      draft.verificationStatus && VERIFIED.has(draft.verificationStatus)
  )
  const publishState = evaluatePublish({
    status: review.workflowStatus,
    canPublish: review.capabilities.canPublish,
    hasVerifiedDraft: Boolean(verifiedDraft),
    isDirty,
  })
  const requestApprovalState = evaluateRequestApproval({
    status: review.workflowStatus,
    canRequestApproval: review.capabilities.canRequestApproval,
    hasVerifiedDraft: Boolean(verifiedDraft),
    isDirty,
  })
  const approvalState = evaluateApproval({
    status: review.workflowStatus,
    canPublish: review.capabilities.canPublish,
  })
  const deleteState = evaluateDelete({
    // Status, not body: a live reply is deletable even in the (anomalous) case
    // where its text did not come back with the detail payload.
    hasPublishedReply: isLiveOnGoogle(review.reply?.publishStatus),
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
      if (result.status === "published") {
        window.dispatchEvent(
          new CustomEvent(PUBLISH_PULSE_EVENT, {
            detail: { reviewId: review.id },
          })
        )
      }
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const onDecision = async (decision: "approve" | "reject", note?: string) => {
    try {
      const result = await approval.mutateAsync({ decision, note })
      toasts.add(describeOutcomeToast(result.status))
      if (result.status === "published") {
        window.dispatchEvent(
          new CustomEvent(PUBLISH_PULSE_EVENT, {
            detail: { reviewId: review.id },
          })
        )
      }
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
      const result = await remove.mutateAsync()
      toasts.add(describeOutcomeToast(result.status))
      setDeleteOpen(false)
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const awaitingApproval = review.workflowStatus === "awaiting_approval"
  // D2: a non-publisher in an approval-required org sees "Submit for
  // approval" in place of the (otherwise disabled-for-them) Publish button.
  // It reuses the same publish mutation -- the server routes a
  // non-publisher's publish to `awaiting_approval` (lib/server/publishing.ts)
  // -- so onPublish/describeOutcomeToast are shared unchanged.
  const offerRequestApproval =
    !review.capabilities.canPublish && review.capabilities.canRequestApproval

  // Nothing new to send: the live reply and the newest draft are the same
  // words. The button stays in place (the composer edits the live text
  // directly, so it becomes available the moment that text changes) but it is
  // off, because re-sending identical words is a pointless round-trip the
  // domain does not even allow a transition for.
  // `work` is server state, so it still reads "settled" while the composer
  // holds unsaved edits — without the dirty check the footer would tell you to
  // edit a reply you are in the middle of editing.
  const nothingToPublish = work.settled && !isDirty && !awaitingApproval
  // "Publish" is the wrong verb once something is already on Google.
  const publishLabel = work.liveBody !== null ? "Update reply" : "Publish reply"
  const primaryState = awaitingApproval
    ? approvalState
    : offerRequestApproval
      ? requestApprovalState
      : publishState
  // The reason a button is off was previously only in `title` — invisible on
  // touch, and to most keyboard and screen-reader users. It is now text.
  const blockedReason = nothingToPublish
    ? "Edit the reply above to publish a change."
    : !primaryState.enabled
      ? primaryState.reason
      : undefined

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {blockedReason ? (
        <p id={reasonId} className="min-w-0 flex-1 text-caption text-ink-muted">
          {blockedReason}
        </p>
      ) : null}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {awaitingApproval ? (
          <>
            <Button
              variant="secondary"
              pill
              disabled={!approvalState.enabled || approval.isPending}
              title={approvalState.reason}
              aria-describedby={blockedReason ? reasonId : undefined}
              onClick={() => setRejectOpen(true)}
            >
              <XIcon aria-hidden strokeWidth={1.75} data-icon="inline-start" />
              Reject reply
            </Button>
            <Button
              pill
              disabled={!approvalState.enabled || approval.isPending}
              title={approvalState.reason}
              aria-describedby={blockedReason ? reasonId : undefined}
              onClick={() => void onDecision("approve")}
            >
              <CheckIcon
                aria-hidden
                strokeWidth={1.75}
                data-icon="inline-start"
              />
              {approval.isPending ? "Approving…" : "Approve reply"}
            </Button>
          </>
        ) : offerRequestApproval ? (
          <Button
            pill
            disabled={
              nothingToPublish ||
              !requestApprovalState.enabled ||
              publish.isPending
            }
            title={blockedReason ?? requestApprovalState.reason}
            aria-describedby={blockedReason ? reasonId : undefined}
            onClick={() => void onPublish()}
          >
            <SendHorizonalIcon
              aria-hidden
              strokeWidth={1.75}
              data-icon="inline-start"
            />
            {publish.isPending ? "Submitting…" : "Submit for approval"}
          </Button>
        ) : (
          <Button
            pill
            disabled={
              nothingToPublish || !publishState.enabled || publish.isPending
            }
            title={blockedReason ?? publishState.reason}
            aria-describedby={blockedReason ? reasonId : undefined}
            onClick={() => void onPublish()}
          >
            <CloudUploadIcon
              aria-hidden
              strokeWidth={1.75}
              data-icon="inline-start"
            />
            {publish.isPending ? "Publishing…" : publishLabel}
          </Button>
        )}

        {deleteState.enabled ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  pill
                  aria-label="Review actions"
                />
              }
            >
              <MoreHorizontalIcon aria-hidden strokeWidth={1.75} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2Icon aria-hidden />
                Delete published reply
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent aria-label="Delete published reply?">
          <AlertDialogTitle>Delete published reply?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your reply from Google. You can write a new one
            afterwards.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              Keep reply
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => void onDelete()}
            >
              {remove.isPending ? "Deleting…" : "Delete reply"}
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
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="reject-note"
              className="text-ui font-medium text-ink"
            >
              Note (optional)
            </label>
            <Textarea
              id="reject-note"
              maxLength={REJECT_NOTE_LIMIT}
              value={rejectNote}
              onChange={(event) => setRejectNote(event.target.value)}
              placeholder="Explain what needs to change…"
            />
            <p className="text-caption text-ink-muted tabular-nums">
              {rejectNote.length.toLocaleString("en-GB")} /{" "}
              {REJECT_NOTE_LIMIT.toLocaleString("en-GB")}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={approval.isPending}
              onClick={() =>
                void onDecision("reject", rejectNote.trim() || undefined)
              }
            >
              {approval.isPending ? "Rejecting…" : "Confirm reject"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ActionBar }
