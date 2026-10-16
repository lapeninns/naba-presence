"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HistoryIcon,
  ImageOffIcon,
  InfoIcon,
  MoreHorizontalIcon,
  PlayIcon,
  TriangleAlertIcon,
  UserPlusIcon,
} from "lucide-react"
import Link from "next/link"

import { ReviewAvatar } from "@/components/inbox/review-avatar"
import { ActionBar } from "@/components/ui/action-bar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMenuSheet } from "@/components/ui/menu-surface"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { Stars } from "@/components/ui/stars"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"
import { ReplyException } from "@/components/inbox/detail/reply-exception"
import { ReplyStatusLine } from "@/components/inbox/detail/reply-status-line"
import { ReviewMetadata } from "@/components/inbox/detail/review-metadata"
import {
  AssigneeItems,
  assignReviews,
  markNoReplyNeeded,
  useAssignees,
  useReviewTriage,
} from "@/components/inbox/review-triage"
import { wasEdited } from "@/components/inbox/review-list"
import { SITUATION_TONE_ICON } from "@/components/inbox/situation-tone"
import { TYPING_COLLAPSE_CLASS } from "@/components/inbox/typing-collapse"
import { useComposerSave, useIsDirty } from "@/components/inbox/dirty-context"
import { formatDateTime } from "@/lib/format"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import {
  derivePrimaryAction,
  deriveReplyStatus,
  isAwaitingGoogleCheck,
  WAITING_FOR_GOOGLE_CHECK,
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
import { useKeepFocusClear } from "@/lib/editors/use-keep-focus-clear"
import { useReviewDetail } from "@/lib/queries/use-review-detail"
import { useReplyPending } from "@/lib/queries/use-reply-pending"
import { useSessionRole } from "@/lib/queries/use-session"
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
 * Who a parked reply waits on comes from the server
 * (`capabilities.approvalScope`) and wins inside `lib/inbox/reply-state.ts`;
 * the `canPublish` reading below is only the fallback for an older server. The
 * client does not re-derive the scope or `canApprove`. A list row has no action
 * and therefore does not guess — see `replyStateFromRow`.
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
      ? {
          body: review.reply.body,
          publishStatus: review.reply.publishStatus,
          googleReplyState: review.reply.googleReplyState,
        }
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

// Each thread item is a message header (avatar beside the name) over a body
// that spans the whole column: a 44px avatar column (32px in a narrow pane).
// The columns are the avatar's own sizes on the spacing scale (size-11,
// size-8).
const THREAD_ITEM_CLASS =
  "grid grid-cols-[--spacing(11)_minmax(0,1fr)] gap-x-3.5 @max-[480px]/detail:grid-cols-[--spacing(8)_minmax(0,1fr)] @max-[480px]/detail:gap-x-3"
const THREAD_AVATAR_CLASS =
  "@max-[480px]/detail:size-8 @max-[480px]/detail:text-caption"
// What follows the head row (the words, the media, the composer) spans the
// avatar column too.
const THREAD_BODY_CLASS =
  "col-span-2 mt-5 flex min-w-0 flex-col gap-3 @max-[480px]/detail:mt-4"

/**
 * Who wrote it: the Google profile photo when there is one, else initials;
 * a person glyph for an anonymous reviewer. Decorative — the name beside it
 * is the accessible identity.
 */
function ReviewerAvatar({ review }: { review: Review }) {
  return (
    <ReviewAvatar
      name={reviewerName(review)}
      anonymous={review.reviewerIsAnonymous}
      photoUrl={review.reviewerProfilePhotoUrl}
      className={THREAD_AVATAR_CLASS}
    />
  )
}

/**
 * Whose review this is — the name and one meta line (stars, when, and that
 * it is a Google review) — at the head of the thread. It says nothing about
 * the reply; that is said once, at the head of the reply row.
 *
 * Below lg the review is the whole screen, so the name is the page's h1 and
 * the one place it is written: there is no head band above it repeating it.
 * `actions` sit at the end of the name's row (the steps, the ⋯ menu), and
 * `nav` says where the review sits in the list, beside the venue.
 */
function ReviewerIdentity({
  review,
  clientName,
  focusHeading = false,
  titleIsHeading = false,
  nav,
  actions,
}: {
  review: Review
  clientName?: string | null
  focusHeading?: boolean
  titleIsHeading?: boolean
  nav?: ReviewDetailNav
  actions?: ReactNode
}) {
  const Heading = titleIsHeading ? "h1" : "h2"
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
      <div className="flex min-w-0 items-start gap-1">
        <Heading
          ref={headingRef}
          tabIndex={-1}
          data-slot="review-heading"
          className="line-clamp-2 min-w-0 flex-1 text-section font-medium break-words text-ink focus-visible:outline-none"
        >
          {displayName}
        </Heading>
        {actions}
      </div>
      <p
        data-slot="review-meta"
        className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption text-ink-muted"
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
        <RelativeTime
          iso={review.createTime}
          timeZone={review.timezone}
          className="tabular-nums"
        />
        {wasEdited(review.createTime, review.updateTime) ? (
          <RelativeTime
            iso={review.updateTime}
            timeZone={review.timezone}
            prefix="· edited "
            className="tabular-nums"
          />
        ) : null}
        <span aria-hidden>·</span>
        <span>Google review</span>
      </p>
      {/* Which venue this is for, on every review: the client first for an
          agency, the location alone for a business. It wraps rather than
          truncates, as the inbox row does (QA #2): two venues of one client
          often differ only at the end. */}
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p
          data-slot="review-venue"
          className="min-w-0 text-caption wrap-break-word text-ink-secondary"
        >
          {venueLabel(review, clientName)}
        </p>
        {nav ? <ReviewPosition nav={nav} /> : null}
      </div>
    </div>
  )
}

