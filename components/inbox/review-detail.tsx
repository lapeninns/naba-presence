"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  GlobeIcon,
  MapPinIcon,
  PlayIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { StarRating } from "@/components/inbox/star-rating"
import {
  SITUATION_TONE_CHIP,
  SITUATION_TONE_ICON,
  SITUATION_TONE_STRIP,
} from "@/components/inbox/situation-tone"
import { formatDateTime } from "@/lib/format"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import {
  describeReplyState,
  describeSituation,
  replyWork,
} from "@/lib/inbox/review-situation"
import { parseReviewText } from "@/lib/inbox/review-text"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { cn } from "@/lib/utils"
import { PUBLISH_PULSE_EVENT, PUBLISH_PULSE_MS } from "@/lib/inbox/events"

type Review = ReviewDetailData["review"]

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

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

function PaneHeader({
  leading,
  navigation,
  children,
  strip,
}: {
  leading?: ReactNode
  navigation?: ReactNode
  children?: ReactNode
  strip?: ReactNode
}) {
  return (
    <header className="flex shrink-0 flex-col border-b border-border/60">
      {leading || navigation ? (
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          {leading ? <div className="min-w-0 lg:hidden">{leading}</div> : null}
          {navigation ? (
            <div className="ml-auto flex shrink-0 items-center">{navigation}</div>
          ) : null}
        </div>
      ) : null}
      <div className="@container/review-identity flex items-center gap-3 px-4 py-3 sm:px-5">
        {children}
      </div>
      {strip}
    </header>
  )
}

/**
 * The pane's single status surface. It replaces the old header badge, and it
 * says what to do next rather than naming an internal workflow state.
 */
