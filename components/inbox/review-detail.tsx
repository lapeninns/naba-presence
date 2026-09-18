"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { QueryError } from "@/components/ui/query-states"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { ReplyException } from "@/components/inbox/detail/reply-exception"
import { ReplyStatusLine } from "@/components/inbox/detail/reply-status-line"
import { ReviewMetadata } from "@/components/inbox/detail/review-metadata"
import { StarRating } from "@/components/inbox/star-rating"
import { SITUATION_TONE_ICON } from "@/components/inbox/situation-tone"
import { useIsDirty } from "@/components/inbox/dirty-context"
import { formatDateTime, formatRelativeTime } from "@/lib/format"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import {
  derivePrimaryAction,
  deriveReplyStatus,
  type ReplyPendingKind,
  type ReplyStateInput,
} from "@/lib/inbox/reply-state"
import { describeReplyState, replyWork } from "@/lib/inbox/review-situation"
import { parseReviewText } from "@/lib/inbox/review-text"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { useReplyPending } from "@/lib/queries/use-reply-pending"
import { cn } from "@/lib/utils"
import { PUBLISH_PULSE_EVENT, PUBLISH_PULSE_MS } from "@/lib/inbox/events"

type Review = ReviewDetailData["review"]

// "it" -> "Italian", so the translation line names the language rather than
// showing operators a bare BCP-47 tag. Unknown or malformed codes fall back to
// no name at all instead of leaking the code into the UI.
function languageName(code: string | null): string | null {
  if (!code) return null
  try {
    const name = new Intl.DisplayNames(["en-GB"], { type: "language" }).of(code)
    return name && name.toLowerCase() !== code.toLowerCase() ? name : null
  } catch {
    return null
  }
}

/**
 * The review as the status ladder sees it.
 *
 * `approvalScope` follows `canPublish` here and nowhere else: this pane offers
 * a specific action, `evaluateApproval` gates that action on `canPublish`, and
 * the status must describe the action actually on screen. A list row has no
 * action and therefore does not guess — see `replyStateFromRow`.
 */
function replyStateFor(
  review: Review,
  isDirty: boolean,
  pending: ReplyPendingKind | null
): ReplyStateInput {
  return {
    workflowStatus: review.workflowStatus,
    capabilities: review.capabilities,
    reply: review.reply
      ? { body: review.reply.body, publishStatus: review.reply.publishStatus }
      : null,
    drafts: review.drafts,
    verification: review.latestVerification,
    isDirty,
    pending,
    approvalScope: review.capabilities.canPublish ? "me" : "others",
  }
}

/**
 * Reviewer · rating · venue · age, and everything else behind an info control.
 *
 * Four facts, one line. The old header spent three rows and a 48px avatar on
 * the same four, which pushed the customer's actual words below the fold on a
 * 1280px screen — in a pane whose entire job is reading them.
 */
function ReviewIdentity({ review }: { review: Review }) {
  const displayName = review.reviewerIsAnonymous
    ? "Anonymous"
    : (review.reviewerDisplayName ?? "Anonymous")

  return (
    <div className="flex items-start gap-2 border-b border-line-subtle px-(--np-card-pad) pt-2 pb-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-section font-semibold tracking-tight text-ink">
          {displayName}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
          <StarRating rating={review.rating} size="md" tone="neutral" />
          <span aria-hidden>·</span>
          <span className="break-words">{review.locationName}</span>
          <span aria-hidden>·</span>
          <time
            dateTime={review.createTime}
            title={formatDateTime(review.createTime, review.timezone)}
            className="whitespace-nowrap tabular-nums"
          >
            {formatRelativeTime(review.createTime)}
          </time>
        </div>
      </div>
      <ReviewMetadata review={review} />
    </div>
  )
}

/**
 * The reviewer's words. A Google-translated review is split into translation
 * and original, each correctly tagged, with the original one click away
 * instead of glued to the end of the same paragraph.
 */
