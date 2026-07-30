"use client"

import {
  Activity,
  ArrowLeft,
  Check,
  CheckCircle2,
  MoreHorizontal,
  Send,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react"
import { useEffect, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  readControlValue,
  Stars,
  StatusBadge,
} from "@/components/naba-presence/shared"
import { ActivityTimeline, VerificationPanel } from "@/components/naba-presence/reviews/review-detail-panels"
import type { DraftTone } from "@/lib/domain/reply-policy"
import { Review } from "@/lib/naba-presence-data"
import {
  approveReply,
  deleteReply,
  generateDraft,
  loadReviewDetail,
  type ReviewDetailData,
  publishDraft,
  rejectReply,
  saveDraft as saveDraftToApi,
} from "@/lib/naba-presence-api"

export { ActivityTimeline, VerificationPanel } from "@/components/naba-presence/reviews/review-detail-panels"

const REPLY_LANGUAGES = [
  ["auto", "Auto (detected)"],
  ["en", "EN"],
  ["de", "DE"],
  ["es", "ES"],
  ["fr", "FR"],
  ["it", "IT"],
  ["pt", "PT"],
  ["nl", "NL"],
  ["ar", "AR"],
  ["ru", "RU"],
  ["ja", "JA"],
  ["hi", "HI"],
] as const

export function ReviewDetail({
  review,
  onBack,
  backButtonRef,
  onUpdate,
  onRefreshData,
}: {
  review: Review
  onBack: () => void
  backButtonRef: React.Ref<HTMLButtonElement>
  onUpdate: (patch: Partial<Review>) => void
  onRefreshData: () => Promise<void>
}) {
  const [draft, setDraft] = useState(review.draft)
  const [tone, setTone] = useState<DraftTone>("warm_professional")
  const [replyLanguage, setReplyLanguage] = useState("auto")
  const [feedback, setFeedback] = useState("")
  const [rejectOpen, setRejectOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [rejectionNote, setRejectionNote] = useState("")
  const [isPending, startTransition] = useTransition()
  const [detailState, setDetailState] = useState<{
    reviewId: string
    data: ReviewDetailData
  } | null>(null)
  const [detailError, setDetailError] = useState("")
  const detail = detailState?.reviewId === review.id ? detailState.data : null
  const languageOverride =
    replyLanguage === "auto" ? undefined : replyLanguage

  useEffect(() => {
    let active = true
    void loadReviewDetail(review.id)
      .then((value) => {
        if (active) setDetailState({ reviewId: review.id, data: value })
      })
      .catch((error) => {
        if (!active) return
        setDetailError(
          error instanceof Error
            ? error.message
            : "Review activity could not be loaded."
        )
      })
    return () => {
      active = false
    }
  }, [review.id])

  function regenerate() {
    setFeedback("")
    startTransition(async () => {
      try {
        const generated = await generateDraft(
          review.id,
          tone,
          languageOverride
        )
        setDraft(generated.body)
        onUpdate({
          draft: generated.body,
          draftId: generated.draftId,
          verification: generated.verification.verdict,
        })
        toast.add({
          type: "success",
          title: "A new verified draft is ready.",
        })
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Draft generation failed."
        )
      }
    })
  }

  function saveDraft() {
    setFeedback("")
    startTransition(async () => {
      try {
        const saved = await saveDraftToApi(
          review.id,
          draft,
          tone,
          languageOverride
        )
        onUpdate({
          draft: saved.body,
          draftId: saved.draftId,
          verification: saved.verification.verdict,
        })
        toast.add({
          type: "success",
          title: "Draft saved",
          description: "Recorded in the review audit trail.",
        })
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Save failed.")
      }
    })
  }

  function publish() {
    setFeedback("")
    startTransition(async () => {
      try {
        const saved =
          !review.draftId ||
          draft !== review.draft ||
          languageOverride !== undefined
            ? await saveDraftToApi(
                review.id,
                draft,
                tone,
                languageOverride
              )
            : {
                draftId: review.draftId,
                body: draft,
                verification: { verdict: review.verification },
              }
        if (saved.verification.verdict === "fail") {
          onUpdate({ verification: "fail", draftId: saved.draftId, draft })
          throw new Error(
            "This reply failed verification and cannot be published."
          )
        }
        const published = await publishDraft(
          review.id,
          saved.draftId,
          review.sourceUpdateTime
        )
        const status =
          published.status === "awaiting_approval"
            ? "awaiting_approval"
            : published.status === "rejected"
              ? "escalated"
              : "published"
        onUpdate({
          draft,
          draftId: saved.draftId,
          verification: saved.verification.verdict,
          status,
          googleState: published.googleReplyState ?? undefined,
          ...(status === "published"
            ? { publishedReply: saved.body, responseTime: "Just now" }
            : {}),
        })
        toast.add({
          type: "success",
          title:
            status === "awaiting_approval"
              ? "Reply submitted for approval."
              : "Reply sent to Google.",
        })
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Publish failed.")
      }
    })
  }

  function approve() {
    setFeedback("")
    startTransition(async () => {
      try {
        const approved = await approveReply(review.id)
        const status =
          approved.status === "rejected" ? "escalated" : "published"
        onUpdate({
          status,
          googleState: approved.googleReplyState ?? undefined,
          ...(status === "published"
            ? { publishedReply: draft, responseTime: "Just now" }
            : {}),
        })
        toast.add({
          type: "success",
          title:
            status === "published"
              ? "Reply approved and sent to Google."
              : "Google rejected the approved reply.",
        })
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Approval failed.")
      }
    })
  }

  function rejectApproval() {
    setFeedback("")
    startTransition(async () => {
      try {
        await rejectReply(review.id, rejectionNote.trim() || undefined)
        onUpdate({ status: "needs_reply" })
        setRejectOpen(false)
        setRejectionNote("")
        toast.add({
          type: "success",
          title: "Reply returned to draft.",
        })
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Rejection failed."
        )
      }
    })
  }

  function removePublishedReply() {
    setFeedback("")
    startTransition(async () => {
      try {
        await deleteReply(review.id)
        const refreshedDetail = await loadReviewDetail(review.id)
        setDetailState({ reviewId: review.id, data: refreshedDetail })
        onUpdate({
          status: "needs_reply",
          publishedReply: undefined,
          responseTime: undefined,
          googleState: undefined,
        })
        await onRefreshData()
        setDeleteOpen(false)
        toast.add({
          type: "success",
          title: "Published reply deleted",
          description: "The review is ready for a new reply.",
        })
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Reply deletion failed."
        )
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 md:px-7 md:py-7">
      <header className="flex items-start gap-3 rounded-(--nr-radius-panel) border bg-card p-4 shadow-(--nr-shadow-card) md:p-5">
        <Button
          ref={backButtonRef}
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          className="xl:hidden"
          aria-label="Back to review list"
        >
          <ArrowLeft />
        </Button>
        <Avatar size="lg">
          <AvatarFallback>{review.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium">{review.reviewer}</h2>
            <StatusBadge status={review.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Stars value={review.rating} compact />
            <span>{review.location}</span>
            <span>Posted {review.postedAt.toLowerCase()}</span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Review actions"
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem
              onClick={() => {
                navigator.clipboard
                  .writeText(review.id)
                  .then(() =>
                    toast.add({ type: "success", title: "Review ID copied" })
                  )
                  .catch(() => setFeedback("Review ID could not be copied."))
              }}
            >
              Copy review ID
            </DropdownMenuItem>
            {review.status === "published" || review.googleState ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                Delete published reply
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete published reply?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the reply on Google. The review returns to the
                inbox as unreplied.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={removePublishedReply}
                disabled={isPending}
              >
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                Delete reply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </header>

      <section aria-label="Review conversation" className="flex flex-col gap-4">
        <div className="max-w-[92%] self-start rounded-(--nr-radius-card) rounded-tl-md border bg-muted p-4 md:max-w-[82%] md:p-5">
          <p className="text-sm leading-7">{review.text}</p>
        </div>
        <div className="flex flex-wrap gap-2 pl-1 text-xs text-muted-foreground">
          <span className="font-mono text-[11px]">
            Updated {review.updatedAt.toLowerCase()}
          </span>
          <span>·</span>
          <span>{review.language}</span>
        </div>

        {review.publishedReply ? (
          <div className="flex max-w-[92%] flex-col gap-2 self-end md:max-w-[82%]">
            <div className="rounded-(--nr-radius-card) rounded-tr-md border border-primary/25 bg-accent p-4 text-accent-foreground md:p-5">
              <p className="text-sm leading-7">{review.publishedReply}</p>
            </div>
            <p className="pr-1 text-right text-xs text-muted-foreground">
              Published business reply · {review.responseTime ?? "Published"}
            </p>
          </div>
        ) : null}
      </section>

      {detail?.media.length ? (
        <section className="flex flex-col gap-3" aria-label="Review media">
          <h3 className="text-sm font-medium">Review media</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {detail.media.map((item) => (
              <a
                key={item.id}
                href={item.videoUrl ?? item.thumbnailUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border bg-muted/30"
              >
                {item.thumbnailUrl ? (
                  <span
                    className="block aspect-video bg-cover bg-center"
                    style={{ backgroundImage: `url("${item.thumbnailUrl}")` }}
                    role="img"
                    aria-label={item.thumbnailLabel ?? "Review media thumbnail"}
                  />
                ) : (
                  <span className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
                    Open review video
                  </span>
                )}
                <span className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  {item.thumbnailLabel ?? (item.videoUrl ? "Video" : "Photo")}
                  <ArrowLeft className="size-3 rotate-135" aria-hidden />
                </span>
              </a>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Google replies support text only; media attachments are unavailable.
          </p>
        </section>
      ) : null}

      {review.status === "published" ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Reply published</AlertTitle>
          <AlertDescription>
            Google moderation: {review.googleState ?? "Not reported"} · Response
            time {review.responseTime ?? "Not available"}
          </AlertDescription>
        </Alert>
      ) : review.status === "escalated" ? (
        <Alert variant="destructive">
          <Activity />
          <AlertTitle>Escalation review required</AlertTitle>
          <AlertDescription>
            {detail?.reply?.googlePolicyViolation
              ? `Google rejected the reply: ${detail.reply.googlePolicyViolation}. Edit and verify it before publishing again.`
              : "This review should be checked by a manager before publishing. Verification can warn, but it cannot resolve the customer issue."}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <section
          aria-labelledby="reply-draft-heading"
          className="flex min-w-0 flex-col gap-4 rounded-(--nr-radius-panel) border bg-card p-4 shadow-(--nr-shadow-card) md:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <WandSparkles className="size-4 text-primary" aria-hidden />
              <h3 id="reply-draft-heading" className="text-sm font-semibold">
                Reply draft
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Field orientation="horizontal" className="w-auto gap-2">
                <FieldLabel htmlFor="reply-language">
                  Reply language
                </FieldLabel>
                <Select
                  value={replyLanguage}
                  onValueChange={(value) => {
                    if (value) setReplyLanguage(value)
                  }}
                >
                  <SelectTrigger id="reply-language" size="sm">
                    <SelectValue>
                      {REPLY_LANGUAGES.find(
                        ([code]) => code === replyLanguage
                      )?.[1] ?? "Auto (detected)"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {REPLY_LANGUAGES.map(([code, label]) => (
                        <SelectItem key={code} value={code}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal" className="w-auto gap-2">
                <FieldLabel htmlFor="reply-tone">Tone</FieldLabel>
                <Select
                  value={tone}
                  onValueChange={(value) => {
                    if (value) setTone(value as DraftTone)
                  }}
                >
                  <SelectTrigger id="reply-tone" size="sm">
                    <SelectValue>
                      {tone === "warm_professional"
                        ? "Warm professional"
                        : tone === "concise"
                          ? "Concise"
                          : "Empathetic"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="warm_professional">
                        Warm professional
                      </SelectItem>
                      <SelectItem value="concise">Concise</SelectItem>
                      <SelectItem value="empathetic">Empathetic</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <Field>
            <FieldLabel htmlFor={`reply-draft-${review.id}`}>
              Reply draft
            </FieldLabel>
            <Textarea
              id={`reply-draft-${review.id}`}
              key={review.id}
              value={draft}
              onChange={(event) => {
                setDraft(readControlValue(event))
                setFeedback("")
              }}
              rows={8}
              aria-describedby={`reply-count-${review.id}`}
              className="min-h-44 resize-y bg-background text-sm leading-6"
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              id={`reply-count-${review.id}`}
              className="font-mono text-[11px] text-muted-foreground"
            >
              {new TextEncoder().encode(draft).length} / 4096 bytes
            </span>
            <span className="text-[11px] text-muted-foreground">
              Original language: {review.language}
            </span>
          </div>

          {feedback ? (
            <p
              className="text-xs text-destructive"
              role="status"
              aria-live="polite"
            >
              {feedback}
            </p>
          ) : null}

          <div className="flex flex-wrap items-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={regenerate} disabled={isPending}>
              {isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Sparkles data-icon="inline-start" />
              )}
              Regenerate
            </Button>
            <Button
              variant="secondary"
              onClick={saveDraft}
              disabled={isPending || !draft.trim()}
            >
              Save draft
            </Button>
            <div className="flex w-full flex-col items-stretch gap-1.5 sm:ml-auto sm:w-auto sm:items-end">
              <p className="text-[11px] text-muted-foreground">
                Published replies are public on Google; approval may be
                required.
              </p>
              {review.status === "awaiting_approval" ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <AlertDialog
                    open={rejectOpen}
                    onOpenChange={setRejectOpen}
                  >
                    <AlertDialogTrigger
                      render={
                        <Button variant="outline" disabled={isPending}>
                          <X data-icon="inline-start" />
                          Reject
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Return reply to draft?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Add an optional note so the author knows what to
                          revise.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <Textarea
                        value={rejectionNote}
                        onChange={(event) =>
                          setRejectionNote(event.target.value)
                        }
                        placeholder="Optional rejection note"
                        aria-label="Rejection note"
                      />
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={rejectApproval}>
                          Return to draft
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button onClick={approve} disabled={isPending}>
                    <Check data-icon="inline-start" />
                    Approve and publish
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={publish}
                  disabled={
                    isPending ||
                    review.verification === "pending" ||
                    review.verification === "fail" ||
                    !draft.trim()
                  }
                >
                  <Send data-icon="inline-start" />
                  {review.status === "published"
                    ? "Update reply"
                    : "Publish reply"}
                </Button>
              )}
            </div>
          </div>
        </section>

        <aside
          aria-label="Reply lifecycle"
          className="flex flex-col gap-5 rounded-(--nr-radius-panel) border bg-card p-4 shadow-(--nr-shadow-card) md:p-5"
        >
          <VerificationPanel review={review} />
          <Separator />
          <ActivityTimeline events={detail?.timeline} error={detailError} />
        </aside>
      </div>
    </div>
  )
}
