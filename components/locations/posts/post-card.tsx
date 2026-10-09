"use client"

import { ChevronRightIcon, ImageIcon } from "lucide-react"

import { Lifecycle, type LifecycleStage } from "@/components/ui/lifecycle"
import { StatusPill } from "@/components/ui/status-pill"
import type { PostTone } from "@/lib/locations/post-display"
import { cn } from "@/lib/utils"

/**
 * One post in the list (reference `.card.post`): a thumbnail beside the
 * text, the topic tag, headline and status pill on one line, the post text
 * in full, a meta line, an optional problem, the row's actions, and the
 * lifecycle behind a disclosure.
 *
 * The thumbnail column drops above the text when the card's own width is
 * under 520px, so the text never squeezes to a sliver on a phone.
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
  thumbnailUrl,
  lang,
  problem,
  actions,
  lifecycle,
  className,
}: {
  /** Stable id, used to name the card by its heading. */
  id: string
  /** The headline: an event or offer title, or the start of the text. */
  title: string
  /** "Event" or "Offer", drawn as a tag when the headline is a title. */
  topic?: string
  summary: string
  /** The status word shown in the pill, e.g. "Draft". */
  status: string
  tone: PostTone
  /** Small print under the text: dates, button, last change. */
  meta?: React.ReactNode
  thumbnailUrl?: string | null
  lang?: string
  /** A failure or rejection to show in words beside the post. */
  problem?: React.ReactNode
  /** The row's buttons (publish, approve, check). */
  actions?: React.ReactNode
  lifecycle?: LifecycleStage[]
  className?: string
}) {
  const headingId = `post-${id}-title`
  return (
    <article
      data-slot="post-card"
      aria-labelledby={headingId}
      className={cn(
        "@container/post rounded-lg border border-line bg-surface",
        className
      )}
    >
      <div className="grid grid-cols-1 gap-4 p-4 @[520px]/post:grid-cols-[112px_minmax(0,1fr)]">
        <div
          aria-hidden
          className={cn(
            "aspect-video place-items-center overflow-hidden rounded-md bg-fill text-ink-muted @[520px]/post:grid @[520px]/post:aspect-[4/3]",
            // Without an image a phone-width card skips the placeholder
            // rather than spend a screenful of grey on it.
            thumbnailUrl ? "grid" : "hidden"
          )}
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
            <ImageIcon className="size-6" strokeWidth={1.5} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {topic ? (
              <span className="inline-flex h-[22px] items-center rounded-sm border border-line px-1.5 text-caption font-medium text-ink-secondary">
                {topic}
              </span>
            ) : null}
            <h3
              id={headingId}
              className="min-w-0 text-title font-semibold break-words text-ink"
            >
              {title}
            </h3>
            <StatusPill tone={tone === "neutral" ? "outline" : tone}>
              {status}
            </StatusPill>
          </div>

          <p
            className="text-ui break-words whitespace-pre-wrap text-ink-secondary"
            lang={lang}
            dir="auto"
          >
            {summary || "—"}
          </p>

          {meta ? (
            <p className="font-mono text-caption break-words text-ink-muted tabular-nums">
              {meta}
            </p>
          ) : null}

          {problem ? (
            <div
              role="note"
              className="rounded-md border border-line bg-danger-tint px-3 py-2 text-ui text-ink"
            >
              {problem}
            </div>
          ) : null}

          {actions ? <div className="mt-1">{actions}</div> : null}

          {lifecycle && lifecycle.length > 0 ? (
            <details className="group/lc mt-1">
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
      </div>
    </article>
  )
}
