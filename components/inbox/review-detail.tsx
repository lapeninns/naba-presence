"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HistoryIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PlayIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react"
import Link from "next/link"

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Stars } from "@/components/ui/stars"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { ReplyException } from "@/components/inbox/detail/reply-exception"
import { ReplyStatusLine } from "@/components/inbox/detail/reply-status-line"
import { ReviewMetadata } from "@/components/inbox/detail/review-metadata"
import { wasEdited } from "@/components/inbox/review-list"
import { SITUATION_TONE_ICON } from "@/components/inbox/situation-tone"
import { TYPING_COLLAPSE_CLASS } from "@/components/inbox/typing-collapse"
import { useComposerSave, useIsDirty } from "@/components/inbox/dirty-context"
import { formatDateTime, formatRelativeTime } from "@/lib/format"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import {
  derivePrimaryAction,
  deriveReplyStatus,
  type ReplyPendingKind,
  type ReplyStateInput,
  type ReplyStatus,
} from "@/lib/inbox/reply-state"
import {
  describeReplyState,
  isLiveOnGoogle,
  replyWork,
} from "@/lib/inbox/review-situation"
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

function reviewerName(review: Review): string {
  return review.reviewerIsAnonymous
    ? "Anonymous"
    : (review.reviewerDisplayName ?? "Anonymous")
}

function initialsOf(name: string): string {
  // Whole characters, not UTF-16 halves, so a name that opens with an
  // astral-plane letter or emoji keeps it intact.
  return name
    .trim()
    .split(/\s+/)
    .map((part) => Array.from(part)[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase()
}

// The thread's rail: a 44px avatar column (32px in a narrow pane) beside the
// words, so the review and the reply read as one conversation.
const THREAD_ITEM_CLASS =
  "grid grid-cols-[44px_minmax(0,1fr)] gap-x-3.5 @max-[480px]/detail:grid-cols-[32px_minmax(0,1fr)] @max-[480px]/detail:gap-x-3"
const THREAD_AVATAR_CLASS =
  "@max-[480px]/detail:size-8 @max-[480px]/detail:text-caption"

/**
 * Who wrote it: the Google profile photo when there is one, else initials;
 * a person glyph for an anonymous reviewer. Decorative — the name beside it
 * is the accessible identity.
 */
function ReviewerAvatar({ review }: { review: Review }) {
  const name = reviewerName(review)
  return (
    <Avatar size="lg" aria-hidden className={THREAD_AVATAR_CLASS}>
      {!review.reviewerIsAnonymous && review.reviewerProfilePhotoUrl ? (
        <AvatarImage
          src={review.reviewerProfilePhotoUrl}
          alt=""
          referrerPolicy="no-referrer"
        />
      ) : null}
      <AvatarFallback>
        {review.reviewerIsAnonymous ? (
          <UserIcon aria-hidden strokeWidth={1.75} className="size-4" />
        ) : (
          initialsOf(name)
        )}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * Whose review this is — the name and one meta line (stars, when, and that
 * it is a Google review) — at the head of the thread. It says nothing about
 * the reply; that is said once, at the head of the reply row.
 */
function ReviewerIdentity({
  review,
  focusHeading = false,
}: {
  review: Review
  focusHeading?: boolean
}) {
  const displayName = reviewerName(review)
  // Focus lands on the name once, when this review is where an advance
  // arrived. The pane is keyed on the review, so "once" is once per review.
  const headingRef = useRef<HTMLHeadingElement>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focusHeading || focused.current) return
    focused.current = true
    headingRef.current?.focus()
  }, [focusHeading])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <h2
        ref={headingRef}
        tabIndex={-1}
        data-slot="review-heading"
        className="line-clamp-2 min-w-0 font-display text-[17px] leading-snug font-semibold break-words text-ink focus-visible:outline-none"
      >
        {displayName}
      </h2>
      <p
        data-slot="review-meta"
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-5 text-ink-muted"
      >
        {review.rating !== null ? (
          <>
            <Stars
              value={review.rating}
              size="sm"
              label={`Rated ${review.rating} out of 5`}
            />
            <span aria-hidden>·</span>
          </>
        ) : null}
        <time
          dateTime={review.createTime}
          title={formatDateTime(review.createTime, review.timezone)}
          className="tabular-nums"
        >
          {formatRelativeTime(review.createTime)}
        </time>
        {wasEdited(review.createTime, review.updateTime) ? (
          <time
            dateTime={review.updateTime}
            title={formatDateTime(review.updateTime, review.timezone)}
            className="tabular-nums"
          >
            · edited {formatRelativeTime(review.updateTime)}
          </time>
        ) : null}
        <span aria-hidden>·</span>
        <span>Google review</span>
      </p>
    </div>
  )
}

/**
 * The ⋯ menu beside the reviewer: everything that is true but not part of
 * replying — the listing, the history and the review's details.
 */
