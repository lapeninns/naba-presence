"use client"

import { useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  CloudUploadIcon,
  CornerUpLeftIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCwIcon,
  SaveIcon,
  SendHorizonalIcon,
  Trash2Icon,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useOutcomeToast, useToastManager } from "@/components/ui/toast"
import { Textarea } from "@/components/ui/textarea"
import { useComposerSave, useIsDirty } from "@/components/inbox/dirty-context"
import { describeOutcomeToast, evaluateDelete } from "@/lib/inbox/actions"
import {
  derivePrimaryAction,
  publishableDraft,
  resolveApprovalScope,
  type ReplyStateInput,
} from "@/lib/inbox/reply-state"
import { describeActionError } from "@/lib/errors/action-errors"
import { useApprovalDecision } from "@/lib/queries/use-approval-decision"
import { useDeleteReply } from "@/lib/queries/use-delete-reply"
import { useVerifyDraft } from "@/lib/queries/use-draft-mutations"
import { ApiClientError } from "@/lib/api/client"
import { usePublishReview } from "@/lib/queries/use-publish-review"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { isLiveOnGoogle, shownDraft } from "@/lib/inbox/review-situation"
import { publishFailureCause } from "@/lib/inbox/publish-failure"
import {
  isAdvancingOutcome,
  PRIMARY_ACTION_EVENT,
  PUBLISH_PULSE_EVENT,
  REPLY_EDIT_EVENT,
  type PublishPulseDetail,
  type ReplyEditDetail,
} from "@/lib/inbox/events"
import { saveShortcutLabel } from "@/lib/inbox/shortcut-label"

const REJECT_NOTE_LIMIT = 2000