function ReviewBody({ review }: { review: Review }) {
  const [showOriginal, setShowOriginal] = useState(false)
  const parsed = parseReviewText(review.text, review.detectedLanguageCode)

  if (!parsed) {
    return (
      <p className="text-body text-ink-muted italic">
        A rating with no written review.
      </p>
    )
  }

  const original = parsed.original
  const originalLanguage = languageName(parsed.originalLang)

  return (
    <div className="flex flex-col gap-2">
      <blockquote
        lang={parsed.bodyLang ?? undefined}
        dir="auto"
        className="text-body leading-relaxed whitespace-pre-line text-ink"
      >
        {parsed.body}
      </blockquote>

      {original ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
            <GlobeIcon
              aria-hidden
              strokeWidth={1.75}
              className="size-3.5 shrink-0"
            />
            <span>
              {originalLanguage
                ? `Translated from ${originalLanguage}`
                : "Translated by Google"}
            </span>
            <span aria-hidden>·</span>
            <Button
              variant="link"
              size="xs"
              aria-expanded={showOriginal}
              onClick={() => setShowOriginal((value) => !value)}
              className="h-auto p-0 text-caption"
            >
              {showOriginal ? "Hide original" : "Show original"}
            </Button>
          </div>
          {showOriginal ? (
            <blockquote
              lang={parsed.originalLang ?? undefined}
              dir="auto"
              className="border-t border-line-subtle pt-2 text-body whitespace-pre-line text-ink-muted"
            >
              {original}
            </blockquote>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function ReviewMedia({ media }: { media: Review["media"] }) {
  // A media row with neither a thumbnail nor a video is nothing to render —
  // the old grid emitted an empty <li> for each one, leaving phantom gaps.
  const items = media.filter((item) => item.thumbnailUrl ?? item.videoUrl)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  if (items.length === 0) return null

  const active = activeIndex !== null ? (items[activeIndex] ?? null) : null
  const activeLabel = active
    ? (active.thumbnailLabel ??
      (active.videoUrl ? "Review video" : "Review photo"))
    : ""
  const hasMultiple = items.length > 1

  function showPrevious() {
    setActiveIndex((index) => {
      if (index === null) return index
      return (index - 1 + items.length) % items.length
    })
  }

  function showNext() {
    setActiveIndex((index) => {
      if (index === null) return index
      return (index + 1) % items.length
    })
  }

  return (
    <section
      aria-label={`${items.length} attached ${items.length === 1 ? "photo or video" : "photos and videos"}`}
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
        {items.map((item, index) => {
          const label =
            item.thumbnailLabel ??
            (item.videoUrl ? "Review video" : "Review photo")
          return (
            <li key={item.id} className="relative">
              <button
                type="button"
                aria-label={`Open ${label}`}
                onClick={() => setActiveIndex(index)}
                className="relative block w-full overflow-hidden rounded-(--np-radius-control) bg-fill focus-halo hairline transition duration-(--np-duration-fast) ease-spring-snappy focus-visible:[box-shadow:var(--np-focus-halo),var(--np-shadow-hairline)] active:scale-[0.98]"
              >
                {item.thumbnailUrl ? (
                  // Remote Google CDN thumbnails, not project assets — next/image
                  // cannot optimise them and would need every host allowlisted.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <span className="flex aspect-square w-full items-center justify-center text-ink-muted">
                    <PlayIcon
                      aria-hidden
                      strokeWidth={1.75}
                      className="size-4"
                    />
                  </span>
                )}
                {item.videoUrl ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  >
                    <span className="flex size-6 items-center justify-center rounded-(--np-radius-pill) bg-surface/85 text-ink shadow-(--np-shadow-raised)">
                      <PlayIcon className="size-3" />
                    </span>
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      <Dialog
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActiveIndex(null)
        }}
      >
        <DialogContent
          className="max-w-[min(42rem,calc(100%-2rem))] gap-3 p-3 sm:max-w-2xl"
          aria-label={activeLabel}
          onKeyDown={(event) => {
            if (!hasMultiple) return
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              showPrevious()
            } else if (event.key === "ArrowRight") {
              event.preventDefault()
              showNext()
            }
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{activeLabel}</DialogTitle>
            <DialogDescription>Attached review media</DialogDescription>
          </DialogHeader>
          <div className="relative">
            {active?.videoUrl ? (
              // Google-hosted review video — same remote-host constraint as images.
              <video
                key={active.id}
                src={active.videoUrl}
                controls
                autoPlay
                playsInline
                poster={active.thumbnailUrl ?? undefined}
                className="max-h-[min(70vh,36rem)] w-full rounded-(--np-radius-control) bg-black"
              />
            ) : active?.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.thumbnailUrl}
                alt={activeLabel}
                className="max-h-[min(70vh,36rem)] w-full rounded-(--np-radius-control) object-contain"
              />
            ) : null}
            {hasMultiple ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  pill
                  aria-label="Previous media"
                  onClick={showPrevious}
                  className="absolute top-1/2 left-2 -translate-y-1/2 shadow-(--np-shadow-raised)"
                >
                  <ChevronLeftIcon aria-hidden strokeWidth={1.75} />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  pill
                  aria-label="Next media"
                  onClick={showNext}
                  className="absolute top-1/2 right-2 -translate-y-1/2 shadow-(--np-shadow-raised)"
                >
                  <ChevronRightIcon aria-hidden strokeWidth={1.75} />
                </Button>
                <p className="mt-2 text-center text-caption text-ink-muted tabular-nums">
                  {(activeIndex ?? 0) + 1} of {items.length}
                </p>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * What is on Google right now — but ONLY when it differs from what the
 * composer is holding. When they match (the common case) showing it would be
 * the same text twice, which is exactly what the old pane did.
 */
function LiveReplyDisclosure({ review }: { review: Review }) {
  const [open, setOpen] = useState(false)
  const reply = review.reply
  const work = replyWork(review)
  const inComposer = work.draftBody ?? work.liveBody
  if (!reply?.body || reply.body === inComposer) return null

  const state = describeReplyState(reply.publishStatus)
  const Icon = SITUATION_TONE_ICON[state.tone]
  const at = reply.googleReplyUpdatedAt

  return (
    <section className="rounded-(--np-radius-control) bg-surface-sunken">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-(--np-radius-control) px-3 py-2 text-left text-caption focus-halo transition duration-(--np-duration-fast) ease-spring-snappy hover:bg-fill focus-visible:outline-none"
        >
          <ChevronRightIcon
            aria-hidden
            strokeWidth={1.75}
            className={cn(
              "size-3.5 shrink-0 text-ink-muted transition-transform duration-(--np-duration-fast) ease-spring-snappy",
              open && "rotate-90"
            )}
          />
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            <Icon aria-hidden strokeWidth={1.75} className="size-3.5" />
            {state.label}
          </span>
          <span className="text-ink-muted">differs from the reply below</span>
          {at ? (
            <time dateTime={at} className="ml-auto text-ink-muted tabular-nums">
              {formatDateTime(at, review.timezone)}
            </time>
          ) : null}
        </button>
      </h3>
      {open ? (
        <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
          <p dir="auto" className="text-body whitespace-pre-line text-ink">
            {reply.body}
          </p>
          {reply.googlePolicyViolation ? (
            <p className="flex items-start gap-1.5 text-caption text-danger-ink">
              <TriangleAlertIcon
                aria-hidden
                strokeWidth={1.75}
                className="mt-0.5 size-3.5 shrink-0"
              />
              Google flagged this reply: {reply.googlePolicyViolation}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/**
 * The one status line, above the reply it describes.
 *
 * It is a `role="status"` so a change announces itself, and it is the only
 * status surface in the pane. It comes out of the same ladder the footer's
 * button obeys, so "Ready to publish" and a live Publish button are the same
 * fact stated twice, never two facts.
 */
function ReplyStatusStrip({ review }: { review: Review }) {
  const [pulse, setPulse] = useState(false)
  const isDirty = useIsDirty()
  const mutating = useReplyPending(review.id)
  const action = derivePrimaryAction(replyStateFor(review, isDirty, null))
  const pending: ReplyPendingKind | null =
    mutating === "publish"
      ? action.kind === "submit"
        ? "submit"
        : "publish"
      : mutating === "approval"
        ? "approve"
        : mutating === "draft"
          ? "save"
          : null
  const status = deriveReplyStatus(replyStateFor(review, isDirty, pending))

  // The ring stays up for PUBLISH_PULSE_MS — the same constant InboxView waits
  // on before advancing — so the pulse is actually on screen before this
  // unmounts.
  const pulseTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    function onPublished(event: Event) {
      const detail = (event as CustomEvent<{ reviewId?: string }>).detail
      if (detail?.reviewId !== review.id) return
      setPulse(true)
      window.clearTimeout(pulseTimer.current)
      pulseTimer.current = window.setTimeout(() => {
        pulseTimer.current = undefined
        setPulse(false)
      }, PUBLISH_PULSE_MS)
    }
    window.addEventListener(PUBLISH_PULSE_EVENT, onPublished)
    return () => {
      window.removeEventListener(PUBLISH_PULSE_EVENT, onPublished)
      window.clearTimeout(pulseTimer.current)
      pulseTimer.current = undefined
    }
  }, [review.id])

  return (
    <div
      role="status"
      data-slot="reply-status-strip"
      data-pulse={pulse ? "true" : undefined}
      className={cn(
        "flex min-h-6 items-center rounded-(--np-radius-tag) transition-[box-shadow] duration-(--np-duration-deliberate) ease-spring",
        pulse && "px-1.5 ring-2 ring-(--np-success-line) ring-inset"
      )}
    >
      <ReplyStatusLine status={status} />
    </div>
  )
}

function ActionFooterSkeleton() {
  return (
    <div className="flex justify-end gap-2" aria-hidden>
      <Skeleton className="h-(--np-control-h) w-28 rounded-(--np-radius-pill)" />
    </div>
  )
}

function PaneHeader({
  leading,
  navigation,
}: {
  leading?: ReactNode
  navigation?: ReactNode
}) {
  if (!leading && !navigation) return null
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-2">
      {leading ? <div className="min-w-0 lg:hidden">{leading}</div> : null}
      {navigation ? (
        <div className="ml-auto flex shrink-0 items-center">{navigation}</div>
      ) : null}
    </div>
  )
}

function ReviewDetail({
  reviewId,
  leading,
  navigation,
  composer,
  actions,
}: {
  reviewId: string
  /** Slot at the head of the pinned header (the mobile return-to-list control). */
  leading?: ReactNode
  /** Previous / next review controls, pinned in the pane chrome. */
  navigation?: ReactNode
  /** The reply workspace — preview or composer — inside the reading column. */
  composer?: ReactNode
  /** The applicable primary action, pinned at the foot so it never scrolls away. */
  actions?: ReactNode
}) {
  const query = useReviewDetail(reviewId)

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
        <PaneHeader leading={leading} navigation={navigation} />
        <div className="flex flex-col gap-2 border-b border-line-subtle px-(--np-card-pad) pt-2 pb-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-(--np-card-pad)">
          <Skeleton className="h-24 w-full rounded-(--np-radius-control)" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-28 w-full rounded-(--np-radius-control)" />
        </div>
        {actions ? (
          <footer className="shrink-0 border-t border-line-subtle px-(--np-card-pad) py-2.5">
            <ActionFooterSkeleton />
          </footer>
        ) : null}
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneHeader leading={leading} navigation={navigation} />
        <QueryError
          title="We could not load this review."
          cause={query.error}
          onRetry={() => void query.refetch()}
          className="p-(--np-card-pad)"
        />
      </div>
    )
  }

  const review = query.data.review

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader leading={leading} navigation={navigation} />
      <ReviewIdentity review={review} />

      {/* One reading order, one scroll region: what the customer said, then
          the reply, then anything that is in the way of sending it, then the
          history last and collapsed. The five-stage tracker that used to sit
          above all of this is now inside the exception's disclosure — it was
          permanent chrome answering a question most reviews never raise. */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        data-slot="inbox-detail-scroll"
      >
        {/* A measure, not a column width. Past about 70 characters the eye
            loses the start of the next line, and the pane is now wide enough
            at 1440px to run well past that. */}
        <div className="flex w-full max-w-[72ch] flex-col gap-5 self-center p-(--np-card-pad)">
          <section aria-label="Customer review" className="flex flex-col gap-3">
            <h3 className="text-caption font-medium text-ink-muted">
              Customer review
            </h3>
            <ReviewBody review={review} />
            <ReviewMedia media={review.media} />
          </section>

          <section
            aria-label="Your reply"
            className="flex flex-col gap-3 border-t border-line-subtle pt-5"
          >
            <ReplyStatusStrip review={review} />
            <LiveReplyDisclosure review={review} />
            {composer}
            <ReplyExceptionSlot review={review} />
          </section>

          <ActivityTimeline
            timeline={review.timeline}
            timezone={review.timezone}
            collapsible
          />
        </div>
      </div>

      {actions ? (
        <footer className="shrink-0 border-t border-line-subtle bg-surface px-(--np-card-pad) py-2.5">
          {actions}
        </footer>
      ) : null}
    </div>
  )
}

/** The exception needs the same dirty state the status and the footer read. */
function ReplyExceptionSlot({ review }: { review: Review }) {
  const isDirty = useIsDirty()
  const action = derivePrimaryAction(replyStateFor(review, isDirty, null))
  return <ReplyException review={review} action={action} />
}

export { ReviewDetail }