function ReviewMenu({ review }: { review: Review }) {
  // The dialogs open from menu items that unmount with the menu, so focus
  // is handed back to the ⋯ trigger when they close.
  const moreRef = useRef<HTMLButtonElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={moreRef}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More actions"
              className="-mt-1 shrink-0 max-md:size-11"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden strokeWidth={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            render={<Link href={`/listings/${review.locationId}`} />}
          >
            <ExternalLinkIcon aria-hidden />
            Open listing
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
            <HistoryIcon aria-hidden />
            History
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
            <InfoIcon aria-hidden />
            Review details
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg" finalFocus={moreRef}>
          <DialogHeader>
            <DialogTitle>History</DialogTitle>
            <DialogDescription>
              Everything that has happened to this review and its reply.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(60vh,32rem)] overflow-y-auto">
            <ActivityTimeline
              timeline={review.timeline}
              timezone={review.timezone}
            />
          </div>
        </DialogContent>
      </Dialog>
      <ReviewMetadata
        review={review}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        finalFocus={moreRef}
      />
    </>
  )
}

/**
 * The head's frame, shared by the loading, error and loaded pane so the
 * return-to-list control is the SAME element throughout: it takes focus
 * when a review opens on a phone, and a control that was swapped for a new
 * one when the review arrived would drop that focus. It holds nothing else —
 * who wrote the review is at the head of the thread — so it is a phone-only
 * row.
 */
function HeadFrame({ leading }: { leading?: ReactNode }) {
  if (!leading) return null
  return (
    <div className="shrink-0 border-b border-line md:hidden">
      <div
        data-slot="review-head"
        className="flex min-w-0 items-center gap-1.5 px-2 py-2"
      >
        <div className="shrink-0">{leading}</div>
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
      <p className="font-reading text-[17px] leading-normal text-ink-secondary italic">
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
        className="m-0 font-reading text-reading whitespace-pre-line text-ink"
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
              className="h-auto p-0 text-caption pointer-coarse:min-h-(--np-touch)"
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
 * The one status line, on the publish bar beside the button it describes.
 *
 * It is a `role="status"` so a change announces itself, and it is the only
 * status surface in the pane. It comes out of the same ladder the footer's
 * button obeys, so "Ready to publish" and a live Publish button are the same
 * fact stated twice, never two facts. When the button is off, this line is
 * where the reason is said.
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
  const composerSave = useComposerSave()
  const derived = deriveReplyStatus(replyStateFor(review, isDirty, pending))
  // Text the composer cannot send as it stands (empty, too long) outranks
  // "Ready to publish": the button is off, and this is why.
  const status: ReplyStatus =
    !pending && composerSave?.blockedReason
      ? { ...derived, text: composerSave.blockedReason, icon: "pen" }
      : derived

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
        "flex min-h-8 min-w-0 items-center rounded-(--np-radius-control) transition-[box-shadow] duration-(--np-duration-deliberate) ease-spring",
        pulse && "px-2 ring-2 ring-success-solid ring-inset"
      )}
    >
      <ReplyStatusLine status={status} variant="bar" />
    </div>
  )
}

function ActionFooterSkeleton() {
  return (
    <div className="flex flex-1 justify-end gap-2" aria-hidden>
      <Skeleton className="h-(--np-control-h) w-40 max-md:w-full" />
    </div>
  )
}

/**
 * Where the reply will appear, said once at the head of the reply: private
 * while it is a draft, and what Google holds once something was sent.
 */
function replyVisibility(review: Review): string {
  const status = review.reply?.publishStatus ?? null
  if (!review.reply || !status || status === "not_published") {
    return "Private until you publish"
  }
  const label = describeReplyState(status).label
  return isLiveOnGoogle(status) && replyWork(review).hasUnpublishedChanges
    ? `${label} · your newer draft is not published yet`
    : label
}

/**
 * The review, then the reply: one conversation, the customer's words above
 * the place the answer is written, joined by the rail between the two
 * avatars.
 */
function ReviewThread({
  review,
  composer,
  focusHeading,
}: {
  review: Review
  composer?: ReactNode
  focusHeading?: boolean
}) {
  const displayName = reviewerName(review)

  return (
    <div data-slot="review-thread" className="flex flex-col">
      <article
        aria-label={`Review from ${displayName}`}
        data-slot="thread-review"
        className={cn(THREAD_ITEM_CLASS, "pb-7")}
      >
        <div className="relative">
          <ReviewerAvatar review={review} />
          <span
            aria-hidden
            data-slot="thread-rail"
            className="absolute top-[52px] bottom-2 left-1/2 w-px -translate-x-1/2 bg-line @max-[480px]/detail:top-10"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <ReviewerIdentity review={review} focusHeading={focusHeading} />
            <ReviewMenu review={review} />
          </div>
          <ReviewBody review={review} />
          <ReviewMedia media={review.media} />
        </div>
      </article>

      <section
        aria-label="Your reply"
        data-slot="thread-reply"
        className={THREAD_ITEM_CLASS}
      >
        <div>
          <Avatar
            size="lg"
            shape="square"
            aria-hidden
            className={cn("bg-ink text-canvas", THREAD_AVATAR_CLASS)}
          >
            <AvatarFallback>{initialsOf(review.locationName)}</AvatarFallback>
          </Avatar>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5 @max-[480px]/detail:min-h-8">
            <h3
              data-slot="reply-heading"
              className="min-w-0 text-[15px] leading-snug font-semibold break-words text-ink"
            >
              Reply as {review.locationName}
            </h3>
            <p className="text-[13px] leading-5 text-ink-muted">
              {replyVisibility(review)}
            </p>
          </div>
          <LiveReplyDisclosure review={review} />
          {composer}
        </div>
      </section>
    </div>
  )
}