/** "2 of 5": where the review sits in the list. Not drawn from lg. */
function ReviewPosition({ nav }: { nav: ReviewDetailNav }) {
  return (
    <p
      data-slot="review-position"
      className="shrink-0 text-caption whitespace-nowrap text-ink-muted tabular-nums lg:hidden"
    >
      <span className="sr-only">Review </span>
      {nav.position} of {nav.total}
      {nav.more ? "+" : ""}
    </p>
  )
}

/**
 * The step to the previous and next review in the list, at the end of the
 * name's row beside the ⋯ menu. From lg the list is beside the review, so
 * the steps are not drawn there.
 */
function ReviewSteps({ nav }: { nav: ReviewDetailNav }) {
  return (
    <div data-slot="review-steps" className="flex shrink-0 lg:hidden">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Previous review"
        data-nav="previous"
        disabled={!nav.onPrevious}
        onClick={nav.onPrevious}
        className="-mt-1 max-md:size-11"
      >
        <ChevronLeftIcon aria-hidden strokeWidth={1.75} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Next review"
        data-nav="next"
        disabled={!nav.onNext}
        onClick={nav.onNext}
        className="-mt-1 max-md:size-11"
      >
        <ChevronRightIcon aria-hidden strokeWidth={1.75} />
      </Button>
    </div>
  )
}

/** "Client · Location" for an agency, the location alone otherwise. */
function venueLabel(review: Review, clientName?: string | null): string {
  const client = clientName?.trim()
  return client && client !== review.locationName
    ? `${client} · ${review.locationName}`
    : review.locationName
}

/**
 * The people this review can be assigned to. A component of its own so the
 * member list is fetched when the menu (or its Assign… submenu) opens, not
 * for every review that is read.
 */
function ReviewAssignItems({
  review,
  onAssign,
}: {
  review: Review
  onAssign: (assigneeId: string | null) => void
}) {
  const assignees = useAssignees([review.locationId])
  return <AssigneeItems {...assignees} onAssign={onAssign} />
}

/**
 * The ⋯ menu beside the reviewer: the triage that needs no reply (No reply
 * needed, Assign…) where the reader already is, then everything that is
 * true but not part of replying — the listing, the history and the review's
 * details. Triage is offered to everyone but a viewer, as in the bulk bar.
 */
