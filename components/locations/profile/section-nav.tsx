"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { ChevronLeft } from "lucide-react"

import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import {
  tabItemClassName,
  tabsRowClassName,
  useScrollFade,
} from "@/components/ui/tabs"
import { pushUrl } from "@/lib/navigation/shallow-url"
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

const PHONE_INDEX_ID = "profile-section-index"

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

/**
 * The phone's section index (under 48rem): the profile is a list of its
 * sections, and choosing one shows that section alone. Which one is open
 * lives in the address (`?section=contact`), so the phone's Back button
 * returns to the list and a reload keeps the place. Wider screens ignore it.
 */
const SECTION_PARAM = "section"
const SECTION_PREFIX = "section-"
const PHONE_QUERY = "(max-width: 47.99rem)"

const sectionListeners = new Set<() => void>()

function subscribeSection(listener: () => void) {
  sectionListeners.add(listener)
  window.addEventListener("popstate", listener)
  return () => {
    sectionListeners.delete(listener)
    window.removeEventListener("popstate", listener)
  }
}

function readSection(): string | null {
  const slug = new URLSearchParams(window.location.search).get(SECTION_PARAM)
  return slug ? `${SECTION_PREFIX}${slug}` : null
}

/**
 * The section a phone shows alone, or null for the index. Null on the
 * server, so the first paint is the same everywhere.
 */
export function usePhoneSection(): string | null {
  return useSyncExternalStore(subscribeSection, readSection, () => null)
}

/**
 * On a phone, the class that hides a block while another section (or the
 * index) is showing. The block stays mounted, so its edits are kept.
 */
export function phoneSectionClass(id: string, open: string | null) {
  return open === id ? undefined : "max-md:hidden"
}

function isPhone() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_QUERY).matches
  )
}

/**
 * Show one section (or, with null, the index) on a phone. Both directions
 * are new history entries: going back through history is the leave guard's
 * gesture, and stepping back onto its sentinel would ask about leaving a
 * page that stays open.
 */
export function setPhoneSection(id: string | null) {
  const url = new URL(window.location.href)
  if (id)
    url.searchParams.set(
      SECTION_PARAM,
      id.startsWith(SECTION_PREFIX) ? id.slice(SECTION_PREFIX.length) : id
    )
  else url.searchParams.delete(SECTION_PARAM)
  url.hash = ""
  pushUrl(url.pathname + url.search)
  sectionListeners.forEach((listener) => listener())
}

/**
 * A validation link's field may sit in a section the phone is not showing:
 * open that section and wait until the field can take focus. Elsewhere this
 * does nothing.
 */
export async function revealPhoneSectionOf(target: HTMLElement) {
  if (!isPhone() || target.getClientRects().length > 0) return
  // The outermost one: a section can hold a card with an id of its own.
  let section: HTMLElement | null = null
  for (
    let node = target.parentElement;
    node && node !== document.body;
    node = node.parentElement
  )
    if (node.id.startsWith(SECTION_PREFIX)) section = node
  if (!section) return
  setPhoneSection(section.id)
  for (let frame = 0; frame < 20; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (target.getClientRects().length > 0) return
  }
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
 * On a phone (under 48rem) it is the section index: a list of the sections,
 * each opening on its own screen with an "All sections" link back (D9), so
 * the profile is never one 15,000px page. On a touch tablet it is a sticky
 * strip of text tabs that scrolls sideways (the shared tab drawing: muted
 * labels over a hairline, the current one in ink, semibold and underlined,
 * so the cue is never colour alone), with a faded edge where more tabs sit
 * past it. On a desk it is a sticky rail of calm rows beside the form, the
 * current row filled. Strip and rail mark the section in view
 * `aria-current="location"` (scroll-spy), keep its tab in view, and jump to
 * the section and focus its heading. A section with edits that differ from
 * Google says "Edited" in ink on the index and the rail (the strip has room
 * only for an ink dot, and says "(edited)" to a screen reader). Ink, not
 * blue: nothing has gone to Google yet.
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
  const open = usePhoneSection()
  const indexRef = useRef<HTMLDivElement>(null)
  const lastOpen = useRef<string | null>(open)

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

  // Opening a section on a phone lands on its heading; coming back to the
  // index lands on the row it was opened from. The first render (a reload
  // or a shared address) moves nothing.
  useEffect(() => {
    const previous = lastOpen.current
    lastOpen.current = open
    if (previous === open || !isPhone()) return
    if (open) {
      window.scrollTo({ top: 0 })
      jumpToSection(open)
      return
    }
    window.scrollTo({ top: 0 })
    indexRef.current
      ?.querySelector<HTMLElement>(`[data-section="${previous}"]`)
      ?.focus({ preventScroll: true })
  }, [open])

  const shown = present
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is SectionNavEntry => entry !== undefined)
  const openEntry = open ? shown.find((entry) => entry.id === open) : undefined
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
        // A phone has the index instead, which scrolls with the page.
        "z-sticky bg-canvas md:sticky md:top-0",
        "desk:bg-transparent",
        className
      )}
    >
      <div ref={indexRef} className="md:hidden">
        {openEntry ? (
          <div className="flex flex-col items-start gap-1">
            <a
              href={`#${PHONE_INDEX_ID}`}
              onClick={(event) => {
                event.preventDefault()
                setPhoneSection(null)
              }}
              className="-ml-1 inline-flex min-h-11 items-center gap-0.5 rounded-(--np-radius-control) px-1 text-ui font-medium text-ink focus-halo"
            >
              <ChevronLeft aria-hidden className="size-4" strokeWidth={1.75} />
              All sections
            </a>
            {/* The section's own heading stays for assistive tech (and
                takes focus); this is its visible title on a phone. */}
            <p aria-hidden className="text-title font-semibold text-ink">
              {openEntry.label}
            </p>
          </div>
        ) : (
          <GroupedList id={PHONE_INDEX_ID}>
            {shown.map((entry) => (
              <GroupedListItem
                key={entry.id}
                data-section={entry.id}
                label={entry.label}
                trailing={
                  entry.changed ? (
                    <span className="text-caption font-medium text-ink">
                      Edited
                    </span>
                  ) : undefined
                }
                onClick={() => setPhoneSection(entry.id)}
              />
            ))}
          </GroupedList>
        )}
      </div>
      <ol
        ref={listRef}
        className={cn(
          tabsRowClassName,
          "list-none max-md:hidden",
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
                    className="size-1.5 shrink-0 rounded-full bg-ink desk:hidden"
                  />
                  <span
                    aria-hidden
                    className="ml-auto hidden text-caption font-medium text-ink desk:inline"
                  >
                    Edited
                  </span>
                  <span className="sr-only"> (edited)</span>
                </>
              ) : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
