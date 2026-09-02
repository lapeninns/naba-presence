"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import {
  CircleCheckIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import {
  useAskDiscardConfirm,
  useRegisterDirtyGuard,
} from "@/components/inbox/dirty-context"
import { VerificationPanel } from "@/components/inbox/verification-panel"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/inbox/action-errors"
import { replyWork } from "@/lib/inbox/review-situation"
import {
  useGenerateOrSaveDraft,
  useVerifyDraft,
} from "@/lib/queries/use-draft-mutations"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import type { LatestVerification } from "@/lib/api/reviews"

const BYTE_LIMIT = 4096
const BYTE_WARN_AT = Math.floor(BYTE_LIMIT * 0.9)

const TONE_ITEMS: Record<string, string> = {
  warm_professional: "Warm and professional",
  concise: "Concise",
  empathetic: "Empathetic",
}

const TONES = [
  { value: "warm_professional", label: "Warm and professional" },
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
  const [editingSettled, setEditingSettled] = useState(false)
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

  // Seed the textbox once per review. A stashed draft from a forced sign-out
  // wins over the server body. LLM is never called here — only on Generate.
  const seededReviewRef = useRef<string | null>(null)
  useEffect(() => {
    if (!review) return
    if (seededReviewRef.current === reviewId) return
    seededReviewRef.current = reviewId
    const stashed = restore()
    setBody(stashed ?? seededBody)
    setMutationVerification(null)
    setEditingSettled(false)
  }, [review, reviewId, restore, seededBody])

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
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        const length = result.body.length
        textareaRef.current?.setSelectionRange(length, length)
      })
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
  const showSettledSummary =
    settled && canEdit && !isDirty && !editingSettled && body.trim() !== ""
  const bytes = byteLength(body)
  const overLimit = bytes > BYTE_LIMIT
  const nearLimit = !overLimit && bytes >= BYTE_WARN_AT
  const canSave =
    canEdit &&
    isDirty &&
    body.trim() !== "" &&
    !overLimit &&
    !generateOrSave.isPending
  const canGenerate = canEdit && !generateOrSave.isPending
  const displayedVerification =
    mutationVerification ?? review.latestVerification
  const reasons = displayedVerification?.reasons ?? []
  const blocking = reasons.filter((reason) => reason.severity === "fail").length
  const provenance = latestDraft ? PROVENANCE[latestDraft.source] : null
  const shortcut = saveShortcutLabel()

  if (showSettledSummary) {
    return (
      <section
        aria-labelledby={`${fieldId}-heading`}
        className="flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 id={`${fieldId}-heading`} className="text-ui font-semibold">
            Your reply
          </h3>
          {provenance ? (
            <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
              <SparklesIcon aria-hidden className="size-3 shrink-0" />
              {provenance}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <CircleCheckIcon
              aria-hidden
              className="size-3.5 shrink-0 text-success"
            />
            In sync with Google
          </span>
          <span aria-hidden className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingSettled(true)}
          >
            Edit reply
          </Button>
        </div>
        <p
          dir="auto"
          lang={review.detectedLanguageCode ?? undefined}
          className="rounded-(--nr-radius-field) border border-border/70 bg-muted/40 px-4 py-3 text-body whitespace-pre-line"
        >
          {body}
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby={`${fieldId}-heading`}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label
          id={`${fieldId}-heading`}
          htmlFor={fieldId}
          className="text-ui font-semibold"
        >
          Your reply
        </label>
        {provenance ? (
          <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <SparklesIcon aria-hidden className="size-3 shrink-0" />
            {isDirty ? `${provenance} · unsaved edits` : provenance}
          </span>
        ) : null}
        <span aria-hidden className="flex-1" />
        {reasons.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-caption font-medium">
            <TriangleAlertIcon
              aria-hidden
              className="size-3.5 shrink-0 text-warning"
            />
            {blocking > 0
              ? `${blocking} ${blocking === 1 ? "issue" : "issues"} to fix before publishing`
              : `${reasons.length} ${reasons.length === 1 ? "point" : "points"} to check before publishing`}
          </span>
        ) : settled && !isDirty ? (
          <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <CircleCheckIcon
              aria-hidden
              className="size-3.5 shrink-0 text-success"
            />
            In sync with Google
          </span>
        ) : null}
      </div>

      {!canEdit ? (
        <p className="text-caption text-muted-foreground">
          You can read this reply, but you do not have permission to edit it.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-(--nr-radius-field) border border-border bg-background focus-within:ring-3 focus-within:ring-ring/30">
        <Textarea
          ref={textareaRef}
          id={fieldId}
          lang={review.detectedLanguageCode ?? undefined}
          dir="auto"
          value={body}
          readOnly={!canEdit}
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
          className="min-h-28 rounded-none border-0 bg-transparent shadow-none read-only:cursor-default read-only:bg-muted/20 focus-visible:ring-0 disabled:opacity-100"
        />

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 bg-muted/30 px-2 py-1.5">
          <Select
            value={tone}
            onValueChange={(value: string | null) =>
              setTone((value ?? "warm_professional") as Tone)
            }
            items={TONE_ITEMS}
            disabled={!canEdit}
          >
            <SelectTrigger
              aria-label="Reply tone"
              aria-describedby={`${fieldId}-tone-hint`}
              title="Used when you generate a draft"
              className="h-9 w-full basis-full border-border/70 bg-background px-2.5 shadow-none sm:h-8 sm:w-auto sm:max-w-56 sm:shrink-0 sm:basis-auto"
            >
              <span
                aria-hidden
                className="shrink-0 text-caption font-medium text-muted-foreground"
              >
                Tone
              </span>
              <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
              <SelectValue className="flex-1 text-left" />
            </SelectTrigger>
            <SelectContent>
              {TONES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="sr-only" id={`${fieldId}-tone-hint`}>
            Tone is used when you generate a draft
          </span>

          <Button
            variant="ghost"
            size="sm"
            disabled={!canGenerate}
            onClick={onGenerateClick}
          >
            <SparklesIcon aria-hidden data-icon="inline-start" />
            {generateOrSave.isPending ? "Working…" : generateLabel}
          </Button>

          {latestDraft ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !canEdit || verify.isPending || generateOrSave.isPending
              }
              onClick={() => void onReverify()}
            >
              <ShieldCheckIcon aria-hidden data-icon="inline-start" />
              {verify.isPending ? "Verifying…" : "Re-verify"}
            </Button>
          ) : null}

          {canEdit && isDirty ? (
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

          <span aria-hidden className="flex-1" />

          <span
            id={`${fieldId}-count`}
            className={
              bytes === 0
                ? "sr-only"
                : overLimit
                  ? "font-mono text-caption text-destructive tabular-nums"
                  : nearLimit
                    ? "font-mono text-caption text-warning tabular-nums"
                    : "font-mono text-caption text-muted-foreground tabular-nums"
            }
          >
            {bytes.toLocaleString("en-GB")} /{" "}
            {BYTE_LIMIT.toLocaleString("en-GB")}
          </span>
          <span role="status" className="sr-only">
            {overLimit
              ? "Your reply is over the 4,096-byte limit."
              : nearLimit
                ? "Your reply is approaching the 4,096-byte limit."
                : ""}
          </span>

          {canEdit ? (
            <span
              id={`${fieldId}-hint`}
              className="hidden text-caption text-muted-foreground sm:inline"
              title={`Save with ${shortcut}`}
            >
              {shortcut}
            </span>
          ) : (
            <span id={`${fieldId}-hint`} className="sr-only" />
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={!canSave}
            onClick={() => void onSave()}
          >
            Save draft
          </Button>
        </div>
      </div>

      {reasons.length > 0 ? (
        <VerificationPanel
          verification={displayedVerification}
          status={review.workflowStatus}
        />
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-label="Discard your edits?">
          <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
          <AlertDialogDescription>
            Regenerating replaces your unsaved changes with a new draft. This
            cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Keep editing
            </AlertDialogClose>
            <Button
              size="sm"
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
    </section>
  )
}

export { ReplyComposer }
