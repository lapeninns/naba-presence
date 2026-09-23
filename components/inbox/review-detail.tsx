"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  PlayIcon,
  QuoteIcon,
  TriangleAlertIcon,
} from "lucide-react"
import Link from "next/link"

import { Button, buttonVariants } from "@/components/ui/button"
import { QueryError } from "@/components/ui/query-states"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Lifecycle } from "@/components/ui/lifecycle"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { VerificationChecks } from "@/components/inbox/verification-panel"
import { useReveals } from "@/lib/motion/use-reveals"
import { ReplyException } from "@/components/inbox/detail/reply-exception"
import { ReplyStatusLine } from "@/components/inbox/detail/reply-status-line"
import { ReviewMetadata } from "@/components/inbox/detail/review-metadata"
import { StarRating } from "@/components/inbox/star-rating"
import { SITUATION_TONE_ICON } from "@/components/inbox/situation-tone"
import { useIsDirty } from "@/components/inbox/dirty-context"
import { formatDateTime, formatRelativeTime } from "@/lib/format"
import { deriveLifecycle } from "@/lib/inbox/lifecycle"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import {
  derivePrimaryAction,
  deriveReplyStatus,
  type ReplyPendingKind,
  type ReplyStateInput,
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

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
  return letters || "?"
}

/**
 * The pane's head (reference `.detail-head`): on a narrow screen the way
 * back to the list, then the reviewer's initials, their name and stars, and
 * one caption line — client, listing, "Google review", age — with the link
 * to the listing, the review's provenance and previous / next at the
 * trailing edge. It says whose review this is and nothing about the reply;
 * the reply's state is on the action bar.
 */
function ReviewHead({
  review,
  clientName,
  clientId,
  navigation,
}: {
  review: Review
  clientName?: string | null
  clientId?: string | null
  navigation?: ReactNode
}) {
  const displayName = review.reviewerIsAnonymous
    ? "Anonymous"
    : (review.reviewerDisplayName ?? "Anonymous")

  return (
    <>
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full bg-fill text-caption font-semibold text-ink-secondary"
      >
        {initials(displayName)}
      </span>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 text-[17px] leading-6 font-semibold break-words text-ink">
            {displayName}
          </h2>
          <StarRating rating={review.rating} size="md" />
        </div>
        <p className="text-caption leading-5 break-words text-ink-muted">
          {clientName ? (
            <>
              {clientId ? (
                <Link
                  href={`/clients/${clientId}`}
                  className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                >
                  {clientName}
                </Link>
              ) : (
                <span className="text-ink">{clientName}</span>
              )}
              {" · "}
            </>
          ) : null}
          <span>{review.locationName}</span> · Google review ·{" "}
          <time
            dateTime={review.createTime}
            title={formatDateTime(review.createTime, review.timezone)}
          >
            {formatRelativeTime(review.createTime)}
          </time>
        </p>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
        <Link
          href={`/listings/${review.locationId}`}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          Open listing
        </Link>
        <ReviewMetadata review={review} />
        {navigation}
      </div>
    </>
  )
}

/**
 * The head's frame, shared by the loading, error and loaded pane so the
 * return-to-list control is the SAME element throughout: it takes focus
 * when a review opens on a narrow screen, and a control that was swapped
 * for a new one when the review arrived would drop that focus.
 */
function HeadFrame({
  leading,
  children,
}: {
  leading?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      data-slot="review-head"
      className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-4 py-3.5 @md/detail:px-[18px]"
    >
      {leading ? (
        <div className="-ml-1.5 shrink-0 basis-full lg:hidden">{leading}</div>
      ) : null}
      {children}
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
      <p className="text-ui text-ink-muted">A rating with no written review.</p>
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
    <div className="flex justify-end gap-2" aria-hidden>
      <Skeleton className="h-(--np-control-h) w-40 bg-ink-on-charcoal/15" />
    </div>
  )
}

/**
 * The customer's words beside what Google shows now (reference
 * `.quote-card` and `.live-card`).
 *
 * The review is the one place in the pane set in the reading serif, on the
 * sunken surface with the accent quote mark. The live card is drawn dashed
 * because it is Google's, not ours: it shows the reply only when Google has
 * confirmed it is live, says so when a reply has been sent and not yet
 * confirmed, and otherwise says plainly that customers see no reply.
 */
