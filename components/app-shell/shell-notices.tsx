"use client"

import { ChevronDown } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The persistent-banner strip every shell notice is drawn as (Notion Mail's
 * announcement bar): full width, page-gutter padding, `text-ui`, a leading
 * 16px glyph, the words, then the action as underlined text. The tone (a
 * status tint, or charcoal for impersonation) is added by each notice from
 * what it means. Wraps on a phone rather than truncating: the words are the
 * notice.
 */
const NOTICE_STRIP_CLASS =
  "flex w-full shrink-0 flex-wrap items-start gap-x-3 gap-y-1 px-5 py-2 text-left text-ui md:items-center md:px-(--np-page-pad-x) [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 md:[&>svg]:mt-0"

/**
 * A notice's action as underlined text in the strip's ink, with a 44px hit
 * on touch. Pass with `buttonVariants({ variant: "link" })` (a link or a
 * Button), which brings the focus halo and pending state.
 */
const NOTICE_ACTION_CLASS =
  "min-h-8 shrink-0 font-semibold text-ink underline decoration-1 underline-offset-3 hover:decoration-2 pointer-coarse:min-h-11"

/**
 * One region for the shell's standing notices (support impersonation, the
 * result of a Google connect, broken Google logins, billing).
 *
 * Each notice keeps its own rules for when it shows and what it says; this
 * only decides how many show at once. Children are given in priority order,
 * each in its own slot, and while collapsed only the first slot that has
 * something in it shows. When more than one has content, a "+N more"
 * control discloses the rest. On a phone three stacked banners took a
 * third of the screen before any content; on a desk they pushed the
 * workspace frame's pinned action row off the bottom.
 *
 * Which slots have content is read from the DOM (a slot is filled when an
 * element in it is not `:empty`; a notice that rendered nothing leaves at
 * most an empty wrapper), so no notice has to report its own visibility up
 * and every one of them stays exactly as it was.
 */
function ShellNotices({ children }: { children: React.ReactNode }) {
  const regionRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()
  const [count, setCount] = React.useState(0)
  const [expanded, setExpanded] = React.useState(false)

  React.useEffect(() => {
    const region = regionRef.current
    if (!region) return
    const measure = () => {
      const filled = Array.from(
        region.querySelectorAll<HTMLElement>(
          ':scope > [data-slot="notice-list"] > [data-notice]'
        )
      ).filter((slot) => slot.querySelector(":scope > :not(:empty)")).length
      setCount(filled)
    }
    measure()
    const observer = new MutationObserver(measure)
    observer.observe(region, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  // Back to one when the extra notices resolve, so a later one starts
  // collapsed again.
  if (expanded && count <= 1) setExpanded(false)

  const hiddenCount = Math.max(0, count - 1)
  const slots = React.Children.toArray(children)

  return (
    <div
      ref={regionRef}
      data-slot="shell-notices"
      data-count={count}
      className="flex shrink-0 flex-col empty:hidden print:hidden"
    >
      <div
        id={listId}
        data-slot="notice-list"
        className={cn(
          "flex flex-col",
          // Collapsed: every filled slot after the first filled one hides.
          !expanded &&
            "[&>[data-notice]:has(>:not(:empty))~[data-notice]]:hidden"
        )}
      >
        {slots.map((slot, index) => (
          <div key={index} data-notice className="contents">
            {slot}
          </div>
        ))}
      </div>
      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
          className={cn(
            NOTICE_STRIP_CLASS,
            "min-h-9 items-center bg-surface-alt font-medium text-ink-secondary shadow-np-edge-bottom focus-halo hover:text-ink focus-visible:outline-none pointer-coarse:min-h-11 [&>svg]:mt-0"
          )}
        >
          <ChevronDown
            className={cn(
              "transition-transform duration-(--np-duration-fast) motion-reduce:transition-none",
              expanded && "rotate-180"
            )}
            strokeWidth={1.75}
            aria-hidden
          />
          {expanded
            ? "Show fewer notices"
            : `+${hiddenCount} more ${hiddenCount === 1 ? "notice" : "notices"}`}
        </button>
      ) : null}
    </div>
  )
}

export { NOTICE_ACTION_CLASS, NOTICE_STRIP_CLASS, ShellNotices }
