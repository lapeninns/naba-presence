"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PenLineIcon,
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
import { REPLY_FOCUS_EVENT, REPLY_GENERATE_EVENT } from "@/lib/inbox/events"
import { saveShortcutLabel } from "@/lib/inbox/shortcut-label"
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
  const [tone, setTone] = useState<Tone>(DEFAULT_TONE)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // The tone a regenerate waits on while the discard confirm is open: the
  // Regenerate button's own tone, or the one just chosen on the editor bar.
  const [pendingTone, setPendingTone] = useState<Tone | null>(null)
  // A failed generation, said where it happened, with the two ways on.
  const [generateError, setGenerateError] = useState<{
    message: string
    tone: Tone
  } | null>(null)
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
      setEditing(false)
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

  // The publish bar's "Save & check" runs this composer's own save, through
  // the dirty store it already reads, so there is one save and one set of
  // rules for it. The reason it cannot run is said in words on the bar.
  const saveBlocked = !editableNow
    ? review?.capabilities.canEdit
      ? "A publish for this reply is under way."
      : "You do not have permission to edit this reply."
    : body.trim() === ""
      ? "Write the reply before saving it."
      : byteLength(body) > BYTE_LIMIT
        ? "Shorten the reply to fit Google's length limit."
        : null
  const saveRef = useRef<() => void>(() => {})
  const runSave = useCallback(() => saveRef.current(), [])
  useRegisterDirtyGuard(isDirty, confirmDiscard, {
    save: runSave,
    blockedReason: saveBlocked,
    saving: generateOrSave.isPending,
  })

  // `g`: a first draft in the default tone, when there is nothing to lose —
  // no saved draft, no live reply and nothing typed. Like `r`, the key only
  // asks; whether it is allowed is decided here.
  const generateRef = useRef<() => void>(() => {})
  useEffect(() => {
    saveRef.current = () => {
      if (saveBlocked || generateOrSave.isPending) return
      void onSave()
    }
    generateRef.current = () => {
      if (!editableNow || generateOrSave.isPending || !review) return
      if (review.drafts.length > 0 || liveBody !== null || body !== "") return
      setTone(DEFAULT_TONE)
      void runGenerate(DEFAULT_TONE)
    }
  })
  useEffect(() => {
    const onGenerate = () => generateRef.current()
    window.addEventListener(REPLY_GENERATE_EVENT, onGenerate)
    return () => window.removeEventListener(REPLY_GENERATE_EVENT, onGenerate)
  }, [])

  const generateLabel = useMemo(
    () =>
      review && review.drafts.length > 0 ? "Regenerate" : "Generate draft",
    [review]
  )

  async function runGenerate(withTone: Tone = tone) {
    // What the box held, so a regenerate over it can be taken back.
    const previous = body
    setGenerateError(null)
    try {
      // No body → server runs AI (or rating-only template). Manual only.
      const result = await generateOrSave.mutateAsync({ tone: withTone })
      setBody(result.body)
      setMutationVerification(result.verification)
      const restorable =
        previous.trim() !== "" && previous !== result.body ? previous : null
      toasts.add({
        title: "Draft ready",
        description: restorable
          ? "A fresh reply replaced the previous text. Undo puts it back as an unsaved edit."
          : "A fresh reply was generated and verified.",
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
                  setEditing(true)
                },
              },
            }
          : {}),
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
      setGenerateError({ message: describeActionError(error), tone: withTone })
    }
  }

  function onGenerateClick() {
    if (isDirty) {
      setPendingTone(tone)
      setConfirmOpen(true)
      return
    }
    void runGenerate()
  }

  // Choosing a tone on the editor bar is asking for the reply in that tone,
  // so it regenerates — through the same discard confirm when there are
  // unsaved edits. It used to set a value nothing read until Regenerate.
  function onToneChoose(next: Tone) {
    if (next === tone || generateOrSave.isPending) return
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
    setEditing(true)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // The failed checks are listed under the thread, often a screen below the
  // editor; the caption that counts them takes the operator there.
  function showChecks() {
    const checks = document.querySelector<HTMLElement>(
      '[data-slot="verification-checks"]'
    )
    if (!checks) return
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    )?.matches
    checks.scrollIntoView?.({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    })
    checks.focus({ preventScroll: true })
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
          Regenerating replaces your unsaved changes with a new draft. You can
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
        <strong className="font-semibold">No draft was generated.</strong>{" "}
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

  // Reference `.seg`: tone applies to Generate, so it sits beside it, and
  // choosing one regenerates in it.
  const toneControl = (
    <div
      role="radiogroup"
      aria-label="Reply tone"
      aria-describedby={`${fieldId}-tone-hint`}
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
            disabled={!canEdit || !canDraft || generateOrSave.isPending}
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
      <span className="sr-only" id={`${fieldId}-tone-hint`}>
        Choosing a tone generates the reply again in that tone
      </span>
    </div>
  )

  // Nothing drafted, nothing live and nothing typed: choose how to start
  // (reference `.starter`). Picking a tone generates a draft in it; writing
  // your own opens the empty editor.
  const starting =
    !editing &&
    body === "" &&
    !latestDraft &&
    liveBody === null &&
    canEdit &&
    canDraft

  const heading = (
    <h3 id={`${fieldId}-heading`} className="sr-only">
      {starting
        ? "Start a reply"
        : showPreview
          ? settled
            ? "Published reply"
            : "Your reply"
          : "Write the reply"}
    </h3>
  )

  if (starting) {
    return (
      <section
        aria-labelledby={`${fieldId}-heading`}
        data-slot="reply-starter"
        className="flex flex-col gap-3"
      >
        {heading}
        <p className="text-ui text-ink-secondary">
          Choose a starting point. You can edit every word before it is checked.
        </p>
        <div
          role="group"
          aria-label="Start from a tone"
          className="grid grid-cols-1 gap-2 @min-[640px]/detail:grid-cols-3"
        >
          {TONES.map((option) => {
            const busy = generateOrSave.isPending && tone === option.value
            return (
              <button
                key={option.value}
                type="button"
                data-slot="tone-card"
                // The card's name is the action; its sentence is the
                // description, not part of what a screen reader calls it.
                aria-label={`${option.label} draft`}
                aria-describedby={`${fieldId}-${option.value}-hint`}
                aria-busy={busy || undefined}
                disabled={generateOrSave.isPending}
                onClick={() => {
                  setTone(option.value)
                  void runGenerate(option.value)
                }}
                className={cn(
                  "flex flex-col gap-1.5 rounded-(--np-radius-card) border border-line bg-surface-sunken p-3.5 text-left focus-halo transition-[background-color,border-color] duration-(--np-duration-fast) ease-out-strong focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 hover-fine:hover:border-line-strong hover-fine:hover:bg-surface-alt",
                  busy && "animate-pulse"
                )}
              >
                <span className="flex items-center justify-between gap-2 text-ui font-semibold text-ink">
                  {option.label}
                  <ChevronRightIcon
                    aria-hidden
                    strokeWidth={1.75}
                    className="size-4 text-ink-muted"
                  />
                </span>
                <span
                  id={`${fieldId}-${option.value}-hint`}
                  className="text-[13px] leading-normal text-ink-secondary"
                >
                  {busy ? "Drafting…" : option.hint}
                </span>
              </button>
            )
          })}
        </div>
        <Button
          variant="ghost"
          disabled={generateOrSave.isPending}
          onClick={() => {
            setEditing(true)
            requestAnimationFrame(() => textareaRef.current?.focus())
          }}
          className="-ml-3 self-start"
        >
          <PenLineIcon aria-hidden data-icon="inline-start" />
          Write my own reply
        </Button>
        {generateErrorNote}
        {discardDialog}
      </section>
    )
  }

  return (
    <section
      aria-labelledby={`${fieldId}-heading`}
      data-slot="reply-composer"
      className="flex min-w-0 flex-col gap-2"
    >
      {heading}
      {permissionNote}
      {generateErrorNote}

      {/* Reference `.editor`: one bordered card whose edge takes the focus
          ring while the textarea inside is borderless, with the tone and
          draft controls on a bar beneath the words. */}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-(--np-radius-card) border border-line bg-surface-sunken transition-[border-color,box-shadow] duration-(--np-duration-fast) focus-within:border-line-strong focus-within:shadow-[0_0_0_3px_var(--np-fill)]">
        {showPreview ? (
          // The reply as words, before any control asks the operator to do
          // something about it.
          <p
            dir="auto"
            lang={review.detectedLanguageCode ?? undefined}
            className="min-h-[88px] px-4 pt-3.5 pb-3 text-[15px] leading-relaxed whitespace-pre-line text-ink"
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
              "min-h-[128px] rounded-none border-0 bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed shadow-none read-only:cursor-default focus:shadow-none focus-visible:shadow-none",
              generateOrSave.isPending && "animate-pulse"
            )}
          />
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-2.5 py-2">
          {toneControl}
          <Button
            variant="ghost"
            size="sm"
            disabled={!canGenerate}
            onClick={onGenerateClick}
          >
            <SparklesIcon aria-hidden data-icon="inline-start" />
            {generateOrSave.isPending ? "Working…" : generateLabel}
          </Button>
          {showPreview ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!canEdit || !canDraft}
              onClick={() => setEditing(true)}
            >
              <PenLineIcon aria-hidden data-icon="inline-start" />
              Edit reply
            </Button>
          ) : latestDraft || liveBody !== null ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void closeEditor()}
            >
              Close editor
            </Button>
          ) : editing && canEdit && canDraft ? (
            // Came here by "Write my own reply": the way back to the tones.
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void closeEditor()}
            >
              Start from a tone
            </Button>
          ) : null}
          <span aria-hidden className="flex-1" />
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
              : nearLimit
                ? `Nearly at Google's length limit · ${bytes.toLocaleString("en-GB")} of ${BYTE_LIMIT.toLocaleString("en-GB")} bytes`
                : ""}
          </span>
          <span role="status" className="sr-only">
            {overLimit
              ? "Your reply is over Google's length limit."
              : nearLimit
                ? "Your reply is nearly at Google's length limit."
                : ""}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-caption text-ink-muted">
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
          <button
            type="button"
            data-slot="checks-link"
            onClick={showChecks}
            className={cn(
              "rounded-[4px] font-semibold underline decoration-1 underline-offset-2 focus-halo focus-visible:outline-none pointer-coarse:min-h-(--np-touch)",
              blocking > 0 ? "text-danger-ink" : "text-warning-ink"
            )}
          >
            {blocking > 0
              ? `${blocking} ${blocking === 1 ? "issue" : "issues"} to fix before publishing`
              : `${reasons.length} ${reasons.length === 1 ? "point" : "points"} to check before publishing`}
          </button>
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
            className="inline-flex items-center gap-1.5 max-md:hidden pointer-coarse:hidden"
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

        {/* Revert throws the edit away and Save draft keeps it; a rule and
            a gap between them, so a thumb aiming for one does not land on
            the other. */}
        {canEdit && canDraft && isDirty && !showPreview ? (
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
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