function ReviewMenu({ review }: { review: Review }) {
  // The dialogs open from menu items that unmount with the menu, so focus
  // is handed back to the ⋯ trigger when they close.
  const moreRef = useRef<HTMLButtonElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const canTriage = useSessionRole() !== "viewer"
  const triage = useReviewTriage()
  // On a phone the menu is a bottom sheet, where a flyout submenu has
  // nowhere to fly to; the people are listed in the sheet.
  const menuIsSheet = useMenuSheet()
  const assign = (assigneeId: string | null) =>
    void triage.run(assignReviews([review.id], assigneeId))

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
        <DropdownMenuContent align="end" title={reviewerName(review)}>
          {canTriage ? (
            <>
              {menuIsSheet ? null : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <UserPlusIcon aria-hidden />
                    Assign…
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <ReviewAssignItems review={review} onAssign={assign} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {/* Triage, not a reply: it clears the review from Needs
                  reply and sends nothing to Google. Done at once, with
                  Undo in its toast. */}
              <DropdownMenuItem
                onClick={() => void triage.run(markNoReplyNeeded([review.id]))}
              >
                <CircleSlashIcon aria-hidden />
                No reply needed
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem
            render={<Link href={`/listings/${review.locationId}`} />}
          >
            <ExternalLinkIcon aria-hidden />
            Open listing
          </DropdownMenuItem>
          {review.googleReplyUrl ? (
            <DropdownMenuItem
              render={
                <a
                  href={review.googleReplyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLinkIcon aria-hidden />
              Open on Google
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
            <HistoryIcon aria-hidden />
            History
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
            <InfoIcon aria-hidden />
            Review details
          </DropdownMenuItem>
          {/* The people come last in the sheet: a long team would
              otherwise push the actions out of reach. */}
          {canTriage && menuIsSheet ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Assign to</DropdownMenuLabel>
                <ReviewAssignItems review={review} onAssign={assign} />
              </DropdownMenuGroup>
            </>
          ) : null}
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
          {/* The dialog is its own scroller (a sheet on a phone), so the
              timeline is not boxed into a second one inside it. */}
          <ActivityTimeline
            timeline={review.timeline}
            timezone={review.timezone}
          />
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

/** Where this review sits in the loaded list, and the steps either side. */
export type ReviewDetailNav = {
  /** 1-based. */
  position: number
  total: number
  /** Another page follows, so the total is a floor: "2 of 50+". */
  more: boolean
  /** Undefined at that end of the list: the button is drawn but off. */
  onPrevious?: () => void
  onNext?: () => void
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
      <p className="text-reading text-ink-secondary italic">
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
        className="m-0 text-reading whitespace-pre-line text-ink"
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
  // Thumbnails that would not load (an expired Google CDN link): the tile
  // says so in its own words instead of the browser's broken-image glyph.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  if (items.length === 0) return null

  function markFailed(id: string) {
    setFailed((previous) =>
      previous.has(id) ? previous : new Set(previous).add(id)
    )
  }

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
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(--spacing(18),1fr))] gap-2">
        {items.map((item, index) => {
          const label =
            item.thumbnailLabel ??
            (item.videoUrl ? "Review video" : "Review photo")
          const unavailable = failed.has(item.id)
          return (
            <li key={item.id} className="relative">
              <button
                type="button"
                aria-label={`Open ${label}`}
                onClick={() => setActiveIndex(index)}
                className="relative block w-full overflow-hidden rounded-(--np-radius-control) bg-fill focus-halo hairline transition duration-(--np-duration-fast) ease-spring-snappy focus-visible:[box-shadow:var(--np-focus-halo),var(--np-shadow-hairline)] active:scale-[0.98]"
              >
                {item.thumbnailUrl && !unavailable ? (
                  // Remote Google CDN thumbnails, not project assets — next/image
                  // cannot optimise them and would need every host allowlisted.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    // A server-rendered page can fail the request before React
                    // attaches `onError` (and React does not replay it), so a
                    // finished load with no pixels is read as failed here. A
                    // lazy image that has not been asked for yet is not
                    // `complete` and has no `currentSrc`, so it is left alone.
                    ref={(image) => {
                      if (
                        image?.complete &&
                        image.naturalWidth === 0 &&
                        image.currentSrc
                      ) {
                        markFailed(item.id)
                      }
                    }}
                    onError={() => markFailed(item.id)}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <span
                    data-slot={unavailable ? "media-unavailable" : undefined}
                    title={unavailable ? "Photo unavailable" : undefined}
                    className="flex aspect-square w-full items-center justify-center text-ink-muted"
                  >
                    {unavailable && !item.videoUrl ? (
                      <ImageOffIcon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-4"
                      />
                    ) : (
                      <PlayIcon
                        aria-hidden
                        strokeWidth={1.75}
                        className="size-4"
                      />
                    )}
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
          className="gap-3 p-3 sm:max-w-2xl"
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
                className="max-h-[70svh] w-full rounded-(--np-radius-control) bg-black"
              />
            ) : active?.thumbnailUrl && !failed.has(active.id) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.thumbnailUrl}
                alt={activeLabel}
                onError={() => markFailed(active.id)}
                className="max-h-[70svh] w-full rounded-(--np-radius-control) object-contain"
              />
            ) : active ? (
              <p className="py-10 text-center text-body text-ink-muted">
                Photo unavailable
              </p>
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
  // Google is still moderating it: say so, not "Live on Google".
  const checking = isAwaitingGoogleCheck(
    reply.publishStatus,
    reply.googleReplyState
  )
  const stateLabel = checking ? WAITING_FOR_GOOGLE_CHECK : state.label
  const Icon = SITUATION_TONE_ICON[checking ? "neutral" : state.tone]
  const at = reply.googleReplyUpdatedAt

  return (
    <section className="rounded-(--np-radius-control) bg-surface-sunken">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-(--np-radius-control) px-3 py-2 text-left text-caption focus-halo transition duration-(--np-duration-fast) ease-spring-snappy hover:bg-fill focus-visible:outline-none pointer-coarse:min-h-(--np-touch)"
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
            {stateLabel}
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
function ReplyStatusStrip({
  review,
  onCharcoal = false,
}: {
  review: Review
  /** On the charcoal publish bar: the on-charcoal inks. */
  onCharcoal?: boolean
}) {
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
        : mutating === "rejection"
          ? "reject"
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
        "flex min-h-8 min-w-0 items-center rounded-(--np-radius-control) transition-[box-shadow] duration-(--np-duration-deliberate) ease-spring motion-reduce:transition-none",
        pulse && "px-2 ring-2 ring-success-solid ring-inset"
      )}
    >
      <ReplyStatusLine status={status} onCharcoal={onCharcoal} />
    </div>
  )
}

function ActionFooterSkeleton() {
  return (
    <>
      <Skeleton aria-hidden className="h-4 min-w-0 flex-1" />
      <Skeleton aria-hidden className="h-(--np-control-h) w-32 shrink-0" />
    </>
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
  const label = isAwaitingGoogleCheck(status, review.reply.googleReplyState)
    ? WAITING_FOR_GOOGLE_CHECK
    : describeReplyState(status).label
  return isLiveOnGoogle(status) && replyWork(review).hasUnpublishedChanges
    ? `${label} · your newer draft is not published yet`
    : label
}

/**
 * The review, then the reply: one conversation, the customer's words above
 * the place the answer is written, with one hairline between the two.
 */
function ReviewThread({
  review,
  clientName,
  composer,
  focusHeading,
  titleIsHeading,
  nav,
  viewOnly = false,
}: {
  review: Review
  clientName?: string | null
  composer?: ReactNode
  focusHeading?: boolean
  titleIsHeading?: boolean
  nav?: ReviewDetailNav
  viewOnly?: boolean
}) {
  const displayName = reviewerName(review)

  return (
    <div data-slot="review-thread" className="flex flex-col">
      {/* Avatar and identity share the first row; the words below span
          both columns, so they read at the full width of the column. */}
      <article
        aria-label={`Review from ${displayName}`}
        data-slot="thread-review"
        className={cn(THREAD_ITEM_CLASS, "border-b border-line-subtle pb-8")}
      >
        <div className="relative">
          <ReviewerAvatar review={review} />
          {/* Kept for the thread's structure; the hairline between the
              review and the reply now does the joining. */}
          <span aria-hidden data-slot="thread-rail" className="hidden" />
        </div>
        <div className="flex min-w-0 items-start gap-2 self-center">
          <ReviewerIdentity
            review={review}
            clientName={clientName}
            focusHeading={focusHeading}
            titleIsHeading={titleIsHeading}
            nav={nav}
            actions={
              <>
                {nav ? <ReviewSteps nav={nav} /> : null}
                <ReviewMenu review={review} />
              </>
            }
          />
        </div>
        <div className={THREAD_BODY_CLASS}>
          <ReviewBody review={review} />
          <ReviewMedia media={review.media} />
        </div>
      </article>

      <section
        aria-label="Your reply"
        data-slot="thread-reply"
        className={cn(THREAD_ITEM_CLASS, "pt-7")}
      >
        <div>
          {/* The venue's square: the neutral Avatar (D9: a location has no
              colour of its own here), the reviewer's size beside it. */}
          <Avatar
            size="lg"
            shape="square"
            aria-hidden
            className={THREAD_AVATAR_CLASS}
          >
            <AvatarFallback>{initialsOf(review.locationName)}</AvatarFallback>
          </Avatar>
        </div>
        {/* The composer's header row: who the reply is written as, and
            where it will be seen. */}
        <div className="flex min-h-11 min-w-0 flex-col justify-center gap-0.5 @max-[480px]/detail:min-h-8">
          <h2
            data-slot="reply-heading"
            className="min-w-0 text-ui font-semibold break-words text-ink"
          >
            Reply as {review.locationName}
          </h2>
          <p className="text-caption text-ink-muted">
            {replyVisibility(review)}
          </p>
        </div>
        <div className={THREAD_BODY_CLASS}>
          {viewOnly ? (
            // No publish bar for a viewer (nothing in it could be pressed),
            // so the status it would carry is said here instead.
            <div className="flex flex-col gap-1.5" data-slot="view-only">
              <ReplyStatusStrip review={review} />
              <p className="text-caption text-ink-muted">
                View-only access. You can read reviews and replies; an owner or
                admin can reply.
              </p>
            </div>
          ) : null}
          <LiveReplyDisclosure review={review} />
          {composer}
        </div>
      </section>
    </div>
  )
}

// The publish bar (reference `.publish`): the shared ActionBar, docked.
// Below md it is fixed to the foot of the screen, riding the keyboard, and
// its `data-docked` tells the shell's tab bar to step aside so one bar owns
// the edge (the CHROME CONTRACT in globals.css); from md to lg, where the
// review is still the whole page, it sticks to the foot of the pane; from lg,
// where the workspace is locked to the window, it is a static last row of
// the pane. With the inbox's actions in it the bar is charcoal: its primary
// reaches Google (publish, approve, retry, delete) or asks for the approval
// that will, and charcoal is the one dark bar per screen for that. Without
// actions (and while loading) it is the plain surface band. One row at every
// width: the status words take what the actions leave. The padding and edges
// here restyle the bar as the pane's last row; the docking itself (position,
// spacer, keyboard edge) is the primitive's.
const FOOTER_CLASS = cn(
  "shrink-0 flex-nowrap rounded-none rounded-b-(--np-radius-card) border-x-0 border-t border-b-0 shadow-none max-md:rounded-none lg:[@media(min-height:620px)]:static",
  // At least the action-bar height in flow; on a phone the dock adds the
  // keyboard or home-indicator edge under it.
  "min-h-(--np-actionbar-h) py-2.5 md:pb-[max(--spacing(2.5),var(--np-dock-bottom))]",
  // The actions keep their width and one line; the status words give way.
  "[&>[data-slot=action-bar-actions]]:shrink-0 [&>[data-slot=action-bar-actions]]:flex-nowrap"
)
const FOOTER_SURFACE_CLASS = "border-line bg-surface"
const FOOTER_CHARCOAL_CLASS = "border-charcoal"

// Only this middle row scrolls where the workspace is locked; everywhere
// else the page does. The thread keeps a reading measure and centres in a
// wide pane.
const SCROLL_CLASS =
  "flex min-h-0 flex-1 flex-col px-8 pt-8 pb-10 max-md:px-(--np-page-pad-x) @max-[480px]/detail:pt-5 @max-[480px]/detail:pb-6 lg:[@media(min-height:620px)]:overflow-y-auto"

const COLUMN_CLASS =
  "mx-auto flex w-full max-w-(--np-page-narrow-width) flex-col gap-5"

function ReviewDetail({
  reviewId,
  clientName,
  onBack,
  nav,
  heading,
  composer,
  actions,
  focusHeading = false,
  titleIsHeading = false,
}: {
  reviewId: string
  /**
   * The client the review's location belongs to, when the workspace is an
   * agency (from the list row). Drawn before the location in the head.
   */
  clientName?: string | null
  /**
   * Back to the list, for a pane that failed while rendering. The way back
   * of a healthy review is the shell's app bar ("‹ Inbox"), not a control
   * here.
   */
  onBack?: () => void
  /** Where the review sits in the list, with the steps either side. */
  nav?: ReviewDetailNav
  /** The reviewer's name as the list knows it, until the review loads. */
  heading?: string
  /** The reply workspace — preview or composer — inside the reading column. */
  composer?: ReactNode
  /** The applicable primary action, pinned at the foot so it never scrolls away. */
  actions?: ReactNode
  /** Move focus to the reviewer's name once it loads (after an advance). */
  focusHeading?: boolean
  /**
   * Whether the reviewer's name is the page's h1: below lg, where the review
   * has replaced the list. Not where the list is beside the review, and
   * "Inbox" is the h1.
   */
  titleIsHeading?: boolean
}) {
  const query = useReviewDetail(reviewId)
  const paneRef = useRef<HTMLDivElement>(null)
  // A focused field (the reply, above all) is never left under the docked
  // bar or the on-screen keyboard.
  useKeepFocusClear(paneRef, "[data-slot=composer-footer]")

  const review = query.data?.review
  const pending = query.isPending
  const failed = !pending && (query.isError || !review)

  // The steps row is drawn while loading, failed and loaded, but not as the
  // same element: when the review lands the loading row is replaced and the
  // button the operator pressed unmounts, dropping focus to <body>. So the
  // step last focused is remembered, and handed back to its twin when the
  // pane changes state. (A real blur — the operator moved on — forgets it;
  // an unmount does not blur.)
  const stepFocusRef = useRef<string | null>(null)
  const phase = review ? "loaded" : failed ? "failed" : "loading"
  useEffect(() => {
    const nav = stepFocusRef.current
    if (!nav) return
    const active = document.activeElement
    if (active && active !== document.body) return
    const button = paneRef.current?.querySelector<HTMLButtonElement>(
      `[data-slot="review-steps"] [data-nav="${nav}"]`
    )
    if (button && !button.disabled) button.focus({ preventScroll: true })
  }, [phase, reviewId])
  // Someone who can neither edit, publish nor ask for approval has nothing
  // to press: no publish bar (so no docked bar either; the tab bar stays).
  const caps = review?.capabilities
  const viewOnly = Boolean(
    caps && !caps.canEdit && !caps.canPublish && !caps.canRequestApproval
  )
  const title = review ? reviewerName(review) : (heading ?? "Review")

  return (
    <div
      ref={paneRef}
      aria-busy={pending || undefined}
      onFocus={(event) => {
        const target = event.target as HTMLElement
        stepFocusRef.current = target.closest('[data-slot="review-steps"]')
          ? (target.dataset.nav ?? null)
          : null
      }}
      onBlur={(event) => {
        if ((event.target as HTMLElement).isConnected) {
          stepFocusRef.current = null
        }
      }}
      // Below lg the review is the whole screen, at least as tall as the
      // window under the app bar, so the publish bar is pinned to the foot
      // of the screen from the first paint — loading, short review or long —
      // rather than sitting under a skeleton and dropping when it fills in.
      className="group/pane @container/detail flex flex-1 flex-col max-lg:min-h-[calc(100svh-var(--np-appbar-h))] lg:min-h-0"
    >
      {/* A review that throws while rendering keeps the way back to the
          list. */}
      <DetailErrorBoundary onBack={onBack}>
        {/* One reading order, one scroll region: what is in the way, then
            the customer's words and the reply — with the publish bar pinned
            beneath. */}
        {review ? (
          <div className={SCROLL_CLASS} data-slot="inbox-detail-scroll">
            <div className={COLUMN_CLASS}>
              <ReplyExceptionSlot review={review} />
              <ReviewThread
                review={review}
                clientName={clientName}
                composer={composer}
                focusHeading={focusHeading}
                titleIsHeading={titleIsHeading}
                nav={nav}
                viewOnly={viewOnly}
              />
            </div>
          </div>
        ) : failed ? (
          <>
            {nav ? (
              // The steps stay while the review is out of reach, so the
              // operator can move on and focus stays on the step pressed.
              <div className="px-8 pt-8 max-md:px-(--np-page-pad-x) @max-[480px]/detail:pt-5">
                <div className={COLUMN_CLASS}>
                  <div className="flex min-w-0 items-start gap-1">
                    <LoadingHeading
                      titleIsHeading={titleIsHeading}
                      className="flex-1"
                    >
                      {title}
                    </LoadingHeading>
                    <ReviewSteps nav={nav} />
                  </div>
                  <ReviewPosition nav={nav} />
                </div>
              </div>
            ) : titleIsHeading ? (
              <h1 className="sr-only">{title}</h1>
            ) : null}
            <QueryError
              title="We could not load this review."
              cause={query.error}
              onRetry={() => void query.refetch()}
              className="p-(--np-card-pad)"
            />
          </>
        ) : (
          <div className={SCROLL_CLASS}>
            <div className={COLUMN_CLASS}>
              {titleIsHeading && !heading ? (
                <h1 className="sr-only">{title}</h1>
              ) : null}
              <div className={THREAD_ITEM_CLASS}>
                <Skeleton className="size-11 rounded-(--np-radius-pill) @max-[480px]/detail:size-8" />
                <div className="flex min-w-0 flex-col gap-1.5 pt-1">
                  <div className="flex min-w-0 items-start gap-1">
                    {heading ? (
                      // The name the list already knows, so the heading is
                      // there from the first paint and does not jump.
                      <LoadingHeading
                        titleIsHeading={titleIsHeading}
                        className="flex-1"
                      >
                        {heading}
                      </LoadingHeading>
                    ) : (
                      <Skeleton className="h-5 w-40" />
                    )}
                    {/* The steps are there while the next review loads, so
                        focus stays on the one pressed. */}
                    {nav ? <ReviewSteps nav={nav} /> : null}
                  </div>
                  <div className="flex min-w-0 items-baseline justify-between gap-3">
                    <Skeleton className="h-3 w-56 max-w-full" />
                    {nav ? <ReviewPosition nav={nav} /> : null}
                  </div>
                </div>
              </div>
              <Skeleton className="h-28 w-full rounded-(--np-radius-card)" />
              <Skeleton className="h-44 w-full rounded-(--np-radius-card)" />
            </div>
          </div>
        )}

        {review && !viewOnly ? (
          <ActionBar
            // The pane's own hook (journeys, useKeepFocusClear above).
            data-slot="composer-footer"
            label="Reply actions"
            tone={actions ? "charcoal" : "surface"}
            dock={Boolean(actions)}
            safeArea={false}
            className={cn(
              FOOTER_CLASS,
              actions ? FOOTER_CHARCOAL_CLASS : FOOTER_SURFACE_CLASS
            )}
            actions={actions ?? undefined}
          >
            {/* The strip is its own `role="status"`, so it goes in as
                content rather than the bar's live status slot (one
                announcement, not two). Folds away while the reply is typed
                on a touch screen, so the keyboard leaves the words being
                written in view. */}
            <div
              className={cn(
                "line-clamp-2 min-w-0 flex-1 text-caption",
                TYPING_COLLAPSE_CLASS
              )}
            >
              <ReplyStatusStrip review={review} onCharcoal={Boolean(actions)} />
            </div>
          </ActionBar>
        ) : pending && actions ? (
          // Docked already, as the loaded bar will be: the tab bar does not
          // show for a moment and then step aside.
          <ActionBar
            aria-hidden
            data-slot="composer-footer"
            label="Reply actions"
            tone="surface"
            dock
            safeArea={false}
            className={cn(FOOTER_CLASS, FOOTER_SURFACE_CLASS)}
          >
            <ActionFooterSkeleton />
          </ActionBar>
        ) : null}
      </DetailErrorBoundary>
    </div>
  )
}

/** The reviewer's name while the rest of the review loads. */
function LoadingHeading({
  titleIsHeading,
  className,
  children,
}: {
  titleIsHeading: boolean
  className?: string
  children: ReactNode
}) {
  const Heading = titleIsHeading ? "h1" : "h2"
  return (
    <Heading
      className={cn(
        "line-clamp-2 min-w-0 text-section font-medium break-words text-ink",
        className
      )}
    >
      {children}
    </Heading>
  )
}

/** The exception needs the same dirty state the status and the footer read. */
function ReplyExceptionSlot({ review }: { review: Review }) {
  const isDirty = useIsDirty()
  const action = derivePrimaryAction(replyStateFor(review, isDirty, null))
  return <ReplyException review={review} action={action} />
}

export { ReviewDetail }
