"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  CircleCheckIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
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
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import {
  useAskDiscardConfirm,
  useRegisterDirtyGuard,
} from "@/components/inbox/dirty-context"
import { isReviewWorkflowState } from "@/lib/contracts/reviews"
import { isAllowedReviewTransition } from "@/lib/domain/workflow"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/errors/action-errors"
import { REPLY_FOCUS_EVENT } from "@/lib/inbox/events"
import { actorFor } from "@/lib/inbox/lifecycle"
import { replyWork } from "@/lib/inbox/review-situation"
import { formatRelativeTime } from "@/lib/format"
import {
  useGenerateOrSaveDraft,
  useVerifyDraft,
} from "@/lib/queries/use-draft-mutations"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import type { LatestVerification } from "@/lib/api/reviews"
import { cn } from "@/lib/utils"

const BYTE_LIMIT = 4096
const BYTE_WARN_AT = Math.floor(BYTE_LIMIT * 0.9)

const TONES = [
  { value: "warm_professional", label: "Warm" },
  { value: "concise", label: "Concise" },
  { value: "empathetic", label: "Empathetic" },
] as const

type Tone = (typeof TONES)[number]["value"]

// `review_draft.source` (supabase/migrations/0001_initial.sql). Who wrote the
// words matters when you are about to put them on a public profile under the
// business's name, and the pane never used to say.
const PROVENANCE: Record<string, string> = {
  ai: "Drafted by AI",
  template: "From a template",
  human: "Written by you",
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Reading the reply and editing it are two shapes of one thing, so the line
 * that names it is set once. It used to be the title role in the preview and
 * the smaller UI role in the editor, which made the pane's heading shrink the
 * moment Edit was pressed and everything under it jump up.
 */
const REPLY_HEADING_CLASS = "text-ui font-semibold text-ink"

function saveShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+Enter"
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
    /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "⌘↵"
    : "Ctrl+Enter"
}

