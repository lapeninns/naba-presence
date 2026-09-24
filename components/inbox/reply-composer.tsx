"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  CircleAlertIcon,
  InfoIcon,
  PenLineIcon,
  RotateCcwIcon,
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
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import {
  useAskDiscardConfirm,
  useRegisterDirtyGuard,
  type ComposerSaveResult,
} from "@/components/inbox/dirty-context"
import { isReviewWorkflowState } from "@/lib/contracts/reviews"
import { isAllowedReviewTransition } from "@/lib/domain/workflow"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  PRIMARY_ACTION_EVENT,
  REPLY_FOCUS_EVENT,
  REPLY_GENERATE_EVENT,
} from "@/lib/inbox/events"
import { hasVerifiedDraft } from "@/lib/inbox/reply-state"
import { replyWork } from "@/lib/inbox/review-situation"
import { useGenerateOrSaveDraft } from "@/lib/queries/use-draft-mutations"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import type { LatestVerification } from "@/lib/api/reviews"
import { cn } from "@/lib/utils"

const BYTE_LIMIT = 4096
// The count only appears once it matters: a running "212 / 4,096 bytes"
// under every reply was a number nobody needed, in a unit nobody writes in.
const BYTE_WARN_AT = Math.floor(BYTE_LIMIT * 0.8)

const TONES = [
  {
    value: "warm_professional",
    label: "Warm",
    hint: "Friendly and personal. Thanks them by name and invites them back.",
  },
  {
    value: "concise",
    label: "Concise",
    hint: "Short and polite. Two sentences, no more.",
  },
  {
    value: "empathetic",
    label: "Empathetic",
    hint: "Acknowledges how they felt before anything else.",
  },
] as const

type Tone = (typeof TONES)[number]["value"]

