"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  tabItemClassName,
  tabsRowClassName,
  useScrollFade,
} from "@/components/ui/tabs"
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
 * On a phone it is a sticky strip of text tabs under the app bar that
 * scrolls sideways (the shared tab drawing: muted labels over a hairline,
 * the current one in ink, semibold and underlined, so the cue is never
 * colour alone), with a faded edge where more tabs sit past it. On a desk it
 * is a sticky rail of calm rows beside the form, the current row filled.
 * Either way the section in view is marked `aria-current="location"`
 * (scroll-spy), its tab is kept in view, and choosing one jumps to the
 * section and focuses its heading. A section with edits that differ from
 * Google says "Changed" in words on the rail; the strip has no room for the
 * word, so it shows a dot, and both say "(changed)" to a screen reader.
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
  // The section a tab just jumped to. A jump lands the section at its
  // scroll margin, which on a phone can sit below the scroll-spy line, so
  // the spy would light the section above it; and blocks loading above it
  // would push it away. The chosen section stays current, and in place,
  // until the person scrolls or types themselves.
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
    // A tab tapped while Google's sections are still loading jumps to its
    // section, and then those sections arrive above it and push it off the
    // screen. While the jump is pinned, keep the chosen section in place.
    let anchorFrame = 0
    const reanchor = () => {
      if (!pinned.current) return
      cancelAnimationFrame(anchorFrame)
      anchorFrame = requestAnimationFrame(() => {
        if (pinned.current)
          document
            .getElementById(pinned.current)
            ?.scrollIntoView({ block: "start" })
      })
    }
    const observer = new MutationObserver(() => {
      measure()
      reanchor()
    })
    observer.observe(root, { childList: true, subtree: true })
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(reanchor)
    resize?.observe(root)
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(anchorFrame)
      observer.disconnect()
      resize?.disconnect()
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
      // The line sits just under a tab strip, or level with the top of a
      // rail (a rail runs down beside the sections, so its bottom would put
      // the line most of the way down the screen).
      const nav = navRef.current?.getBoundingClientRect()
      const rail = nav ? nav.height > nav.width : false
      // Never above the sticky chrome the page scrolls under (the document's
      // scroll padding): a strip that scrolls with the page on a short phone
      // has its bottom above the screen once it has scrolled away.
      const chrome =
        Number.parseFloat(
          getComputedStyle(document.documentElement).scrollPaddingTop
        ) || 0
      const line =
        Math.max(nav ? (rail ? nav.top : nav.bottom) : 0, chrome) + 24
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
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const
    events.forEach((name) =>
      window.addEventListener(name, release, { passive: true })
    )
    return () => {
      observer.disconnect()
      events.forEach((name) => window.removeEventListener(name, release))
    }
  }, [present])

  // Keep the current tab in view in the sideways-scrolling strip.
  useEffect(() => {
    const list = listRef.current
    if (!list || !current) return
    const link = Array.from(list.querySelectorAll<HTMLElement>("a")).find(
      (anchor) => anchor.getAttribute("href") === `#${current}`
    )
    if (!link || list.scrollWidth <= list.clientWidth) return
    const left = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2
    const still =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    list.scrollTo?.({
      left: Math.max(0, left),
      behavior: still ? "auto" : "smooth",
    })
  }, [current])

  // Fade the strip's edge where more tabs sit past it (`data-fade`, drawn
  // by the shared tab row), so it says there is more without a scrollbar.
  // A desk rail never overflows sideways, so it never fades. The list is
  // always mounted (inside a hidden nav until the sections are measured),
  // so the shared hook finds it on its first run and its resize observer
  // follows the tabs as they arrive.
  useScrollFade(listRef)
  // A tab arriving or leaving changes what overflows without resizing the
  // strip itself: ask the hook (it listens for scroll) to look again.
  useEffect(() => {
    listRef.current?.dispatchEvent(new Event("scroll"))
  }, [present])

  const shown = present
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is SectionNavEntry => entry !== undefined)
  return (
    <nav
      ref={navRef}
      aria-label={label}
      // Hidden, and so out of the accessibility tree, until the sections on
      // the page have been measured.
      hidden={shown.length === 0}
      data-slot={shown.length === 0 ? undefined : "section-nav"}
      className={cn(
        // Phone: a sticky tab strip under the app bar (the same offset the
        // page's scroll padding uses). From md the editor scrolls in its own
        // pane below the area header, so the strip, and the desk rail,
        // stick to the top of that pane. A short phone (or one held
        // sideways) keeps the strip in the page: the app bar, the strip and
        // the tab bar together would take nearly half of its height.
        "sticky top-[calc(var(--np-appbar-h)+var(--np-safe-top))] z-sticky bg-canvas md:top-0 max-md:short:static",
        "desk:bg-transparent",
        className
      )}
    >
      <ol
        ref={listRef}
        className={cn(
          tabsRowClassName,
          "list-none",
          // The desk rail: a column of rows, no hairline under it.
          "desk:flex-col desk:items-stretch desk:gap-0.5 desk:overflow-visible desk:border-b-0"
        )}
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
                // The current section is `aria-current="location"`: the
                // shared tab drawing gives it ink, semibold and the underline.
                tabItemClassName,
                // The desk rail: calm rows, the current one filled. No
                // underline and no border; the weight and fill carry it.
                "desk:flex desk:h-auto desk:min-h-9 desk:w-full desk:rounded-(--np-radius-control) desk:px-2.5 desk:py-1.5 desk:whitespace-normal desk:after:hidden",
                "desk:hover-fine:hover:bg-fill",
                "desk:aria-[current=location]:bg-fill"
              )}
            >
              {entry.label}
              {entry.changed ? (
                <>
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-info-solid desk:hidden"
                  />
                  <span
                    aria-hidden
                    className="ml-auto hidden text-caption font-medium text-info-ink desk:inline"
                  >
                    Changed
                  </span>
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
