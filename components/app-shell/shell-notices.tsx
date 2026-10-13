"use client"

import { ChevronDown } from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

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
          className="flex min-h-9 items-center gap-1.5 bg-surface-alt px-5 text-ui font-medium text-ink-secondary shadow-np-edge-bottom focus-halo hover:text-ink focus-visible:outline-none md:px-(--np-page-pad-x) pointer-coarse:min-h-11"
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 transition-transform duration-(--np-duration-fast)",
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

export { ShellNotices }
