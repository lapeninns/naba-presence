"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { chipClassName } from "@/components/ui/chip"
import { cn } from "@/lib/utils"

export type SectionNavEntry = {
  /** The section's DOM id; its heading is `${id}-heading`. */
  readonly id: string
  readonly label: string
  /** The section holds edits that differ from Google. */
  readonly changed?: boolean
}

/** The element that holds every block the nav can index (see ProfileTab). */
export const PROFILE_PAGE_SLOT = "profile-page"

/**
 * Scrolls a section to the top of the pane (under the sticky chrome, via
 * the scroll margins) and moves focus to its heading, so a screen reader and
 * the next Tab start there. A heading that is not focusable yet becomes a
 * programmatic focus target.
 */
export function jumpToSection(id: string) {
  const section = document.getElementById(id)
  if (!section) return
  section.scrollIntoView({ block: "start" })
  const heading = document.getElementById(`${id}-heading`)
  if (!heading) return
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1")
  heading.focus({ preventScroll: true })
}

function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

/**
 * The profile's one section navigation, built from the same ordered list as
 * the page and showing only the blocks actually on the page (several
 * sections render themselves only when they have something to show), in
 * page order.
 *
 * On a phone it is a sticky row of chips under the app bar that scrolls
 * sideways; on a desk it is a sticky rail beside the form. Either way the
 * section in view is marked `aria-current="location"` (scroll-spy), its chip
 * is kept in view, and choosing one jumps to the section and focuses its
 * heading.
 */
export function SectionNav({
  entries,
  label = "Profile sections",
  className,
}: {
  readonly entries: readonly SectionNavEntry[]
  readonly label?: string
  readonly className?: string
}) {
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const [present, setPresent] = useState<string[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  // The section a chip just jumped to. A jump lands the section at its
  // scroll margin, which on a phone can sit below the scroll-spy line, so
  // the spy would light the section above it. The chosen section stays
  // current until the person scrolls or types themselves.
  const pinned = useRef<string | null>(null)
  const wanted = entries.map((entry) => entry.id).join(" ")

  // Which entries are on the page, in document order. Self-gating blocks
  // (saved work, lodging, the catalogue handoff) mount after their data
  // arrives, so the list follows the DOM instead of guessing.
  const measure = useCallback(() => {
    const ids = wanted ? wanted.split(" ") : []
    const found = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
      .sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      )
      .map((element) => element.id)
    setPresent((previous) => (sameIds(previous, found) ? previous : found))
  }, [wanted])

  useEffect(() => {
    // Measured after paint, then whenever the page's blocks change.
    const frame = requestAnimationFrame(measure)
    const root =
      navRef.current?.closest(`[data-slot="${PROFILE_PAGE_SLOT}"]`) ??
      document.body
    const observer = new MutationObserver(() => measure())
    observer.observe(root, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [measure])

  // Scroll-spy: the current section is the last one whose top has passed a
  // line just under the sticky chrome.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || present.length === 0)
      return
    const sections = present
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    const update = () => {
      if (pinned.current) return
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 16
      let next: string | null = sections[0]?.id ?? null
      for (const section of sections)
        if (section.getBoundingClientRect().top <= line) next = section.id
      setCurrent(next)
    }
    const observer = new IntersectionObserver(update, {
      threshold: [0, 0.25, 0.5, 0.75, 1],
    })
    sections.forEach((section) => observer.observe(section))
    const release = () => {
      pinned.current = null
    }
    const events = ["wheel", "touchstart", "keydown"] as const
    events.forEach((name) =>
      window.addEventListener(name, release, { passive: true })
    )
    return () => {
      observer.disconnect()
      events.forEach((name) => window.removeEventListener(name, release))
    }
  }, [present])

  // Keep the current chip in view in the sideways-scrolling row.
  useEffect(() => {
    const list = listRef.current
    if (!list || !current) return
    const link = Array.from(list.querySelectorAll<HTMLElement>("a")).find(
      (anchor) => anchor.getAttribute("href") === `#${current}`
    )
    if (!link || list.scrollWidth <= list.clientWidth) return
    const left = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2
    list.scrollTo?.({ left: Math.max(0, left), behavior: "smooth" })
  }, [current])

  const shown = present
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is SectionNavEntry => entry !== undefined)
  if (shown.length === 0) return <nav ref={navRef} aria-label={label} hidden />

  return (
    <nav
      ref={navRef}
      aria-label={label}
      data-slot="section-nav"
      className={cn(
        // Phone: a sticky chip row under the app bar (the same offset the
        // document's scroll padding uses). Desk: a sticky rail.
        "sticky top-[calc(var(--np-appbar-h)+var(--np-safe-top))] z-sticky -mx-1 bg-canvas px-1 py-2 md:top-(--np-toolbar-h)",
        "desk:top-[calc(var(--np-toolbar-h)+--spacing(4))] desk:mx-0 desk:bg-transparent desk:p-0",
        className
      )}
    >
      <ol
        ref={listRef}
        className="flex min-w-0 [scrollbar-width:none] gap-2 overflow-x-auto desk:flex-col desk:gap-0.5 desk:overflow-visible [&::-webkit-scrollbar]:hidden"
      >
        {shown.map((entry) => (
          <li key={entry.id} className="shrink-0">
            <a
              href={`#${entry.id}`}
              aria-current={current === entry.id ? "location" : undefined}
              onClick={(event) => {
                event.preventDefault()
                pinned.current = entry.id
                setCurrent(entry.id)
                jumpToSection(entry.id)
              }}
              className={cn(
                chipClassName(),
                "pointer-coarse:h-(--np-touch)",
                "aria-[current=location]:border-ink aria-[current=location]:bg-ink aria-[current=location]:text-canvas",
                // The desk rail: plain rows, the current one in the accent tint.
                "desk:flex desk:h-auto desk:min-h-8 desk:w-full desk:rounded-(--np-radius-control) desk:border-transparent desk:bg-transparent desk:px-2.5 desk:font-normal desk:text-ink-secondary",
                "desk:hover:border-transparent desk:hover:bg-fill desk:hover:text-ink",
                "desk:aria-[current=location]:border-transparent desk:aria-[current=location]:bg-accent-tint desk:aria-[current=location]:font-semibold desk:aria-[current=location]:text-accent-ink"
              )}
            >
              {entry.label}
              {entry.changed ? (
                <>
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-info-solid desk:ml-auto"
                  />
                  <span className="sr-only"> (changed)</span>
                </>
              ) : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