const DEFAULT_TONE: Tone = "warm_professional"

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function ReplyComposer({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const review = detail.data?.review
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // What is live on Google, and what the newest saved draft says. The editor
  // holds ONE of them: the draft when there is one, otherwise the live reply.
  const latestDraft = review?.drafts[0]
  const { liveBody, draftBody } = replyWork({
    reply: review?.reply ?? null,
    drafts: review?.drafts ?? [],
  })
  const seededBody = draftBody ?? liveBody ?? ""

  const guardKey = `inbox:reply:${reviewId}`
  const fieldId = useId()
  const [body, setBody] = useState("")
  const [tone, setTone] = useState<Tone>(DEFAULT_TONE)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // The tone a regenerate waits on while the discard confirm is open.
  const [pendingTone, setPendingTone] = useState<Tone | null>(null)
  // A failed generation, said where it happened, with the two ways on.
  const [generateError, setGenerateError] = useState<{
    message: string
    tone: Tone
  } | null>(null)
  // Verification produced by THIS session's latest save or generate; until
  // then the persisted review.latestVerification stands.
  const [mutationVerification, setMutationVerification] =
    useState<LatestVerification | null>(null)
  // The checks' verdict is about the text that was checked. Typing makes it
  // stale, so the message under the editor goes until the next check.
  const [verdictStale, setVerdictStale] = useState(false)
  const [saving, setSaving] = useState(false)

  const isDirty = body !== seededBody
  const askDiscard = useAskDiscardConfirm()
  const { confirmDiscard, restore } = useDirtyGuard({
    key: guardKey,
    isDirty,
    snapshot: () => body,
    askConfirm: askDiscard,
  })

  // Seed the textbox once per review, then follow the server only while there
  // is nothing of the operator's own to lose. A stashed draft from a forced
  // sign-out wins over the server body. LLM is never called here — only on
  // Generate.
  const seededReviewRef = useRef<string | null>(null)
  const seededBodyRef = useRef("")
  // Text an Undo put back, which a newer draft must not replace.
  const restoredBodyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!review) return
    if (seededReviewRef.current !== reviewId) {
      seededReviewRef.current = reviewId
      const stashed = restore()
      const next = stashed ?? seededBody
      seededBodyRef.current = next
      setBody(next)
      setMutationVerification(null)
      setVerdictStale(false)
      return
    }
    // A newer draft for the review already on screen: someone else saved one,
    // or an approval request re-parked a different reply. Leaving the old
    // text in the box is how an approver reads one reply and approves
    // another. Adopt it only when the box still holds what we last seeded.
    if (
      seededBody !== seededBodyRef.current &&
      (body === seededBodyRef.current || body === seededBody) &&
      body !== restoredBodyRef.current
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
      const field = textareaRef.current
      field?.focus()
      const length = field?.value.length ?? 0
      field?.setSelectionRange(length, length)
    }
    window.addEventListener(REPLY_FOCUS_EVENT, onFocusReply)
    return () => window.removeEventListener(REPLY_FOCUS_EVENT, onFocusReply)
  }, [])

  const generateOrSave = useGenerateOrSaveDraft(reviewId)
  const toasts = useToastManager()

  // The publish bar's Publish runs this composer's own save first, through
  // the dirty store it already reads, then publishes the draft it returns.
  // It is offered while the text on screen is not yet a checked draft: there
  // are unsaved edits, or the newest saved draft was never checked. Why it
  // cannot run is said in words on the bar.
  const saveBlocked = !editableNow
    ? review?.capabilities.canEdit
      ? "A publish for this reply is under way."
      : "You do not have permission to edit this reply."
    : body.trim() === ""
      ? "Write the reply before publishing it."
      : byteLength(body) > BYTE_LIMIT
        ? "Shorten the reply to fit Google's length limit."
        : null
  const uncheckedDraft =
    latestDraft !== undefined &&
    latestDraft.verificationStatus !== "fail" &&
    !hasVerifiedDraft(review?.drafts ?? [])
  const offerSave = isDirty || uncheckedDraft
  const saveRef = useRef<() => Promise<ComposerSaveResult | null>>(
    async () => null
  )
  const runSave = useCallback(() => saveRef.current(), [])
  useRegisterDirtyGuard(
    isDirty,
    confirmDiscard,
    offerSave
      ? { save: runSave, blockedReason: saveBlocked, saving }
      : undefined
  )

  // `g`: a first draft in the chosen tone, when there is nothing to lose —
  // no saved draft, no live reply and nothing typed. Like `r`, the key only
  // asks; whether it is allowed is decided here.
  const generateRef = useRef<() => void>(() => {})
  useEffect(() => {
    saveRef.current = async () => {
      if (saveBlocked || generateOrSave.isPending || saving) return null
      return onSave()
    }
    generateRef.current = () => {
      if (!editableNow || generateOrSave.isPending || !review) return
      if (review.drafts.length > 0 || liveBody !== null || body !== "") return
      void runGenerate(tone)
    }
  })
  useEffect(() => {
    const onGenerate = () => generateRef.current()
    window.addEventListener(REPLY_GENERATE_EVENT, onGenerate)
    return () => window.removeEventListener(REPLY_GENERATE_EVENT, onGenerate)
  }, [])

  function focusEditor() {
    requestAnimationFrame(() => {
      const field = textareaRef.current
      field?.focus()
      const length = field?.value.length ?? 0
      field?.setSelectionRange(length, length)
    })
  }

  async function runGenerate(withTone: Tone = tone) {
    // What the box held, so a regenerate over it can be taken back.
    const previous = body
    setGenerateError(null)
    try {
      // No body → server runs AI (or rating-only template). Manual only.
      const result = await generateOrSave.mutateAsync({ tone: withTone })
      setBody(result.body)
      setMutationVerification(result.verification)
      setVerdictStale(false)
      const restorable =
        previous.trim() !== "" && previous !== result.body ? previous : null
      toasts.add({
        title: "Reply ready",
        description: restorable
          ? "A fresh reply replaced the previous text. Undo puts it back as an unsaved edit."
          : "A fresh reply was written and checked.",
        type: "success",
        ...(restorable
          ? {
              actionProps: {
                children: "Undo",
                onClick: () => {
                  // Held against the adopt-a-newer-draft rule above: the
                  // refetch carrying the regenerated draft may land after
                  // this, and must not take the restored text back.
                  restoredBodyRef.current = restorable
                  setBody(restorable)
                  setVerdictStale(true)
                },
              },
            }
          : {}),
      })
    } catch (error) {
      setGenerateError({ message: describeActionError(error), tone: withTone })
    }
  }

  function onGenerateClick() {
    if (isDirty && body.trim() !== "") {
      setPendingTone(tone)
      setConfirmOpen(true)
      return
    }
    void runGenerate()
  }

  // With a reply in the box, choosing a tone is asking for it in that tone,
  // so it regenerates — through the same discard confirm when there are
  // unsaved edits. With an empty box it only sets the tone Generate uses.
  function onToneChoose(next: Tone) {
    if (next === tone || generateOrSave.isPending) return
    if (body.trim() === "") {
      setTone(next)
      return
    }
    if (isDirty) {
      setPendingTone(next)
      setConfirmOpen(true)
      return
    }
    setTone(next)
    void runGenerate(next)
  }

  function writeOwn() {
    setGenerateError(null)
    focusEditor()
  }

  // Saves AND checks: the drafts route verifies what it stores. A failed
  // check is said under the editor, where the fix is made.
  async function onSave(): Promise<ComposerSaveResult | null> {
    setSaving(true)
    try {
      const result = await generateOrSave.mutateAsync({ body, tone })
      setMutationVerification(result.verification)
      setVerdictStale(false)
      if (result.verification.verdict === "fail") focusEditor()
      return { draftId: result.draftId, verification: result.verification }
    } catch (error) {
      toasts.add({ title: describeActionError(error), type: "error" })
      return null
    } finally {
      setSaving(false)
    }
  }

  if (!review) return null
  const canEdit = review.capabilities.canEdit
  // Saving or generating moves the review to `drafted`, and
  // `enforce_review_workflow_transition` has no edge there from
  // `publish_requested`; the route answers 409 `publish_in_progress` rather
  // than letting the trigger raise. The editor is read-only until it lands.
  const canDraft =
    !isReviewWorkflowState(review.workflowStatus) ||
    isAllowedReviewTransition(review.workflowStatus, "drafted")
  const editable = canEdit && canDraft
  const bytes = byteLength(body)
  const overLimit = bytes > BYTE_LIMIT
  const nearLimit = !overLimit && bytes >= BYTE_WARN_AT
  const canGenerate = editable && !generateOrSave.isPending
  const verification = verdictStale
    ? null
    : (mutationVerification ?? review.latestVerification)
  const failing =
    verification?.verdict === "fail"
      ? verification.reasons.filter((reason) => reason.severity === "fail")
      : []
  const warnings =
    verification?.verdict === "warn"
      ? verification.reasons.filter((reason) => reason.severity === "warn")
      : []
  const showFail = verification?.verdict === "fail"
  const empty = body.trim() === ""

  const discardDialog = (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent aria-label="Discard your edits?">
        <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
        <AlertDialogDescription>
          Regenerating replaces your unsaved changes with a new reply. You can
          undo it straight afterwards.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="secondary" />}>
            Keep editing
          </AlertDialogClose>
          <Button
            onClick={() => {
              const next = pendingTone ?? tone
              setConfirmOpen(false)
              setPendingTone(null)
              setTone(next)
              void runGenerate(next)
            }}
          >
            Discard and regenerate
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const generateErrorNote = generateError ? (
    <div
      role="alert"
      data-slot="generate-error"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-(--np-radius-control) bg-danger-tint px-3 py-2 text-caption text-ink"
    >
      <CircleAlertIcon
        aria-hidden
        strokeWidth={1.75}
        className="size-4 shrink-0 text-danger-ink"
      />
      <span className="min-w-0 flex-[1_1_200px]">
        <strong className="font-semibold">No reply was generated.</strong>{" "}
        {generateError.message}
      </span>
      <span className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={generateOrSave.isPending}
          onClick={() => void runGenerate(generateError.tone)}
        >
          Retry
        </Button>
        <Button variant="ghost" size="sm" onClick={writeOwn}>
          <PenLineIcon aria-hidden data-icon="inline-start" />
          Write my own
        </Button>
      </span>
    </div>
  ) : null

  // Tone applies to Generate, so it sits beside it.
  const toneControl = (
    <div
      role="radiogroup"
      aria-label="Reply tone"
      className="inline-flex h-[34px] max-w-full [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-[9px] border border-line bg-canvas p-0.5 @max-[480px]/detail:h-10 @max-[480px]/detail:flex-[1_1_100%] pointer-coarse:h-10"
    >
      {TONES.map((option) => {
        const selected = tone === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.hint}
            aria-describedby={`${fieldId}-${option.value}-hint`}
            disabled={!editable || generateOrSave.isPending}
            onClick={() => onToneChoose(option.value)}
            className={cn(
              "inline-flex h-full shrink-0 items-center justify-center rounded-[7px] px-2.5 text-[13px] whitespace-nowrap focus-halo transition-[background-color,color] duration-(--np-duration-fast) ease-out-strong focus-visible:outline-none disabled:opacity-50 @max-[480px]/detail:flex-1",
              selected
                ? "bg-ink font-semibold text-canvas"
                : "text-ink-secondary hover:bg-fill hover:text-ink"
            )}
          >
            {option.label}
          </button>
        )
      })}
      {/* Outside the radios, so each is named by its label alone and
          described by its hint. */}
      {TONES.map((option) => (
        <span
          key={option.value}
          id={`${fieldId}-${option.value}-hint`}
          className="sr-only"
        >
          {option.hint}
        </span>
      ))}
    </div>
  )

  return (
    <div data-slot="reply-composer" className="flex min-w-0 flex-col gap-2">
      <label htmlFor={fieldId} className="text-ui font-semibold text-ink">
        Your reply
      </label>
      {generateErrorNote}

      {/* One bordered card whose edge takes the focus ring while the
          textarea inside is borderless, with the tone and Generate on a bar
          beneath the words. */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface-sunken transition-[border-color,box-shadow] duration-(--np-duration-fast) focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_var(--np-fill)] has-[[aria-invalid=true]]:border-danger-ink">
        <Textarea
          ref={textareaRef}
          id={fieldId}
          lang={review.detectedLanguageCode ?? undefined}
          dir="auto"
          value={body}
          readOnly={!editable}
          aria-invalid={overLimit || showFail || undefined}
          aria-describedby={
            [
              showFail ? `${fieldId}-problem` : null,
              nearLimit || overLimit ? `${fieldId}-count` : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-keyshortcuts="Meta+Enter Control+Enter"
          onChange={(event) => {
            setBody(event.target.value)
            setVerdictStale(true)
          }}
          onKeyDown={(event) => {
            // The key does exactly what the publish bar's button does, by
            // asking the bar to press it.
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault()
              window.dispatchEvent(new Event(PRIMARY_ACTION_EVENT))
            }
          }}
          placeholder="Write a reply, or generate one below."
          className={cn(
            "min-h-[128px] rounded-none border-0 bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed shadow-none read-only:cursor-default focus:shadow-none focus-visible:shadow-none",
            generateOrSave.isPending && !saving && "animate-pulse"
          )}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-2.5 py-2">
          {toneControl}
          <Button
            variant="secondary"
            size="sm"
            disabled={!canGenerate}
            pending={generateOrSave.isPending && !saving}
            pendingLabel="Writing…"
            onClick={onGenerateClick}
          >
            <SparklesIcon aria-hidden data-icon="inline-start" />
            {empty ? "Generate reply" : "Regenerate"}
          </Button>
          {editable && isDirty && seededBody !== "" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={generateOrSave.isPending}
              onClick={() => {
                setBody(seededBody)
                setVerdictStale(false)
              }}
            >
              <RotateCcwIcon aria-hidden data-icon="inline-start" />
              Revert
            </Button>
          ) : null}
          <span aria-hidden className="flex-1" />
          {nearLimit || overLimit ? (
            <span
              id={`${fieldId}-count`}
              data-slot="length-note"
              className={cn(
                "text-caption",
                overLimit ? "font-semibold text-danger-ink" : "text-warning-ink"
              )}
            >
              {overLimit
                ? `Over Google's length limit · ${bytes.toLocaleString("en-GB")} of ${BYTE_LIMIT.toLocaleString("en-GB")} bytes`
                : `Nearly at Google's length limit · ${bytes.toLocaleString("en-GB")} of ${BYTE_LIMIT.toLocaleString("en-GB")} bytes`}
            </span>
          ) : null}
          <span role="status" className="sr-only">
            {overLimit
              ? "Your reply is over Google's length limit."
              : nearLimit
                ? "Your reply is nearly at Google's length limit."
                : ""}
          </span>
        </div>
      </div>

      {showFail ? (
        <p
          id={`${fieldId}-problem`}
          role="alert"
          data-slot="reply-problem"
          className="flex items-start gap-2 rounded-(--np-radius-control) bg-danger-tint px-3 py-2 text-caption text-ink"
        >
          <CircleAlertIcon
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-4 shrink-0 text-danger-ink"
          />
          <span>
            <strong className="font-semibold">Can&rsquo;t publish yet.</strong>{" "}
            {failing.map((reason) => reason.message).join(" ")} Edit the reply
            and try again.
          </span>
        </p>
      ) : warnings.length > 0 ? (
        <p
          data-slot="reply-note"
          className="flex items-start gap-1.5 text-caption text-ink-muted"
        >
          <InfoIcon
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-3.5 shrink-0"
          />
          <span>{warnings.map((reason) => reason.message).join(" ")}</span>
        </p>
      ) : null}

      {discardDialog}
    </div>
  )
}

export { ReplyComposer }