function ReplyComposer({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const review = detail.data?.review
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // What is live on Google, and what the newest saved draft says. The composer
  // edits ONE of them: the draft when there is one, otherwise the live reply.
  const latestDraft = review?.drafts[0]
  const { liveBody, draftBody, settled } = replyWork({
    reply: review?.reply ?? null,
    drafts: review?.drafts ?? [],
  })
  const seededBody = draftBody ?? liveBody ?? ""

  const guardKey = `inbox:reply:${reviewId}`
  const fieldId = useId()
  const [body, setBody] = useState("")
  const [tone, setTone] = useState<Tone>("warm_professional")
  const [confirmOpen, setConfirmOpen] = useState(false)
  // The composer opens closed. A saved reply is something to READ first — the
  // pane's job is "is this reply right?", and a textarea answers a different
  // question. Editing is entered deliberately, by Edit or by `r`.
  const [editing, setEditing] = useState(false)
  // Verification produced by THIS session's latest save/verify/generate;
  // null until the user acts, then the persisted review.latestVerification (D3)
  // shows verdict AND reasons on load.
  const [mutationVerification, setMutationVerification] =
    useState<LatestVerification | null>(null)

  const isDirty = body !== seededBody
  const askDiscard = useAskDiscardConfirm()
  const { confirmDiscard, restore } = useDirtyGuard({
    key: guardKey,
    isDirty,
    snapshot: () => body,
    askConfirm: askDiscard,
  })
  useRegisterDirtyGuard(isDirty, confirmDiscard)

  // Seed the textbox once per review, then follow the server only while there
  // is nothing of the operator's own to lose. A stashed draft from a forced
  // sign-out wins over the server body. LLM is never called here — only on
  // Generate.
  const seededReviewRef = useRef<string | null>(null)
  const seededBodyRef = useRef("")
  useEffect(() => {
    if (!review) return
    if (seededReviewRef.current !== reviewId) {
      seededReviewRef.current = reviewId
      const stashed = restore()
      const next = stashed ?? seededBody
      seededBodyRef.current = next
      setBody(next)
      setMutationVerification(null)
      setEditing(false)
      return
    }
    // A newer draft for the review already on screen: someone else saved one,
    // or an approval request re-parked a different reply. Leaving the old
    // text in the box is how an approver reads one reply and approves
    // another. Adopt it only when the box still holds what we last seeded.
    if (
      seededBody !== seededBodyRef.current &&
      (body === seededBodyRef.current || body === seededBody)
    ) {
      seededBodyRef.current = seededBody
      setBody(seededBody)
    }
  }, [body, review, reviewId, restore, seededBody])

  // `r` asks; this decides. The hotkey layer has no idea whether editing is
  // permitted for this review, and it must not: permission lives with the
  // review, not with the keyboard.
  const canOpenEditorRef = useRef(false)
  const editableNow =
    Boolean(review?.capabilities.canEdit) &&
    (!review ||
      !isReviewWorkflowState(review.workflowStatus) ||
      isAllowedReviewTransition(review.workflowStatus, "drafted"))
  useEffect(() => {
    canOpenEditorRef.current = editableNow
  }, [editableNow])
  useEffect(() => {
    function onFocusReply() {
      if (!canOpenEditorRef.current) return
      setEditing(true)
      requestAnimationFrame(() => {
        const field = textareaRef.current
        field?.focus()
        const length = field?.value.length ?? 0
        field?.setSelectionRange(length, length)
      })
    }
    window.addEventListener(REPLY_FOCUS_EVENT, onFocusReply)
    return () => window.removeEventListener(REPLY_FOCUS_EVENT, onFocusReply)
  }, [])

  const generateOrSave = useGenerateOrSaveDraft(reviewId)
  const verify = useVerifyDraft(reviewId)
  const toasts = useToastManager()

  const generateLabel = useMemo(
    () =>
      review && review.drafts.length > 0 ? "Regenerate" : "Generate draft",
    [review]
  )

  async function runGenerate() {
    try {
      // No body → server runs AI (or rating-only template). Manual only.
      const result = await generateOrSave.mutateAsync({ tone })
      setBody(result.body)
      setMutationVerification(result.verification)
      toasts.add({
        title: "Draft ready",
        description: "A fresh reply was generated and verified.",
        type: "success",
      })
      // A generated draft is saved and checked server-side, so it comes back
      // as something to READ. Only keep the caret in the box if the operator
      // was already editing; otherwise leave them in the preview.
      if (editing) {
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
          const length = result.body.length
          textareaRef.current?.setSelectionRange(length, length)
        })
      }
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  function onGenerateClick() {
    if (isDirty) {
      setConfirmOpen(true)
      return
    }
    void runGenerate()
  }

  async function onSave() {
    try {
      const result = await generateOrSave.mutateAsync({ body, tone })
      setMutationVerification(result.verification)
      toasts.add({
        title: "Draft saved",
        description: "Verification ran on your reply.",
        type: "success",
      })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  async function onReverify() {
    if (!latestDraft) return
    try {
      const result = await verify.mutateAsync(latestDraft.id)
      setMutationVerification(result.verification)
      toasts.add({ title: "Reply re-verified", type: "success" })
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
    }
  }

  if (!review) return null
  const canEdit = review.capabilities.canEdit
  // Saving or generating moves the review to `drafted`, and
  // `enforce_review_workflow_transition` has no edge there from
  // `publish_requested`; the route answers 409 `publish_in_progress` rather
  // than letting the trigger raise. Say so before the click, not after — and
  // say it in the words of the reason, not "no permission".
  const canDraft =
    !isReviewWorkflowState(review.workflowStatus) ||
    isAllowedReviewTransition(review.workflowStatus, "drafted")
  // Read first, edit on purpose. A saved reply shows as text whenever there is
  // nothing unsaved to lose — including the ordinary "draft saved, not yet
  // published" case the old pane always opened as a textarea.
  const showPreview = !editing && !isDirty && body.trim() !== ""
  const bytes = byteLength(body)
  const overLimit = bytes > BYTE_LIMIT
  const nearLimit = !overLimit && bytes >= BYTE_WARN_AT
  const canSave =
    canEdit &&
    canDraft &&
    isDirty &&
    body.trim() !== "" &&
    !overLimit &&
    !generateOrSave.isPending
  const canGenerate = canEdit && canDraft && !generateOrSave.isPending
  const displayedVerification =
    mutationVerification ?? review.latestVerification
  const reasons = displayedVerification?.reasons ?? []
  const blocking = reasons.filter((reason) => reason.severity === "fail").length
  const provenance = latestDraft ? PROVENANCE[latestDraft.source] : null
  const shortcut = saveShortcutLabel()

  // Leaving the editor drops unsaved text, so it goes through the same guard
  // as every other navigation that would.
  async function closeEditor() {
    if (isDirty && !(await confirmDiscard())) return
    setBody(seededBody)
    setEditing(false)
  }

  const savedBy = actorFor(review, [
    "review.draft.saved",
    "review.draft.created",
  ])
  const publishedBy = actorFor(review, ["review.reply.published"])
  const publishedAt = review.timeline.find(
    (event) => event.action === "review.reply.published"
  )?.createdAt

  const discardDialog = (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent aria-label="Discard your edits?">
        <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
        <AlertDialogDescription>
          Regenerating replaces your unsaved changes with a new draft. This
          cannot be undone.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>
            Keep editing
          </AlertDialogClose>
          <Button
            onClick={() => {
              setConfirmOpen(false)
              void runGenerate()
            }}
          >
            Discard and regenerate
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const permissionNote = !canEdit ? (
    <p className="text-caption text-ink-muted">
      You can read this reply, but you do not have permission to edit it.
    </p>
  ) : !canDraft ? (
    <p className="text-caption text-ink-muted">
      A publish for this reply is under way. You can edit it again once Google
      answers.
    </p>
  ) : null

  // Reference `.segmented`: tone applies to Generate, so it sits beside it.
  const toneControl = (
    <div
      role="radiogroup"
      aria-label="Reply tone"
      aria-describedby={`${fieldId}-tone-hint`}
      className="inline-flex h-[30px] max-w-full [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-(--np-radius-control) bg-fill p-0.5 pointer-coarse:h-10"
    >
      {TONES.map((option) => {
        const selected = tone === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!canEdit || !canDraft}
            onClick={() => setTone(option.value)}
            className={cn(
              "inline-flex h-full shrink-0 items-center rounded-[6px] px-2.5 text-caption font-semibold whitespace-nowrap focus-halo transition-[background-color,color,box-shadow] duration-(--np-duration-fast) ease-out-strong focus-visible:outline-none disabled:opacity-50",
              selected
                ? "bg-surface text-ink shadow-np-raised"
                : "text-ink-muted hover:text-ink"
            )}
          >
            {option.label}
          </button>
        )
      })}
      <span className="sr-only" id={`${fieldId}-tone-hint`}>
        Tone is used when you generate a draft
      </span>
    </div>
  )

  return (
    <section
      aria-labelledby={`${fieldId}-heading`}
      data-slot="reply-composer"
      // Reference `.composer`: one bordered card whose edge takes the focus
      // ring while the textarea inside is borderless.
      className="flex min-w-0 flex-col rounded-(--np-radius-card) border border-line bg-surface transition-[border-color,box-shadow] duration-(--np-duration-fast) focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--np-accent-tint)]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <h3 id={`${fieldId}-heading`} className={REPLY_HEADING_CLASS}>
          {showPreview
            ? settled
              ? "Published reply"
              : "Your reply"
            : "Write the reply"}
        </h3>
        <span aria-hidden className="flex-1" />
        {toneControl}
        <Button
          variant="secondary"
          size="sm"
          disabled={!canGenerate}
          onClick={onGenerateClick}
        >
          <SparklesIcon aria-hidden data-icon="inline-start" />
          {generateOrSave.isPending ? "Working…" : generateLabel}
        </Button>
        {showPreview ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!canEdit || !canDraft}
            onClick={() => setEditing(true)}
          >
            Edit reply
          </Button>
        ) : latestDraft || liveBody !== null ? (
          <Button variant="ghost" size="sm" onClick={() => void closeEditor()}>
            Close editor
          </Button>
        ) : null}
      </div>

      {permissionNote ? (
        <div className="px-4 pt-3">{permissionNote}</div>
      ) : null}

      {showPreview ? (
        // The reply as words, before any control asks the operator to do
        // something about it.
        <p
          dir="auto"
          lang={review.detectedLanguageCode ?? undefined}
          className="min-h-[120px] px-4 py-3.5 text-[15px] leading-6 whitespace-pre-line text-ink"
        >
          {body}
        </p>
      ) : (
        <Textarea
          ref={textareaRef}
          id={fieldId}
          aria-label="Your reply"
          lang={review.detectedLanguageCode ?? undefined}
          dir="auto"
          value={body}
          readOnly={!canEdit || !canDraft}
          aria-invalid={overLimit || undefined}
          aria-describedby={`${fieldId}-count ${fieldId}-hint`}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "Enter" &&
              canSave
            ) {
              event.preventDefault()
              void onSave()
            }
          }}
          placeholder="Write a reply, or generate one to start."
          className={cn(
            "min-h-[150px] rounded-none border-0 bg-transparent px-4 py-3.5 text-[15px] leading-6 shadow-none read-only:cursor-default read-only:bg-surface-alt focus:shadow-none focus-visible:shadow-none",
            generateOrSave.isPending && "animate-pulse"
          )}
        />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-(--np-radius-card) border-t border-line px-3 py-2 text-caption text-ink-muted">
        <span
          id={`${fieldId}-count`}
          className={cn(
            "font-mono text-[11.5px] tabular-nums",
            overLimit
              ? "font-semibold text-danger-ink"
              : nearLimit
                ? "text-warning-ink"
                : "text-ink-muted"
          )}
        >
          {bytes.toLocaleString("en-GB")} / {BYTE_LIMIT.toLocaleString("en-GB")}{" "}
          bytes
        </span>
        <span role="status" className="sr-only">
          {overLimit
            ? "Your reply is over the 4,096-byte limit."
            : nearLimit
              ? "Your reply is approaching the 4,096-byte limit."
              : ""}
        </span>
        {latestDraft ? (
          <span>
            {provenance ?? "Saved draft"}
            {isDirty ? " · unsaved edits" : ""}
            <span>
              {" "}
              · saved{" "}
              <time
                dateTime={latestDraft.createdAt}
                className="font-mono tabular-nums"
              >
                {formatRelativeTime(latestDraft.createdAt)}
              </time>
              {savedBy ? ` by ${savedBy}` : ""}
            </span>
          </span>
        ) : (
          <span>Not saved · drafts stay in NabaPresence until published</span>
        )}
        {reasons.length > 0 ? (
          <span
            className={cn(
              "font-semibold",
              blocking > 0 ? "text-danger-ink" : "text-warning-ink"
            )}
          >
            {blocking > 0
              ? `${blocking} ${blocking === 1 ? "issue" : "issues"} to fix before publishing`
              : `${reasons.length} ${reasons.length === 1 ? "point" : "points"} to check before publishing`}
          </span>
        ) : settled && !isDirty ? (
          <span className="inline-flex items-center gap-1.5 text-success-ink">
            <CircleCheckIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0"
            />
            In sync with Google
          </span>
        ) : null}
        {publishedAt ? (
          <span>
            Last published{" "}
            <time dateTime={publishedAt} className="font-mono tabular-nums">
              {formatRelativeTime(publishedAt)}
            </time>
            {publishedBy ? ` by ${publishedBy}` : ""}
          </span>
        ) : null}

        <span aria-hidden className="flex-1" />

        {canEdit && canDraft && !showPreview ? (
          <span
            id={`${fieldId}-hint`}
            className="inline-flex items-center gap-1.5 max-sm:hidden"
          >
            <Kbd>{shortcut}</Kbd> save
          </span>
        ) : (
          <span id={`${fieldId}-hint`} className="sr-only" />
        )}

        {latestDraft && !showPreview ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={
              !canEdit ||
              !canDraft ||
              verify.isPending ||
              generateOrSave.isPending
            }
            onClick={() => void onReverify()}
          >
            <ShieldCheckIcon aria-hidden data-icon="inline-start" />
            {verify.isPending ? "Verifying…" : "Re-run checks"}
          </Button>
        ) : null}

        {canEdit && canDraft && isDirty ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={generateOrSave.isPending}
            onClick={() => setBody(seededBody)}
          >
            <RotateCcwIcon aria-hidden data-icon="inline-start" />
            Revert
          </Button>
        ) : null}

        {!showPreview ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!canSave}
            onClick={() => void onSave()}
          >
            Save draft
          </Button>
        ) : null}
      </div>

      {discardDialog}
    </section>
  )
}

export { ReplyComposer }