// The publish bar (reference `.publish`) is sticky at the foot of the screen
// on a phone or a short window, and a static last row of the pane where the
// workspace is locked. A raised band rather than a dark one, so the accent
// Publish button is the one strong thing in it.
const FOOTER_CLASS =
  "sticky bottom-0 z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-b-[calc(var(--np-radius-card)-1px)] border-t border-line bg-surface-alt px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] max-md:rounded-none md:[@media(min-height:620px)]:static md:[@media(min-height:620px)]:pb-3"

// Only this middle row scrolls. The thread keeps a reading measure and
// centres in a wide pane.
const SCROLL_CLASS =
  "flex min-h-0 flex-1 flex-col px-5 pt-6 pb-8 @max-[480px]/detail:px-3.5 @max-[480px]/detail:pt-4 @max-[480px]/detail:pb-6 md:[@media(min-height:620px)]:overflow-y-auto"

const COLUMN_CLASS = "mx-auto flex w-full max-w-[760px] flex-col gap-5"

function ReviewDetail({
  reviewId,
  leading,
  composer,
  actions,
  focusHeading = false,
}: {
  reviewId: string
  /** Accepted for compatibility; the pane no longer names the client. */
  clientName?: string | null
  /** Accepted for compatibility. */
  clientId?: string | null
  /** Accepted for compatibility; the pane no longer draws an avatar for it. */
  organisationName?: string
  /** Slot at the head of the pane (the narrow-screen return-to-list control). */
  leading?: ReactNode
  /** The reply workspace — preview or composer — inside the reading column. */
  composer?: ReactNode
  /** The applicable primary action, pinned at the foot so it never scrolls away. */
  actions?: ReactNode
  /** Move focus to the reviewer's name once it loads (after an advance). */
  focusHeading?: boolean
}) {
  const query = useReviewDetail(reviewId)

  const review = query.data?.review
  const pending = query.isPending
  const failed = !pending && (query.isError || !review)

  return (
    <div
      aria-busy={pending || undefined}
      className="group/pane @container/detail flex min-h-0 flex-1 flex-col"
    >
      <HeadFrame leading={leading} />

      {/* One reading order, one scroll region: what is in the way, then the
          customer's words and the reply — with the publish bar pinned
          beneath. */}
      {review ? (
        <div className={SCROLL_CLASS} data-slot="inbox-detail-scroll">
          <div className={COLUMN_CLASS}>
            <ReplyExceptionSlot review={review} />
            <ReviewThread
              review={review}
              composer={composer}
              focusHeading={focusHeading}
            />
          </div>
        </div>
      ) : failed ? (
        <QueryError
          title="We could not load this review."
          cause={query.error}
          onRetry={() => void query.refetch()}
          className="p-(--np-card-pad)"
        />
      ) : (
        <div className={SCROLL_CLASS}>
          <div className={COLUMN_CLASS}>
            <div className={THREAD_ITEM_CLASS}>
              <Skeleton className="size-11 rounded-(--np-radius-pill) @max-[480px]/detail:size-8" />
              <div className="flex flex-col gap-1.5 pt-1">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            </div>
            <Skeleton className="h-28 w-full rounded-(--np-radius-card)" />
            <Skeleton className="h-44 w-full rounded-(--np-radius-card)" />
          </div>
        </div>
      )}

      {review ? (
        <footer data-slot="composer-footer" className={FOOTER_CLASS}>
          <div
            className={cn(
              "flex min-w-0 items-center empty:hidden",
              TYPING_COLLAPSE_CLASS
            )}
          >
            <ReplyStatusStrip review={review} />
          </div>
          {actions ? (
            <div className="ml-auto flex max-w-full min-w-0 flex-[0_1_auto] flex-wrap items-center justify-end max-md:w-full max-md:flex-[1_1_100%]">
              {actions}
            </div>
          ) : null}
        </footer>
      ) : pending && actions ? (
        <footer className={FOOTER_CLASS}>
          <ActionFooterSkeleton />
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
