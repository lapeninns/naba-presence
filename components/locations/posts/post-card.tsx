"use client"

import { EllipsisIcon, ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusPill } from "@/components/ui/status-pill"
import type { StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

export type PostCardMenuItem = {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Renders in the danger ink: "Delete post". */
  destructive?: boolean
}

/**
 * One post in the list: a media thumbnail on the left, the title in the
 * headline weight, a status pill, the summary, then the row's actions. The
 * overflow menu is plain — an icon button that opens a Mac-style menu — and
 * is only drawn when there are items for it.
 *
 * Presentation only: the host list decides which status tone and which
 * actions a post gets, and passes them in.
 */
export function PostCard({
  title,
  summary,
  status,
  tone,
  meta,
  thumbnailUrl,
  thumbnailAlt = "",
  lang,
  actions,
  menuItems,
  className,
}: {
  /** The headline: an event or offer title, or the topic ("Update"). */
  title: string
  summary: string
  /** The status word shown in the pill, e.g. "Draft". */
  status: string
  tone: StatusTone
  /** Small print beside the status: the topic, a date. */
  meta?: React.ReactNode
  thumbnailUrl?: string | null
  thumbnailAlt?: string
  lang?: string
  /** The row's buttons (publish, approve, check). Rendered beneath the text. */
  actions?: React.ReactNode
  /** Secondary actions for the overflow menu. */
  menuItems?: PostCardMenuItem[]
  className?: string
}) {
  const hasMenu = Boolean(menuItems && menuItems.length > 0)
  return (
    <article
      data-slot="post-card"
      className={cn(
        "flex gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)",
        className
      )}
    >
      <div
        aria-hidden={thumbnailUrl ? undefined : true}
        className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-(--np-radius-tag) bg-fill text-ink-faint hairline"
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt={thumbnailAlt}
            referrerPolicy="no-referrer"
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <ImageIcon className="size-6" strokeWidth={1.25} />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="truncate text-body font-semibold text-ink">
              {title}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={tone}>{status}</StatusPill>
              {meta ? (
                <span className="text-caption text-ink-muted">{meta}</span>
              ) : null}
            </div>
          </div>
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`More actions for ${title}`}
                  />
                }
              >
                <EllipsisIcon aria-hidden strokeWidth={1.75} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuItems?.map((item) => (
                  <DropdownMenuItem
                    key={item.label}
                    disabled={item.disabled}
                    variant={item.destructive ? "destructive" : "default"}
                    onClick={item.onSelect}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <p
          className="text-body whitespace-pre-wrap text-ink"
          lang={lang}
          dir="auto"
        >
          {summary || "—"}
        </p>

        {actions ? <div className="pt-1">{actions}</div> : null}
      </div>
    </article>
  )
}
