"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { useRegisterDirtyGuard } from "@/components/inbox/dirty-context"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/inbox/action-errors"
import { useGenerateOrSaveDraft, useVerifyDraft } from "@/lib/queries/use-draft-mutations"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { VerificationPanel } from "@/components/inbox/verification-panel"
import type { LatestVerification } from "@/lib/api/reviews"

const TONES = [
  { value: "warm_professional", label: "Warm and professional" },
  { value: "concise", label: "Concise" },
  { value: "empathetic", label: "Empathetic" },
] as const

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function ReplyComposer({ reviewId }: { reviewId: string }) {
  const detail = useReviewDetail(reviewId)
  const review = detail.data?.review
  const latestDraft = review?.drafts[0]
  const seededBody = latestDraft?.body ?? ""

  const guardKey = `inbox:reply:${reviewId}`
  const [body, setBody] = useState("")
  const [tone, setTone] = useState<(typeof TONES)[number]["value"]>("warm_professional")
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Verification produced by THIS session's latest generate/verify mutation;
  // null until the user acts, then the persisted review.latestVerification (D3)
  // shows verdict AND reasons on load.
  const [mutationVerification, setMutationVerification] =
    useState<LatestVerification | null>(null)

  const isDirty = body !== seededBody
  const { confirmDiscard, restore } = useDirtyGuard({
    key: guardKey,
    isDirty,
    snapshot: () => body,
  })
  useRegisterDirtyGuard(isDirty, confirmDiscard)

  // Seed the textbox once per review, when its detail data is available; a ref
  // guard stops a post-mutation refetch (same reviewId) from clobbering unsaved
  // edits. A stashed draft from a forced sign-out wins over the server body.
  const seededReviewRef = useRef<string | null>(null)
  useEffect(() => {
    if (!review) return
    if (seededReviewRef.current === reviewId) return
    seededReviewRef.current = reviewId
    const stashed = restore()
    setBody(stashed ?? review.drafts[0]?.body ?? "")
    setMutationVerification(null)
  }, [review, reviewId, restore])

  const generateOrSave = useGenerateOrSaveDraft(reviewId)
  const verify = useVerifyDraft(reviewId)
  const toasts = useToastManager()

  const generateLabel = useMemo(
    () => (review && review.drafts.length > 0 ? "Regenerate" : "Generate draft"),
    [review]
  )

  async function runGenerate() {
    try {
      const result = await generateOrSave.mutateAsync({ tone })
      setBody(result.body)
      setMutationVerification(result.verification)
      toasts.add({
        title: "Draft ready",
        description: "A fresh reply was generated and verified.",
        type: "success",
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
      const result = await generateOrSave.mutateAsync({ body })
      setMutationVerification(result.verification)
      toasts.add({ title: "Draft saved", type: "success" })
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
  const bytes = byteLength(body)
  const overLimit = bytes > 4096
  // On load the persisted verdict+reasons show; a fresh mutation supersedes it.
  const displayedVerification = mutationVerification ?? review.latestVerification

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="reply-draft" className="text-ui font-semibold">
          Your reply
        </label>
        <Select
          value={tone}
          onValueChange={(value: string | null) =>
            setTone((value ?? "warm_professional") as typeof tone)
          }
        >
          <SelectTrigger aria-label="Reply tone" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Textarea
        id="reply-draft"
        lang={review.detectedLanguageCode ?? undefined}
        dir="auto"
        value={body}
        disabled={!canEdit}
        aria-invalid={overLimit || undefined}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a reply, or generate one to start."
      />
      <p className={overLimit ? "text-caption text-destructive" : "text-caption text-muted-foreground"}>
        {bytes.toLocaleString("en-GB")} / 4,096 bytes
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canEdit || generateOrSave.isPending}
          onClick={onGenerateClick}
        >
          {generateOrSave.isPending ? "Working…" : generateLabel}
        </Button>
        <Button
          size="sm"
          disabled={
            !canEdit ||
            !isDirty ||
            body.trim() === "" ||
            overLimit ||
            generateOrSave.isPending
          }
          onClick={() => void onSave()}
        >
          Save draft
        </Button>
        {latestDraft ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!canEdit || verify.isPending}
            onClick={() => void onReverify()}
          >
            Re-verify
          </Button>
        ) : null}
      </div>

      {/* Verification reasons rendered inline near the composer AND acting as
          the lifecycle panel (D9); the reasons come from the latest draft/
          verify mutation, which the detail endpoint does not carry. */}
      <VerificationPanel verification={displayedVerification} status={review.workflowStatus} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-label="Discard your edits?">
          <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
          <AlertDialogDescription>
            Regenerating replaces your unsaved changes with a new draft. This
            cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="outline" size="sm" />}
            >
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
    </div>
  )
}

export { ReplyComposer }
