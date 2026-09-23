import { Check, CircleAlert, TriangleAlert } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

export type TimelineTone =
  "accent" | "success" | "warning" | "danger" | "info" | "neutral"

export type TimelineEntry = {
  id: string
  title: React.ReactNode
  /** Who and when, already formatted; shown under the title. */
  meta?: React.ReactNode
  /**
   * A short time in the right-hand column (reference `.when`), mono and
   * muted: "2 h ago". Optional; `meta` keeps working without it.
   */
  when?: React.ReactNode
  detail?: React.ReactNode
  /** A 11px glyph inside the mark; overrides the tone's default glyph. */
  marker?: React.ReactNode
  /**
   * Tints the mark. Never the only signal: the state must also be in the
   * title or meta.
   */
  tone?: TimelineTone
}

const MARK_TONE_CLASS: Record<TimelineTone, string> = {
  accent: "bg-accent-tint text-accent-ink",
  success: "bg-success-tint text-success-ink",
  warning: "bg-warning-tint text-warning-ink",
  danger: "bg-danger-tint text-danger-ink",
  info: "bg-info-tint text-info-ink",
  neutral: "bg-fill text-ink-secondary",
}

function defaultGlyph(tone: TimelineTone) {
  if (tone === "success") return <Check strokeWidth={2.25} />
  if (tone === "danger") return <CircleAlert strokeWidth={2} />
  if (tone === "warning") return <TriangleAlert strokeWidth={2} />
  return <span className="size-1.5 rounded-full bg-current" />
}

/**
 * A chronological list (reference `.timeline`): a 20px tinted mark per
 * entry joined by a hairline, the event in UI text, an optional time in the
 * right-hand column, and detail beneath in muted text.
 *
 * An `ol` because order is the meaning. Titles are plain text, not
 * headings, so a timeline can sit inside any section.
 */
function Timeline({
  entries,
  reveal = false,
  className,
  ...props
}: Omit<React.ComponentProps<"ol">, "children"> & {
  entries: TimelineEntry[]
  /**
   * Marks each entry `data-reveal="rise"` so a page that installs
   * `lib/motion/reveal.ts` reveals the rows once as they scroll in.
   */
  reveal?: boolean
}) {
  return (
    <ol
      data-slot="timeline"
      className={cn("flex list-none flex-col", className)}
      {...props}
    >
      {entries.map((entry) => {
        const tone = entry.tone ?? "neutral"
        return (
          <li
            key={entry.id}
            data-reveal={reveal ? "rise" : undefined}
            data-tone={tone}
            className="relative grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 py-2.5 text-ui before:absolute before:top-[30px] before:-bottom-2 before:left-[9.5px] before:w-px before:bg-line before:content-[''] last:before:hidden"
          >
            <span
              aria-hidden
              className={cn(
                "grid size-5 place-items-center rounded-full [&_svg]:size-[11px]",
                MARK_TONE_CLASS[tone]
              )}
            >
              {entry.marker ?? defaultGlyph(tone)}
            </span>
            <div className="min-w-0 self-center">
              <p className="font-medium text-ink">{entry.title}</p>
              {entry.meta ? (
                <p className="text-caption text-ink-muted tabular-nums">
                  {entry.meta}
                </p>
              ) : null}
            </div>
            {entry.when ? (
              <span className="pt-0.5 font-mono text-[11.5px] whitespace-nowrap text-ink-muted tabular-nums">
                {entry.when}
              </span>
            ) : (
              <span />
            )}
            {entry.detail ? (
              <div className="col-start-2 col-end-4 text-[12.5px] text-ink-muted">
                {entry.detail}
              </div>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export { Timeline }