/**
 * The pane's footer actions: ONE filled button for the step the bar exists
 * for (publish, submit, approve, retry), sized to its words at the control
 * height (44px on touch) so the docked bar on a phone stays one row beside
 * the status words. Everything else sits behind the ⋯ menu: Delete always
 * (last, as the danger row, behind a confirm), and Send back below md, where
 * it would crowd the primary off the row; from md up Send back is a quiet
 * button beside Approve. Why a button is off is said by the status line
 * beside it, not hidden in a title attribute.
 *
 * They are drawn for the CHARCOAL bar (D4: the action that reaches Google
 * lives on the one dark bar): the primary keeps the accent fill (its own
 * ink holds ≥5:1 on it), every other control is `ghost-dark`, light ink with
 * the on-charcoal edge, inside the on-charcoal focus outline the bar sets.
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
  // Outcomes go through the typed toast (D5): a Google write's kind can
  // never carry Undo, and "View on Google" is the primitive's own link.
  const outcomeToast = useOutcomeToast()
  // Live composer dirtiness (reactive; only this sibling re-renders on it):
  // with unsaved edits the persisted draft is not what is on screen.
  const isDirty = useIsDirty()
  // While the text on screen is not a checked draft, the composer offers its
  // own save, and Publish runs it first.
  const composerSave = useComposerSave()
  const [deleteOpen, setDeleteOpen] = useState(false)
  // A failed delete is said in the dialog that asked for it, where focus is.
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
  //
  // Who a parked reply waits on comes from the server
  // (`capabilities.approvalScope`, plan D1) and wins inside the ladder; the
  // `canPublish` reading is only the fallback for an older server.
  const stateInput: ReplyStateInput = {
    workflowStatus: review.workflowStatus,
    capabilities: review.capabilities,
    reply: review.reply
      ? { body: review.reply.body, publishStatus: review.reply.publishStatus }
      : null,
    drafts: review.drafts,
    verification: review.latestVerification,
    isDirty,
    approvalScope: review.capabilities.canPublish ? "me" : "others",
  }
  const primary = derivePrimaryAction(stateInput)
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
      // An outcome, never an Undo (D5): a published reply links to the
      // review on Google when the detail carries that link.
      outcomeToast.show(
        describeOutcomeToast(result.status, {
          googleReplyUrl: review.googleReplyUrl,
          googleReplyState: result.googleReplyState,
          requireTwoPersonApproval:
            review.capabilities.requireTwoPersonApproval,
        })
      )
      // `pending` moves on too: Google has the reply, nothing more can be
      // done to it here, and waiting on it left the operator parked on a
      // review whose only button read "Publishing…".
      if (isAdvancingOutcome(result.status)) {
        announceOutcome(result.status, result.googleReplyState)
      }
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  // A reply Google is still checking is announced as sent, not published,
  // as the toast says: the inbox's "Reply published. Now showing …" waits
  // for Google.
  const announceOutcome = (
    status: "published" | "pending",
    googleReplyState?: string | null
  ) => {
    window.dispatchEvent(
      new CustomEvent<PublishPulseDetail>(PUBLISH_PULSE_EVENT, {
        detail: {
          reviewId: review.id,
          status: googleReplyState === "PENDING" ? "pending" : status,
        },
      })
    )
  }

  // A parked reply edited on screen: the composer's own save (the drafts
  // route, as Generate uses from here), which moves it back to a draft and
  // so takes it out of approval. Nothing is approved or sent.
  const onSaveParked = async () => {
    if (!composerSave) return
    const saved = await composerSave.save()
    // A failed save or check is said by the composer, under the reply.
    if (!saved || saved.verification.verdict === "fail") return
    outcomeToast.show({
      kind: "local",
      title: "Edit saved",
      description: "The reply is out of approval and back in Needs reply.",
      type: "success",
    })
  }

  const onDecision = async (decision: "approve" | "reject", note?: string) => {
    // An approval names the draft the composer shows (the parked one) and
    // the review as read, so a pane gone stale is refused (409) rather than
    // approving unseen text.
    const shownDraftId = shownDraft(review)?.id
    if (decision === "approve" && !shownDraftId) return
    try {
      const result = await approval.mutateAsync(
        decision === "approve"
          ? {
              decision,
              draftId: shownDraftId!,
              expectedReviewUpdateTime: review.updateTime,
            }
          : { decision, note }
      )
      outcomeToast.show(
        describeOutcomeToast(result.status, {
          googleReplyUrl: review.googleReplyUrl,
          googleReplyState: result.googleReplyState,
        })
      )
      if (decision === "approve" && isAdvancingOutcome(result.status)) {
        announceOutcome(result.status, result.googleReplyState)
      }
      if (decision === "reject") {
        setRejectOpen(false)
        setRejectNote("")
      }
    } catch (error) {
      // The shared copy for `review_changed` speaks to a composer ("Re-verify
      // the draft"), which an approver does not have. The hook has already
      // reloaded the review (use-approval-decision.ts), so say that.
      const reviewChanged =
        decision === "approve" &&
        error instanceof ApiClientError &&
        error.code === "review_changed"
      toasts.add({
        title: reviewChanged
          ? "The customer changed their review after you opened it. It has been reloaded. Read it, then approve or send back."
          : describeActionError(error),
        type: "error",
      })
    }
  }

  const onDelete = async () => {
    setDeleteError(null)
    try {
      const result = await remove.mutateAsync()
      outcomeToast.show(describeOutcomeToast(result.status))
      setDeleteOpen(false)
    } catch (error) {
      setDeleteError(describeActionError(error))
    }
  }

  const awaitingApproval = primary.kind === "approve"
  // The parked reply opened with Edit reply and changed: what is on screen is
  // no longer the reply waiting, so neither Approve nor Send back is offered
  // (⌘↵ and `a` press the bar's main button, and must not approve text that
  // is no longer shown). The one action is to save the edit, which takes the
  // reply out of approval. Revert brings the parked text, and Approve, back.
  const editingParked = awaitingApproval && isDirty && composerSave !== null
  // A parked reply this person may not decide (the server says it waits on
  // someone else: under two-person approval, the person who asked). The
  // status line says "Waiting for another approver"; there is no Approve or
  // Reject to offer, because the approval route would refuse either.
  const waitingOnOthers =
    awaitingApproval &&
    review.capabilities.approvalScope != null &&
    resolveApprovalScope(stateInput) === "others"
  // Reject follows the scope ("me": this person may decide it); Approve also
  // needs `canApprove`, which the server sets false for the parked draft's
  // author under two-person approval: they may send it back, not approve it.
  // An older server sends no `canApprove`, and Approve follows the scope.
  const offerApprove =
    awaitingApproval && review.capabilities.canApprove !== false
  // D2: a non-publisher in an approval-required org sees "Submit for
  // approval" in place of the (otherwise disabled-for-them) Publish button,
  // and so does a publisher under the two-person rule (plan D1). It reuses
  // the same publish mutation -- the server parks either press as
  // `awaiting_approval` (lib/server/publishing/approval.ts) -- so
  // onPublish/describeOutcomeToast are shared unchanged.
  const offerRequestApproval = primary.kind === "submit"
  // Nothing left to submit: the reply is already with Google (an approver's
  // approval sent it). The status words say so; a disabled "Submit for
  // approval" beside them only asks what to submit. Editing the reply brings
  // the button back.
  const nothingToSubmit = offerRequestApproval && primary.settled
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
    ? review.capabilities.canRequestApproval || review.capabilities.canPublish
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

  // Send back is offered with Approve: inline from md up, in the ⋯ menu below.
  const offerReject =
    awaitingApproval && !inFlight && !waitingOnOthers && !editingParked

  // The parked reply is read-only (it is under review); editing it sends it
  // back to Needs reply, so it is asked for here rather than one tap away.
  const offerEdit =
    awaitingApproval &&
    !inFlight &&
    !editingParked &&
    Boolean(review.capabilities.canEdit)
  // Approve's pending words only while it is Approve that runs.
  const approving =
    approval.isPending && approval.variables?.decision === "approve"

  const shortcutHint = oneStep ? (
    // Desk only: a key hint means nothing to a thumb.
    <Kbd aria-hidden className="ml-1 hidden desk:inline-flex">
      {saveShortcutLabel()}
    </Kbd>
  ) : null

  return (
    <div className="flex min-w-0 items-center justify-end">
      <div className="flex items-center justify-end gap-2">
        {inFlight ? (
          <Button variant="ghost-dark" pending pendingLabel="Publishing…">
            Publishing…
          </Button>
        ) : editingParked ? (
          <Button
            ref={primaryRef}
            disabled={composerSave.blockedReason !== null}
            pending={checking}
            pendingLabel="Saving…"
            onClick={() => void onSaveParked()}
          >
            <SaveIcon aria-hidden strokeWidth={1.75} data-icon="inline-start" />
            Save and take out of approval
          </Button>
        ) : waitingOnOthers ? null : awaitingApproval ? (
          <>
            {/* Beside Approve, Send back sits in ⋯ on a phone; alone (the
                draft's author), it is the bar's one action at every width.
                It is not the `a` shortcut's target: that key approves. */}
            <Button
              variant="ghost-dark"
              className={offerApprove ? "max-md:hidden" : undefined}
              disabled={!primary.enabled || approval.isPending}
              onClick={() => setRejectOpen(true)}
            >
              <CornerUpLeftIcon
                aria-hidden
                strokeWidth={1.75}
                data-icon="inline-start"
              />
              Send back
            </Button>
            {offerApprove ? (
              <Button
                ref={primaryRef}
                disabled={!primary.enabled || approval.isPending}
                onClick={() => void onDecision("approve")}
              >
                <CheckIcon
                  aria-hidden
                  strokeWidth={1.75}
                  data-icon="inline-start"
                />
                {approving ? "Approving…" : "Approve reply"}
              </Button>
            ) : null}
          </>
        ) : nothingToSubmit ? null : offerRequestApproval ? (
          <Button
            ref={primaryRef}
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

        {(offerReject && offerApprove) || offerEdit || deleteState.enabled ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost-dark"
                  size="icon"
                  aria-label="Review actions"
                  // Holding only Send back, the menu is the phone's way to
                  // it; from md up Send back has its own button.
                  className={
                    deleteState.enabled || offerEdit ? undefined : "md:hidden"
                  }
                />
              }
            >
              <MoreHorizontalIcon aria-hidden strokeWidth={1.75} />
            </DropdownMenuTrigger>
            {/* On a phone the menu is the shared bottom action sheet
                (menu-surface): this title over 44px rows, the destructive
                row last in the danger ink after a rule, and a Cancel. */}
            <DropdownMenuContent align="end" side="top" title="Review actions">
              {offerEdit ? (
                <DropdownMenuItem
                  disabled={approval.isPending}
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent<ReplyEditDetail>(REPLY_EDIT_EVENT, {
                        detail: { reviewId },
                      })
                    )
                  }
                >
                  <PencilIcon aria-hidden />
                  Edit reply
                </DropdownMenuItem>
              ) : null}
              {offerReject && offerApprove ? (
                <DropdownMenuItem
                  className="md:hidden"
                  disabled={!primary.enabled || approval.isPending}
                  onClick={() => setRejectOpen(true)}
                >
                  <CornerUpLeftIcon aria-hidden />
                  Send back
                </DropdownMenuItem>
              ) : null}
              {deleteState.enabled ? (
                <>
                  {/* The destructive row comes last, after a rule (phone
                      only: from md the Send back row above it is hidden). */}
                  {offerReject && offerApprove ? (
                    <DropdownMenuSeparator className="md:hidden" />
                  ) : null}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      setDeleteError(null)
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2Icon aria-hidden />
                    Delete published reply
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open)
          if (!open) setDeleteError(null)
        }}
      >
        <AlertDialogContent aria-label="Delete published reply?">
          <AlertDialogTitle>Delete published reply?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes your reply from Google. You can write a new one
            afterwards.
          </AlertDialogDescription>
          {deleteError ? (
            <p
              role="alert"
              data-slot="delete-error"
              className="text-caption text-danger-ink"
            >
              {deleteError}
            </p>
          ) : null}
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

      {/* Send back (the `reject` decision) reverts workflow_status→drafted
          and clears approval_requested_by server-side, so — like Delete —
          it must be confirmed rather than fired straight from the trigger
          button (fix-round-1 IMPORTANT #3). Nothing is destroyed, so the
          confirm is not the danger fill. The note is optional and mirrors
          the approval route's accepted length (note ≤2000 chars). */}
      <AlertDialog
        open={rejectOpen}
        onOpenChange={(open) => {
          setRejectOpen(open)
          if (!open) setRejectNote("")
        }}
      >
        <AlertDialogContent aria-label="Send this reply back?">
          <AlertDialogTitle>Send this reply back?</AlertDialogTitle>
          <AlertDialogDescription>
            It goes back to Needs reply so it can be edited and submitted again.
            Your note is shown on this review, with your name.
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
              placeholder="Say what to change…"
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
              disabled={approval.isPending}
              onClick={() =>
                void onDecision("reject", rejectNote.trim() || undefined)
              }
            >
              {approval.isPending ? "Sending back…" : "Send back"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { ActionBar }
