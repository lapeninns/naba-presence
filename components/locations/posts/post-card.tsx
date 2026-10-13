"use client"

import { ChevronRightIcon, ImageIcon } from "lucide-react"

import { Lifecycle, type LifecycleStage } from "@/components/ui/lifecycle"
import { StatusPill } from "@/components/ui/status-pill"
import type { PostTone } from "@/lib/locations/post-display"
import { cn } from "@/lib/utils"

/**
 * One post in the list, laid out as a mail-style row: a media thumb at the
 * start, then the type tag and headline, the status word with its time, the
 * post text clamped to two lines, the details, an optional problem, the
 * row's actions, and the lifecycle behind a disclosure.
 *
 * The row is an article, not a button: the visible next action and the
 * "More actions" menu sit inside it, so nothing interactive is nested in
 * another control. The thumb is 56px, 44px when the row is narrow.
 *
 * Presentation only: the list decides the status words, tone and actions.
 */
export function PostCard({
  id,
  title,
  topic,
  summary,
  status,
  tone,
  meta,
  details,
  thumbnailUrl,
  lang,
  problem,
  actions,
  lifecycle,
  className,
}: {
  /** Stable id, used to name the card by its heading. */
  id: string
  /** The headline: an event or offer title, or the type of an update. */
  title: string
  /** "Event" or "Offer", drawn as a tag when the headline is a title. */
  topic?: string
  summary: string
  /** The status word shown in the pill, e.g. "Draft". */
  status: string
  tone: PostTone
  /** The time beside the status: when it changed, or why there is none. */
  meta?: React.ReactNode
  /** Small print under the text: schedule, dates, repeat, button. */
  details?: React.ReactNode
  thumbnailUrl?: string | null
  lang?: string
  /** A failure or rejection to show in words beside the post. */
  problem?: React.ReactNode
  /** The row's buttons (publish, approve, check) and its menu. */
  actions?: React.ReactNode
  lifecycle?: LifecycleStage[]
  className?: string
}) {
  const headingId = `post-${id}-title`
  return (
    <article
      data-slot="post-card"
      aria-labelledby={headingId}
      className={cn("@container/post flex gap-3 px-3 py-3.5", className)}
    >
      <div
        aria-hidden
        className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-(--np-radius-control) bg-fill text-ink-muted @[360px]/post:size-14"
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <ImageIcon className="size-5" strokeWidth={1.5} />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {topic ? (
            <span className="inline-flex items-center rounded-(--np-radius-tag) bg-fill-secondary px-1.5 py-0.5 text-caption font-medium text-ink-secondary">
              {topic}
            </span>
          ) : null}
          <h3
            id={headingId}
            className="min-w-0 text-body font-semibold break-words text-ink"
          >
            {title}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill tone={tone === "neutral" ? "outline" : tone}>
            {status}
          </StatusPill>
          {meta ? (
            <span className="text-caption text-ink-muted tabular-nums">
              {meta}
            </span>
          ) : null}
        </div>

        <p
          className="text-ui break-words whitespace-pre-wrap text-ink-secondary"
          lang={lang}
          dir="auto"
        >
          {summary || "—"}
        </p>

        {details ? (
          <p className="text-caption break-words text-ink-muted tabular-nums">
            {details}
          </p>
        ) : null}

        {problem ? (
          <div
            role="note"
            className="mt-1 rounded-(--np-radius-control) bg-danger-tint px-3 py-2 text-ui text-ink"
          >
            {problem}
          </div>
        ) : null}

        {actions ? <div className="mt-1.5">{actions}</div> : null}

        {lifecycle && lifecycle.length > 0 ? (
          <details className="group/lc">
            <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm text-caption text-ink-muted focus-halo pointer-coarse:min-h-(--np-touch) [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon
                aria-hidden
                className="size-3.5 transition-transform group-open/lc:rotate-90 motion-reduce:transition-none"
              />
              Lifecycle
            </summary>
            <Lifecycle
              className="mt-2"
              aria-label="Post lifecycle"
              stages={lifecycle}
            />
          </details>
        ) : null}
      </div>
    </article>
  )
}