function SituationStrip({ review }: { review: Review }) {
  const [pulse, setPulse] = useState(false)
  const work = replyWork(review)
  const situation = describeSituation({
    workflowStatus: review.workflowStatus,
    verification: review.latestVerification,
    hasLiveReply: work.liveBody !== null,
    hasUnpublishedChanges: work.hasUnpublishedChanges,
    hasDraft: work.draftBody !== null,
    hasVerifiedDraft: review.drafts.some(
      (draft) =>
        draft.verificationStatus === "pass" ||
        draft.verificationStatus === "warn"
    ),
    canPublish: review.capabilities.canPublish,
    canRequestApproval: review.capabilities.canRequestApproval,
  })
  const Icon = SITUATION_TONE_ICON[situation.tone]

  // The ring stays up for PUBLISH_PULSE_MS — the same constant InboxView waits
  // on before advancing — so the pulse is visible before this strip unmounts.
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
      className={cn(
        "flex items-start gap-2 px-4 py-2 text-ui transition-[box-shadow,background-color] duration-(--nr-duration-deliberate)",
        SITUATION_TONE_STRIP[situation.tone],
        pulse && "ring-2 ring-success/50 ring-inset"
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0">
        <span className="font-semibold">{situation.headline}</span>
        <span className="hidden sm:inline" aria-hidden>
          {" "}
          ·{" "}
        </span>
        <span className="mt-0.5 block text-muted-foreground sm:mt-0 sm:inline">
          {situation.detail}
        </span>
      </p>
    </div>
  )
}

function ReviewerIdentity({ review }: { review: Review }) {
  const displayName = review.reviewerIsAnonymous
    ? "Anonymous"
    : (review.reviewerDisplayName ?? "Anonymous")
  const photoUrl =
    !review.reviewerIsAnonymous && review.reviewerProfilePhotoUrl
      ? review.reviewerProfilePhotoUrl
      : null
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <Avatar className="size-11 text-ui @min-[32rem]/review-identity:size-12">
        {photoUrl ? <AvatarImage src={photoUrl} alt="" /> : null}
        <AvatarFallback>{initials(displayName)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 @min-[32rem]/review-identity:flex-row @min-[32rem]/review-identity:items-start @min-[32rem]/review-identity:justify-between @min-[32rem]/review-identity:gap-6">
        <div className="min-w-0">
          <h2 className="truncate text-title font-semibold">{displayName}</h2>
          <div className="mt-0.5">
            <StarRating rating={review.rating} size="md" />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 text-caption text-muted-foreground @min-[32rem]/review-identity:shrink-0 @min-[32rem]/review-identity:items-end">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <MapPinIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{review.locationName}</span>
          </span>
          <time
            dateTime={review.createTime}
            className="inline-flex items-center gap-1.5 tabular-nums"
          >
            <ClockIcon aria-hidden className="size-3.5 shrink-0" />
            {formatDateTime(review.createTime, review.timezone)}
          </time>
        </div>
      </div>
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
      <p className="rounded-(--nr-radius-field) bg-muted/80 px-4 py-3 text-body text-muted-foreground italic">
        A rating with no written review.
      </p>
    )
  }

  const original = parsed.original
  const originalLanguage = languageName(parsed.originalLang)

  return (
    <div className="flex flex-col gap-2 rounded-(--nr-radius-field) bg-muted/80 px-4 py-3">
      <blockquote
        lang={parsed.bodyLang ?? undefined}
        dir="auto"
        className="text-body whitespace-pre-line"
      >
        {parsed.body}
      </blockquote>

      {original ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
            <GlobeIcon aria-hidden className="size-3.5 shrink-0" />
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
              className="border-t border-border/60 pt-2 text-body whitespace-pre-line text-muted-foreground"
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
                className="relative block w-full overflow-hidden rounded-(--nr-radius-control) border border-border/60 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
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
                  <span className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
                    <PlayIcon aria-hidden className="size-4" />
                  </span>
                )}
                {item.videoUrl ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center"
                  >
                    <span className="flex size-6 items-center justify-center rounded-full bg-background/80 text-foreground">
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
                className="max-h-[min(70vh,36rem)] w-full rounded-(--nr-radius-control) bg-black"
              />
            ) : active?.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.thumbnailUrl}
                alt={activeLabel}
                className="max-h-[min(70vh,36rem)] w-full rounded-(--nr-radius-control) object-contain"
              />
            ) : null}
            {hasMultiple ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  aria-label="Previous media"
                  onClick={showPrevious}
                  className="absolute top-1/2 left-2 -translate-y-1/2"
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  aria-label="Next media"
                  onClick={showNext}
                  className="absolute top-1/2 right-2 -translate-y-1/2"
                >
                  <ChevronRightIcon aria-hidden />
                </Button>
                <p className="mt-2 text-center text-caption text-muted-foreground tabular-nums">
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
    <section className="rounded-(--nr-radius-field) border border-dashed border-border">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-(--nr-radius-field) px-3 py-2 text-caption focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-(--nr-radius-pill) px-2 py-0.5 font-medium",
              SITUATION_TONE_CHIP[state.tone]
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {state.label}
          </span>
          <span className="text-muted-foreground">
            differs from the reply below
          </span>
          {at ? (
            <time
              dateTime={at}
              className="ml-auto text-muted-foreground tabular-nums"
            >
              {formatDateTime(at, review.timezone)}
            </time>
          ) : null}
        </button>
      </h3>
      {open ? (
        <div className="flex flex-col gap-2 px-3 pt-1 pb-3">
          <p dir="auto" className="text-body whitespace-pre-line">
            {reply.body}
          </p>
          {reply.googlePolicyViolation ? (
            <p className="flex items-start gap-1.5 text-caption text-destructive">
              <TriangleAlertIcon
                aria-hidden
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

function ActionFooterSkeleton() {
  return (
    <div className="flex justify-end gap-2" aria-hidden>
      <Skeleton className="h-8 w-28 rounded-(--nr-radius-control)" />
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
  /** Reply workspace, rendered after the review in the scroll region. */
  composer?: ReactNode
  /** Lifecycle actions, pinned below the scroll region so the CTA never scrolls away. */
  actions?: ReactNode
}) {
  const query = useReviewDetail(reviewId)

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
        <PaneHeader leading={leading} navigation={navigation}>
          <Skeleton className="size-10 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-36 rounded-(--nr-radius-tag)" />
            <Skeleton className="h-3 w-52 rounded-(--nr-radius-tag)" />
          </div>
        </PaneHeader>
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-24 w-full rounded-(--nr-radius-card)" />
          <Skeleton className="h-40 w-full rounded-(--nr-radius-card)" />
        </div>
        {actions ? (
          <footer className="shrink-0 border-t border-border/60 px-4 py-3">
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
          className="p-6"
        />
      </div>
    )
  }

  const review = query.data.review

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader
        leading={leading}
        navigation={navigation}
        strip={<SituationStrip review={review} />}
      >
        <ReviewerIdentity review={review} />
      </PaneHeader>

      {/* One scroll region ordered as the task runs: read what they said, then
          write. The live reply appears only when it disagrees with the draft,
          and the audit trail is reference so it sits last and collapsed. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
        <ReviewBody review={review} />
        <ReviewMedia media={review.media} />
        <LiveReplyDisclosure review={review} />
        {composer}
        <ActivityTimeline
          timeline={review.timeline}
          timezone={review.timezone}
          collapsible
        />
      </div>

      {actions ? (
        <footer className="shrink-0 border-t border-border/60 px-4 py-3">
          {actions}
        </footer>
      ) : null}
    </div>
  )
}

export { ReviewDetail }
