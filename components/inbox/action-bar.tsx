"use client"

import { useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  CloudUploadIcon,
  MoreHorizontalIcon,
  RotateCwIcon,
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
import { Kbd } from "@/components/ui/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToastManager } from "@/components/ui/toast"
import { Textarea } from "@/components/ui/textarea"
import { useComposerSave, useIsDirty } from "@/components/inbox/dirty-context"
import { describeOutcomeToast, evaluateDelete } from "@/lib/inbox/actions"
import { derivePrimaryAction, publishableDraft } from "@/lib/inbox/reply-state"
import { describeActionError } from "@/lib/errors/action-errors"
import { useApprovalDecision } from "@/lib/queries/use-approval-decision"
import { useDeleteReply } from "@/lib/queries/use-delete-reply"
import { useVerifyDraft } from "@/lib/queries/use-draft-mutations"
import { ApiClientError } from "@/lib/api/client"
import { usePublishReview } from "@/lib/queries/use-publish-review"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { isLiveOnGoogle } from "@/lib/inbox/review-situation"
import { publishFailureCause } from "@/lib/inbox/publish-failure"
import {
  isAdvancingOutcome,
  PRIMARY_ACTION_EVENT,
  PUBLISH_PULSE_EVENT,
  type PublishPulseDetail,
} from "@/lib/inbox/events"
import { saveShortcutLabel } from "@/lib/inbox/shortcut-label"

const REJECT_NOTE_LIMIT = 2000

// On a phone the step the bar exists for fills the row at a 48px thumb
// height (reference `.publish .btn`).
const PRIMARY_CLASS = "max-md:h-12 max-md:flex-1"

/**
 * The pane's footer: one filled capsule for the irreversible step (publish,
 * submit, approve), a grey capsule for the way back (reject), and the rest
 * behind an ellipsis. Why a button is off is said by the status line beside
 * it, not hidden in a title attribute.
 *
 * Publish is one press: when the text on screen is not yet a checked draft,
 * it saves it (the drafts route checks what it stores), stops if the check
 * fails, and otherwise publishes the draft that save returned.
 */
function ActionBar({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const publish = usePublishReview(reviewId)
  const verify = useVerifyDraft(reviewId)
  const approval = useApprovalDecision(reviewId)
  const remove = useDeleteReply(reviewId)
  const toasts = useToastManager()
  // Live composer dirtiness (reactive; only this sibling re-renders on it):
  // with unsaved edits the persisted draft is not what is on screen.
  const isDirty = useIsDirty()
  // While the text on screen is not a checked draft, the composer offers its
  // own save, and Publish runs it first.
  const composerSave = useComposerSave()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState("")

  // `a` presses whichever button is the bar's main one — by clicking it, so a
  // key can never do what the button, as it stands, would not.
  const primaryRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    function onPrimaryAction() {
      const button = primaryRef.current
      if (
        !button ||
        button.disabled ||
        button.getAttribute("aria-disabled") === "true" ||
        button.getAttribute("aria-busy") === "true"
      ) {
        return
      }
      button.click()
    }
    window.addEventListener(PRIMARY_ACTION_EVENT, onPrimaryAction)
    return () =>
      window.removeEventListener(PRIMARY_ACTION_EVENT, onPrimaryAction)
  }, [])

  const review = detail.data?.review
  if (!review) return null

  // The NEWEST draft, and only when it is verified. The old `drafts.find(…)`
  // took the first verified draft anywhere in the list, so a review whose
  // newest draft was unverified could enable Publish and then send the OLDER
  // text — which is not what the composer above was showing. See
  // lib/inbox/reply-state.ts.
  const verifiedDraft = publishableDraft(review.drafts)
  // ONE derivation, shared with the status line above the reply, so the two
  // can never contradict each other (requirement: status and action
  // eligibility stay consistent).
  const primary = derivePrimaryAction({
    workflowStatus: review.workflowStatus,
    capabilities: review.capabilities,
    reply: review.reply
      ? { body: review.reply.body, publishStatus: review.reply.publishStatus }
      : null,
    drafts: review.drafts,
    verification: review.latestVerification,
    isDirty,
    approvalScope: review.capabilities.canPublish ? "me" : "others",
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
    // Save and check first when the text on screen is not a checked draft.
    // A failed save or a failed check stops here; the composer says why.
    const saved = composerSave ? await composerSave.save() : null
    if (composerSave && !saved) return
    if (saved?.verification.verdict === "fail") return
    const draftId = saved?.draftId ?? verifiedDraft?.id
    if (!draftId) return
    try {
      let result
      try {
        result = await publish.mutateAsync({
          draftId,
          // The Google review's own update time, which saving a draft does
          // not touch; the server refuses the publish if Google changed the
          // review.
          expectedReviewUpdateTime: review.updateTime,
        })
      } catch (error) {
        // The customer changed the review after this reply was checked. The
        // one-press flow re-checks the same text against the review as it
        // stands now and, if it still passes, publishes once more; there is
        // no separate Re-verify control to send the operator to.
        if (
          !(error instanceof ApiClientError) ||
          error.code !== "stale_draft_evidence"
        ) {
          throw error
        }
        const { verification } = await verify.mutateAsync(draftId)
        if (verification.verdict === "fail") {
          toasts.add({
            title:
              "The review changed and this reply no longer passes the checks. Edit it, then publish again.",
            type: "error",
          })
          return
        }
        const fresh = await detail.refetch()
        result = await publish.mutateAsync({
          draftId,
          expectedReviewUpdateTime:
            fresh.data?.review.updateTime ?? review.updateTime,
        })
      }
      // Server-confirmed only (D7): the resolved status — never a thrown
      // ApiClientError — decides the toast, so a `rejected` (Google declined
      // the reply) or any other non-published outcome can never render as
      // "published" (fix-round-1 CRITICAL #1).
      toasts.add(describeOutcomeToast(result.status))
      // `pending` moves on too: Google has the reply, nothing more can be
      // done to it here, and waiting on it left the operator parked on a
      // review whose only button read "Publishing…".
      if (isAdvancingOutcome(result.status)) announceOutcome(result.status)
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  const announceOutcome = (status: "published" | "pending") => {
    window.dispatchEvent(
      new CustomEvent<PublishPulseDetail>(PUBLISH_PULSE_EVENT, {
        detail: { reviewId: review.id, status },
      })
    )
  }

  const onDecision = async (decision: "approve" | "reject", note?: string) => {
    try {
      const result = await approval.mutateAsync({ decision, note })
      toasts.add(describeOutcomeToast(result.status))
      if (decision === "approve" && isAdvancingOutcome(result.status)) {
        announceOutcome(result.status)
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

  const awaitingApproval = primary.kind === "approve"
  // D2: a non-publisher in an approval-required org sees "Submit for
  // approval" in place of the (otherwise disabled-for-them) Publish button.
  // It reuses the same publish mutation -- the server routes a
  // non-publisher's publish to `awaiting_approval` (lib/server/publishing.ts)
  // -- so onPublish/describeOutcomeToast are shared unchanged.
  const offerRequestApproval = primary.kind === "submit"
  // A publish already with Google: nothing to press until it answers.
  const inFlight = review.workflowStatus === "publish_requested"
  // Unsaved edits (or an unchecked draft) in front of a publish or a submit:
  // the press saves and checks them first. An approval is decided on the
  // saved reply whatever the composer holds, so it keeps its Approve.
  const oneStep = !inFlight && !awaitingApproval && composerSave !== null
  // The ladder blocks on unsaved edits because the saved draft is not what
  // is on screen; one-step Publish saves them, so only the permission and
  // the composer's own reasons (empty, too long) still apply.
  const permitted = offerRequestApproval
    ? review.capabilities.canRequestApproval
    : review.capabilities.canPublish
  const sendEnabled = oneStep
    ? permitted && composerSave.blockedReason === null
    : primary.enabled
  const checking = (composerSave?.saving ?? false) || verify.isPending
  const sending = checking || publish.isPending

  // A failed publish is retried with the same verified draft: the same
  // mutation, named for what it does from here. Not when Google refused the
  // words — sending them again unchanged is not a retry, and the exception
  // above says to edit them.
  const retry =
    review.workflowStatus === "failed" &&
    publishFailureCause(review.reply) !== "content" &&
    !oneStep &&
    (primary.kind === "publish" || primary.kind === "update")

  const shortcutHint = oneStep ? (
    <Kbd aria-hidden className="ml-1 max-md:hidden pointer-coarse:hidden">
      {saveShortcutLabel()}
    </Kbd>
  ) : null

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 max-md:w-full">
      <div className="flex flex-wrap items-center justify-end gap-2 max-md:w-full">
        {inFlight ? (
          <Button
            variant="secondary"
            pending
            pendingLabel="Publishing…"
            className={PRIMARY_CLASS}
          >
            Publishing…
          </Button>
        ) : awaitingApproval ? (
          <>
            <Button
              variant="secondary"
              className={PRIMARY_CLASS}
              disabled={!primary.enabled || approval.isPending}
              onClick={() => setRejectOpen(true)}
            >
              <XIcon aria-hidden strokeWidth={1.75} data-icon="inline-start" />
              Reject reply
            </Button>
            <Button
              ref={primaryRef}
              className={PRIMARY_CLASS}
              disabled={!primary.enabled || approval.isPending}
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
            ref={primaryRef}
            className={PRIMARY_CLASS}
            disabled={!sendEnabled}
            pending={sending}
            pendingLabel={checking ? "Checking…" : "Submitting…"}
            onClick={() => void onPublish()}
          >
            <SendHorizonalIcon
              aria-hidden
              strokeWidth={1.75}
              data-icon="inline-start"
            />
            Submit for approval
            {shortcutHint}
          </Button>
        ) : (
          <Button
            ref={primaryRef}
            className={PRIMARY_CLASS}
            disabled={!sendEnabled}
            pending={sending}
            pendingLabel={checking ? "Checking…" : "Publishing…"}
            onClick={() => void onPublish()}
          >
            {retry ? (
              <RotateCwIcon
                aria-hidden
                strokeWidth={1.75}
                data-icon="inline-start"
              />
            ) : (
              <CloudUploadIcon
                aria-hidden
                strokeWidth={1.75}
                data-icon="inline-start"
              />
            )}
            {retry ? "Retry publish" : primary.label}
            {shortcutHint}
          </Button>
        )}

        {deleteState.enabled ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
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
              variant="danger"
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
              variant="danger"
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