function ReviewAndReplyCards({ review }: { review: Review }) {
  const displayName = review.reviewerIsAnonymous
    ? "Anonymous"
    : (review.reviewerDisplayName ?? "Anonymous")
  const reply = review.reply
  const live = reply?.body && isLiveOnGoogle(reply.publishStatus) ? reply : null
  const sent = !live && reply?.body && reply.publishStatus === "accepted"
  const publishedBy = review.timeline.find(
    (event) => event.action === "review.reply.published"
  )

  return (
    <section
      aria-label="The review and the live reply"
      className="grid grid-cols-1 gap-3 @2xl/detail:grid-cols-2"
    >
      <article
        aria-label={`Review from ${displayName}`}
        data-slot="review-card"
        className="m-0 flex min-w-0 flex-col gap-2.5 rounded-(--np-radius-card) bg-surface-alt px-5 py-[18px]"
      >
        <QuoteIcon
          aria-hidden
          strokeWidth={0}
          className="size-5 fill-current text-accent-ink"
        />
        <div className="min-w-0">
          <ReviewBody review={review} />
          <ReviewMedia media={review.media} />
        </div>
        <p className="font-mono text-caption text-ink-muted tabular-nums">
          {displayName}
          {review.rating !== null
            ? ` · ${review.rating} ${review.rating === 1 ? "star" : "stars"}`
            : ""}
          {" · "}
          {formatRelativeTime(review.createTime)}
        </p>
      </article>

      <article
        aria-label="The reply live on Google"
        data-slot="live-reply-card"
        className="flex min-w-0 flex-col gap-2 rounded-(--np-radius-card) border border-dashed border-line-strong px-4 py-3.5"
      >
        <span className="font-mono text-[11.5px] leading-4 font-medium tracking-[0.06em] text-ink-muted uppercase">
          On Google now
        </span>
        {live ? (
          <>
            <p
              dir="auto"
              className="text-[15px] leading-6 whitespace-pre-line text-ink"
            >
              {live.body}
            </p>
            <p className="font-mono text-caption text-ink-muted tabular-nums">
              {publishedBy?.actorName
                ? `Published by ${publishedBy.actorName}`
                : "Live on Google"}
              {live.googleReplyUpdatedAt
                ? ` · ${formatDateTime(live.googleReplyUpdatedAt, review.timezone)}`
                : publishedBy
                  ? ` · ${formatRelativeTime(publishedBy.createdAt)}`
                  : ""}
            </p>
          </>
        ) : sent ? (
          <p className="text-ui text-ink-muted">
            Sent to Google — waiting for Google to confirm it is live. Customers
            may not see it yet.
          </p>
        ) : (
          <p className="text-ui text-ink-muted">
            Nothing is live yet. Customers see the review without a reply.
          </p>
        )}
        {reply?.googlePolicyViolation ? (
          <p className="flex items-start gap-1.5 text-caption text-danger-ink">
            <TriangleAlertIcon
              aria-hidden
              strokeWidth={1.75}
              className="mt-0.5 size-3.5 shrink-0"
            />
            Google flagged this reply: {reply.googlePolicyViolation}
          </p>
        ) : null}
      </article>
    </section>
  )
}

/** Where the reply has got to, as five stages, from the review's own state. */
function ReplyLifecycle({ review }: { review: Review }) {
  const steps = deriveLifecycle(review)
  return (
    <Lifecycle
      aria-label="Reply lifecycle"
      stages={steps.map((step) =>
        step.id === "received"
          ? {
              ...step,
              meta: `From Google · ${formatRelativeTime(review.createTime)}`,
            }
          : step
      )}
    />
  )
}

// The action bar is sticky at the foot of the screen on a phone or a short
// window, and a static last row of the pane where the workspace is locked.
const FOOTER_CLASS =
  "sticky bottom-0 z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-b-[calc(var(--np-radius-card)-1px)] on-charcoal px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] md:[@media(min-height:620px)]:static md:[@media(min-height:620px)]:pb-3 [&_:focus-visible]:outline-ink-on-charcoal"

const SCROLL_CLASS =
  "flex min-h-0 flex-1 flex-col gap-5 p-4 @md/detail:p-[18px] md:[@media(min-height:620px)]:overflow-y-auto"

function ReviewDetail({
  reviewId,
  clientName,
  clientId,
  leading,
  navigation,
  composer,
  actions,
}: {
  reviewId: string
  /** The client the review's location belongs to, from the list row. */
  clientName?: string | null
  /** Its id, for the link to the client. */
  clientId?: string | null
  /** Accepted for compatibility; the pane no longer draws an avatar for it. */
  organisationName?: string
  /** Slot at the head of the pane (the narrow-screen return-to-list control). */
  leading?: ReactNode
  /** Previous / next review controls, in the pane head. */
  navigation?: ReactNode
  /** The reply workspace — preview or composer — inside the reading column. */
  composer?: ReactNode
  /** The applicable primary action, pinned at the foot so it never scrolls away. */
  actions?: ReactNode
}) {
  const query = useReviewDetail(reviewId)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Timeline rows and verification cards below the fold reveal once as they
  // scroll in; anything already visible when the pane mounts stays visible.
  useReveals(scrollRef, query.data ? reviewId : undefined)

  const review = query.data?.review
  const pending = query.isPending
  const failed = !pending && (query.isError || !review)

  return (
    <div
      aria-busy={pending || undefined}
      className="@container/detail flex min-h-0 flex-1 flex-col"
    >
      <HeadFrame leading={leading}>
        {review ? (
          <ReviewHead
            review={review}
            clientName={clientName}
            clientId={clientId}
            navigation={navigation}
          />
        ) : (
          <>
            {pending ? (
              <>
                <Skeleton className="size-9 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5 pt-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
              </>
            ) : null}
            <div className="ml-auto">{navigation}</div>
          </>
        )}
      </HeadFrame>

      {/* One reading order, one scroll region: what is in the way, where the
          reply has got to, the customer's words beside what Google shows,
          the reply, the checks, and what happened — with the action bar
          pinned beneath. */}
      {review ? (
        <div
          ref={scrollRef}
          className={SCROLL_CLASS}
          data-slot="inbox-detail-scroll"
        >
          <ReplyExceptionSlot review={review} />
          <ReplyLifecycle review={review} />
          <ReviewAndReplyCards review={review} />

          <section aria-label="Reply" className="flex flex-col gap-3">
            <LiveReplyDisclosure review={review} />
            {composer}
          </section>

          <VerificationChecks
            verification={review.latestVerification}
            status={review.workflowStatus}
          />

          <ActivityTimeline
            timeline={review.timeline}
            timezone={review.timezone}
            collapsible
          />
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
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full rounded-(--np-radius-card)" />
          <Skeleton className="h-40 w-full rounded-(--np-radius-card)" />
        </div>
      )}

      {review ? (
        <footer data-slot="composer-footer" className={FOOTER_CLASS}>
          <div className="flex min-w-0 flex-[1_1_240px] items-center">
            <ReplyStatusStrip review={review} />
          </div>
          {actions ? (
            <div className="ml-auto flex max-w-full min-w-0 flex-[0_1_auto] flex-wrap items-center justify-end">
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
