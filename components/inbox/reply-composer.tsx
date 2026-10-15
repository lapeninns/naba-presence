"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
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
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import {
  useAskDiscardConfirm,
  useRegisterDirtyGuard,
  type ComposerSaveResult,
} from "@/components/inbox/dirty-context"
import { isReviewWorkflowState } from "@/lib/contracts/reviews"
import { isAllowedReviewTransition } from "@/lib/domain/workflow"
import { useDraftKey } from "@/lib/editors/use-draft-key"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  PRIMARY_ACTION_EVENT,
  REPLY_EDIT_EVENT,
  REPLY_FOCUS_EVENT,
  REPLY_GENERATE_EVENT,
  type ReplyEditDetail,
} from "@/lib/inbox/events"
import { greetingName, replyGuidance } from "@/lib/inbox/reply-guidance"
import { hasVerifiedDraft } from "@/lib/inbox/reply-state"
import { replyWork } from "@/lib/inbox/review-situation"
import {
  aiCreditsBlocked,
  describeCreditsLeft,
} from "@/lib/contracts/ai-credits"
import { isAiCreditsExhausted } from "@/lib/api/ai-credits"
import { useAiCredits } from "@/lib/queries/use-ai-credits"
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
    // An approver reads the parked draft, not a newer one.
    workflowStatus: review?.workflowStatus,
    pendingDraft: review?.pendingDraft,
  })
  const seededBody = draftBody ?? liveBody ?? ""

  const guardKey = useDraftKey({
    resource: "inbox-reply",
    resourceId: reviewId,
    schemaVersion: 1,
  })
  const fieldId = useId()
  const [body, setBody] = useState("")
  const [tone, setTone] = useState<Tone>(DEFAULT_TONE)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // A tone chosen over a reply already in the box: Generate then says which
  // tone the next reply will be written in.
  const [toneChanged, setToneChanged] = useState(false)
  // A failed generation, said where it happened, with the two ways on.
  const [generateError, setGenerateError] = useState<{
    message: string
    tone: Tone
    creditsOut?: boolean
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
  // The text the operator agreed to give up from the leave prompt, while
  // the page stayed (a held navigation that went nowhere). The inbox store
  // stops counting it as dirty; the next edit is unsaved again and
  // re-registers, because `guarded` changes back to true.
  const [discardedBody, setDiscardedBody] = useState<string | null>(null)
  const guarded = isDirty && body !== discardedBody
  const askDiscard = useAskDiscardConfirm()
  const { confirmDiscard, restore, markDiscarded } = useDirtyGuard({
    key: guardKey,
    isDirty: guarded,
    snapshot: () => body,
    askConfirm: askDiscard,
  })

  // Seed the textbox once per review, then follow the server only while there
  // is nothing of the operator's own to lose. LLM is never called here —
  // only on Generate.
  //
  // Seeded while rendering ("adjusting state when a prop changes"), not in
  // an effect: an effect left one committed render with an empty box beside
  // a review that has a reply, which read as unsaved edits. That commit
  // armed the leave guard (one extra Back entry per review opened) and
  // flickered Publish off.
  const [seededFor, setSeededFor] = useState<string | null>(null)
  // What the box was last filled with, from the server or a stash.
  const [seedBase, setSeedBase] = useState("")
  // Text an Undo or a stash put back, which a newer draft must not replace.
  const [restoredBody, setRestoredBody] = useState<string | null>(null)
  if (review && seededFor !== reviewId) {
    setSeededFor(reviewId)
    setSeedBase(seededBody)
    setBody(seededBody)
    setRestoredBody(null)
    setDiscardedBody(null)
    setMutationVerification(null)
    setVerdictStale(false)
    setToneChanged(false)
  } else if (
    // A newer draft for the review already on screen: someone else saved
    // one, or an approval request re-parked a different reply. Leaving the
    // old text in the box is how an approver reads one reply and approves
    // another. Adopt it only when the box still holds what we last seeded.
    review &&
    seededBody !== seedBase &&
    (body === seedBase || body === seededBody) &&
    body !== restoredBody
  ) {
    setSeedBase(seededBody)
    setBody(seededBody)
  }
  // A stashed draft from a forced sign-out wins over the server body. Taking
  // it removes it from sessionStorage, so that happens after the commit, once
  // per review; it is a real unsaved edit, so it is meant to read dirty.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!review) return
    if (restoredFor.current !== reviewId) {
      restoredFor.current = reviewId
      const stashed = restore()
      // Unchanged state is a no-op, so no stash costs no render.
      const adopt = stashed !== null && stashed !== seededBody
      setSeedBase((current) => (adopt ? stashed : current))
      setRestoredBody((current) => (adopt ? stashed : current))
      setBody((current) => (adopt ? stashed : current))
    }
  }, [review, reviewId, restore, seededBody])

  // `r` asks; this decides. The hotkey layer has no idea whether editing is
  // permitted for this review, and it must not: permission lives with the
  // review, not with the keyboard.
  const canOpenEditorRef = useRef(false)
  // A reply parked for approval is read, not edited: saving or regenerating
  // moves it back to `drafted` and withdraws the request, so the box stays
  // read-only until "Edit reply" (the action bar's ⋯ menu) asks to open it.
  const [editingParkedFor, setEditingParkedFor] = useState<string | null>(null)
  const awaitingApproval = review?.workflowStatus === "awaiting_approval"
  const parkedReadOnly = awaitingApproval && editingParkedFor !== reviewId
  const editableNow =
    Boolean(review?.capabilities.canEdit) &&
    !parkedReadOnly &&
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
  useEffect(() => {
    function onEditParked(event: Event) {
      const detail = (event as CustomEvent<ReplyEditDetail>).detail
      if (detail?.reviewId !== reviewId) return
      setEditingParkedFor(reviewId)
      requestAnimationFrame(() => {
        const field = textareaRef.current
        field?.focus()
        const length = field?.value.length ?? 0
        field?.setSelectionRange(length, length)
      })
    }
    window.addEventListener(REPLY_EDIT_EVENT, onEditParked)
    return () => window.removeEventListener(REPLY_EDIT_EVENT, onEditParked)
  }, [reviewId])

  const generateOrSave = useGenerateOrSaveDraft(reviewId)
  const aiCredits = useAiCredits()
  // Only a loaded balance turns Generate off (none left, an unknown
  // allowance, or read-only billing); while it loads, or if it cannot load,
  // the server still decides (it answers 402).
  const creditsExhausted = aiCredits.data
    ? aiCreditsBlocked(aiCredits.data)
    : false
  const toasts = useToastManager()

  // The publish bar's Publish runs this composer's own save first, through
  // the dirty store it already reads, then publishes the draft it returns.
  // It is offered while the text on screen is not yet a checked draft: there
  // are unsaved edits, or the newest saved draft was never checked. Why it
  // cannot run is said in words on the bar.
  const saveBlocked = !editableNow
    ? review?.capabilities.canEdit
      ? parkedReadOnly
        ? "Choose Edit reply to change this reply."
        : "A publish for this reply is under way."
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
  // Read from the leave prompt's confirm, so the callback stays stable and
  // typing does not re-register the store on every keystroke.
  const bodyRef = useRef(body)
  useEffect(() => {
    bodyRef.current = body
  }, [body])
  const discardFromLeave = useCallback(() => {
    markDiscarded()
    setDiscardedBody(bodyRef.current)
  }, [markDiscarded])
  useRegisterDirtyGuard(
    guarded,
    confirmDiscard,
    offerSave
      ? { save: runSave, blockedReason: saveBlocked, saving }
      : undefined,
    discardFromLeave
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
      if (creditsExhausted) return
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
    // A stale balance can still allow the click; the server's 402 is the
    // authority, and the refetch keeps the guard current afterwards.
    if (creditsExhausted) return
    try {
      // No body → server runs AI (or rating-only template). Manual only.
      const result = await generateOrSave.mutateAsync({ tone: withTone })
      setBody(result.body)
      setMutationVerification(result.verification)
      setVerdictStale(false)
      setToneChanged(false)
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
                  setRestoredBody(restorable)
                  setBody(restorable)
                  setVerdictStale(true)
                },
              },
            }
          : {}),
      })
    } catch (error) {
      if (isAiCreditsExhausted(error)) {
        // Told apart from drafts_paused: the balance is spent, so there is
        // nothing to retry. The mutation's settle step refetches the balance.
        setGenerateError({ message: "", tone: withTone, creditsOut: true })
        return
      }
      setGenerateError({ message: describeActionError(error), tone: withTone })
    }
  }

  function onGenerateClick() {
    if (isDirty && body.trim() !== "") {
      setConfirmOpen(true)
      return
    }
    void runGenerate()
  }

  // Choosing a tone only sets the tone; Generate is what writes. A tone
  // that regenerated the moment it was tapped spent an AI credit, and
  // replaced the reply in the box, on what is usually a look at the
  // options (and on a phone, a stray tap). Over a reply already in the box
  // Generate then reads "Regenerate in <tone>", and goes through the same
  // discard confirm as ever when there are unsaved edits.
  function onToneChoose(next: Tone) {
    if (next === tone || generateOrSave.isPending) return
    setTone(next)
    if (body.trim() !== "") setToneChanged(true)
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
  const canGenerate = editable && !generateOrSave.isPending && !creditsExhausted
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
  const showCredits = Boolean(aiCredits.data) && editable
  const reviewerGreeting = greetingName(
    review.reviewerDisplayName,
    review.reviewerIsAnonymous
  )
  // Advice, ticked off as they type; never a gate — the verification above
  // is the only check that can stop a publish.
  const guidance = editable
    ? replyGuidance({
        body,
        reviewerName: reviewerGreeting,
        rating: review.rating,
      })
    : []

  // Someone who may not edit, or who is reading a reply parked for approval,
  // gets the reply as text: no tone, no Generate, no credits and no box that
  // looks typeable but is not.
  if (!canEdit || parkedReadOnly) {
    return (
      <div data-slot="reply-composer" className="flex min-w-0 flex-col gap-2">
        <p
          data-slot="reply-readonly"
          lang={review.detectedLanguageCode ?? undefined}
          dir="auto"
          className={cn(
            "m-0 rounded-(--np-radius-card) border border-line bg-surface px-4 py-3 text-body whitespace-pre-line",
            seededBody ? "text-ink" : "text-ink-muted"
          )}
        >
          {seededBody || "No reply yet."}
        </p>
        {canEdit && parkedReadOnly ? (
          <p
            data-slot="parked-note"
            className="m-0 text-caption text-ink-muted"
          >
            Waiting for approval. To change this reply, choose Edit reply from
            the ⋯ menu. It then goes back to Needs reply.
          </p>
        ) : null}
      </div>
    )
  }

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
              setConfirmOpen(false)
              void runGenerate(tone)
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
      <span className="min-w-0 flex-1 basis-50">
        <strong className="font-semibold">No reply was generated.</strong>{" "}
        {generateError.creditsOut
          ? aiCredits.data && creditsExhausted
            ? describeCreditsLeft(aiCredits.data)
            : "Out of AI credits for this period. You can still write a reply yourself."
          : generateError.message}
      </span>
      <span className="flex items-center gap-2">
        {generateError.creditsOut ? null : (
          <Button
            variant="secondary"
            disabled={generateOrSave.isPending}
            onClick={() => void runGenerate(generateError.tone)}
          >
            Retry
          </Button>
        )}
        <Button variant="ghost" onClick={writeOwn}>
          <PenLineIcon aria-hidden data-icon="inline-start" />
          Write my own
        </Button>
      </span>
    </div>
  ) : null

  // Tone applies to Generate, so it sits beside it, on the bar above the
  // words: these are the prompt's controls, not part of the text. The
  // segmented control as a radio group: one tab stop, arrow keys move and
  // select, and the track scrolls inside itself (focusable, snapping, with an
  // edge fade) rather than cutting a label when the pane is narrow.
  const toneControl = (
    <>
      <SegmentedControl
        semantics="radio"
        aria-label="Reply tone"
        value={tone}
        onValueChange={(next) => onToneChoose(next as Tone)}
        disabled={!editable || generateOrSave.isPending}
        className="min-w-0 @max-[480px]/detail:flex-[1_1_100%]"
      >
        {TONES.map((option) => (
          <SegmentedControlItem
            key={option.value}
            value={option.value}
            // Named by its label, described by its hint: no hover-only title.
            aria-describedby={`${fieldId}-${option.value}-hint`}
          >
            {option.label}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
      {/* Outside the track, so each radio is named by its label alone and
          the track holds only its segments. */}
      {TONES.map((option) => (
        <span
          key={option.value}
          id={`${fieldId}-${option.value}-hint`}
          className="sr-only"
        >
          {option.hint}
        </span>
      ))}
    </>
  )
  const toneLabel = TONES.find((option) => option.value === tone)?.label
  const generateLabel = empty
    ? "Generate reply"
    : toneChanged
      ? `Regenerate in ${toneLabel}`
      : "Regenerate"

  return (
    <div data-slot="reply-composer" className="flex min-w-0 flex-col gap-2">
      {/* The thread's "Reply as …" heading is the visible name; the field
          keeps its own. */}
      <label htmlFor={fieldId} className="sr-only">
        Your reply
      </label>
      {awaitingApproval ? (
        <p
          data-slot="parked-editing-note"
          className="m-0 px-1 text-caption text-ink-muted"
        >
          Saving a change sends this reply back to Needs reply.
        </p>
      ) : null}
      {generateErrorNote}

      {/* The editor surface under the "Reply as …" header row: a quiet
          hairline edge at rest (where the field ends must stay visible),
          a stronger edge and halo while the words are focused. The
          insert bar sits over one hairline above the words; the guidance
          and the length beneath them. */}
      <div
        data-slot="reply-editor"
        className="flex min-w-0 flex-col rounded-(--np-radius-control) border border-transparent transition-[border-color,box-shadow] duration-(--np-duration-fast) focus-within:border-line focus-within:ring-3 focus-within:ring-fill has-[[aria-invalid=true]]:border-danger-ink motion-reduce:transition-none"
      >
        {/* The insert bar: plain text in, never rich text. AI rewrite (the
            tone and Generate) and the count. */}
        <div
          data-slot="composer-prompt-bar"
          className="flex flex-wrap items-center gap-x-1.5 gap-y-2 px-1 py-1"
        >
          {toneControl}
          <span aria-hidden className="flex-1" />
          <span
            data-slot="char-count"
            // Neutral on purpose: Google's limit is in bytes, which the
            // foot's length note states; a red character count would claim a
            // limit in a unit it does not show.
            className="px-1 text-count whitespace-nowrap text-ink-muted tabular-nums"
          >
            {body.length.toLocaleString("en-GB")}{" "}
            {body.length === 1 ? "character" : "characters"}
          </span>
          {editable && isDirty && seededBody !== "" ? (
            <Button
              variant="ghost"
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
          <Button
            variant="ghost"
            disabled={!canGenerate}
            pending={generateOrSave.isPending && !saving}
            pendingLabel="Writing…"
            onClick={onGenerateClick}
          >
            <SparklesIcon aria-hidden data-icon="inline-start" />
            {generateLabel}
          </Button>
        </div>

        {/* Grows with the reply from six lines, then scrolls inside itself:
            the publish bar and the keyboard below it stay where they are. */}
        <Textarea
          ref={textareaRef}
          id={fieldId}
          autoSize
          minRows={6}
          maxRows={16}
          lang={review.detectedLanguageCode ?? undefined}
          dir="auto"
          value={body}
          readOnly={!editable}
          aria-invalid={overLimit || showFail || undefined}
          aria-describedby={
            [
              showFail ? `${fieldId}-problem` : null,
              nearLimit || overLimit ? `${fieldId}-count` : null,
              guidance.length > 0 ? `${fieldId}-guidance` : null,
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
          placeholder="Write a reply, or generate one in the chosen tone."
          className={cn(
            // text-body is 16px on touch, so iOS does not zoom into the box.
            "rounded-none border-0 bg-transparent px-1 pt-5 pb-4 text-reading shadow-none read-only:cursor-default focus:shadow-none focus-visible:shadow-none",
            generateOrSave.isPending &&
              !saving &&
              "animate-pulse motion-reduce:animate-none"
          )}
        />

        {guidance.length > 0 || nearLimit || overLimit || showCredits ? (
          <div
            data-slot="composer-foot"
            className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line-subtle px-1 py-3"
          >
            {guidance.length > 0 ? (
              <ul
                id={`${fieldId}-guidance`}
                aria-label="Reply guidance"
                data-slot="reply-guidance"
                className="m-0 flex min-w-0 flex-[1_1_auto] list-none flex-wrap items-center gap-x-3.5 gap-y-1 p-0 text-caption"
              >
                {guidance.map((item) => (
                  <li
                    key={item.id}
                    data-met={item.met}
                    className={cn(
                      "inline-flex items-center gap-1.5",
                      item.met ? "text-ink" : "text-ink-muted"
                    )}
                  >
                    {item.met ? (
                      <CircleCheckIcon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-3.5 shrink-0 text-success-ink"
                      />
                    ) : (
                      <CircleIcon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-3.5 shrink-0 text-ink-faint"
                      />
                    )}
                    {item.label}
                    <span className="sr-only">
                      {item.met ? ": done" : ": not yet"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {nearLimit || overLimit ? (
              <span
                id={`${fieldId}-count`}
                data-slot="length-note"
                className={cn(
                  "ml-auto text-caption",
                  overLimit
                    ? "font-semibold text-danger-ink"
                    : "text-warning-ink"
                )}
              >
                {overLimit
                  ? `Over Google's length limit · ${bytes.toLocaleString("en-GB")} of ${BYTE_LIMIT.toLocaleString("en-GB")} bytes`
                  : `Nearly at Google's length limit · ${bytes.toLocaleString("en-GB")} of ${BYTE_LIMIT.toLocaleString("en-GB")} bytes`}
              </span>
            ) : null}
            {/* Under the words rather than on its own row above them: on a
                phone every row above the box pushes the box down. */}
            {showCredits && aiCredits.data ? (
              <p
                data-slot="ai-credits"
                data-exhausted={creditsExhausted || undefined}
                className={cn(
                  "m-0 basis-full text-caption",
                  creditsExhausted ? "text-warning-ink" : "text-ink-muted"
                )}
              >
                {describeCreditsLeft(aiCredits.data)}
              </p>
            ) : null}
          </div>
        ) : null}
        <span role="status" className="sr-only">
          {overLimit
            ? "Your reply is over Google's length limit."
            : nearLimit
              ? "Your reply is nearly at Google's length limit."
              : ""}
        </span>
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
