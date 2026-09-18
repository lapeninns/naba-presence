"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"

import { visibleLocationSections } from "@/lib/locations/location-ia"
import { useImportReviewCounts } from "@/lib/queries/use-import-review"
import { cn } from "@/lib/utils"

// Every pending suggestion, of either kind, counts against the one tab that
// now reviews them.
const PROPOSAL_SEGMENTS: Record<string, string> = {
  profile: "suggestions",
  food_menus: "suggestions",
}

/**
 * The section switcher for one location.
 *
 * These are routes, so every segment is a real link (prefetched, with
 * `aria-current`), not a tab in the ARIA sense: the browser's back button,
 * middle-click and "open in new tab" all keep working. What changes with the
 * viewport is the drawing, and every viewport gets ONE decided shape rather
 * than whatever the line box happened to allow:
 *
 *   - in `capsules` — a phone, or any viewport under 34rem tall — the links
 *     are one horizontally scrolling strip of capsules, the selected one
 *     tinted, each group introduced by its caption inline on the same line,
 *     so the whole switcher is one row tall;
 *   - in `controls` — wide AND tall enough — each job section is a segmented
 *     control, a grey track with a white thumb on the selected segment, under
 *     a caption naming the job: one control per row, two per row from `lg`,
 *     all four on one row from `xl`.
 *
 * Both halves of that condition are measured. The shell's sidebar takes 244px
 * from `md` up, so the workspace holds 460px of content at 768, 716px at `lg`
 * and 972px at `xl`, while the widest control is 387px, two side by side need
 * 584px and four need 876px — hence each column count appearing at the first
 * width that fits it, and no row able to push the page sideways. The height
 * half is why a landscape phone (844x390, 932x430 — wide enough for `md`,
 * 390px tall) keeps the strip: four stacked controls are 272px, which would
 * leave it 24px of tab content. The strip keeps `overflow-x-auto` in both
 * modes as the backstop: if a longer label ever outgrew its row it scrolls,
 * with the edge cue below saying so, instead of being clipped by the
 * workspace's hidden overflow.
 */
const TRACK_CLASS =
  "flex items-center gap-1 controls:h-(--np-control-h) controls:gap-0.5 controls:rounded-(--np-radius-control) controls:bg-fill controls:p-0.5 controls:pointer-coarse:h-11"

const LINK_CLASS = cn(
  // The capsule IS the target, so its height is the target size: 28px
  // where a mouse drives, 44px wherever the pointer is a finger — including
  // the segmented track below, which otherwise keeps the compact 32px
  // control height.
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) bg-fill px-3 text-ui font-medium whitespace-nowrap text-ink-muted focus-halo select-none capsules:pointer-coarse:h-11",
  "transition-[color,background-color,transform,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:text-ink active:scale-[0.98]",
  "controls:h-full controls:rounded-[calc(var(--np-radius-control)-2px)] controls:bg-transparent"
)

const ACTIVE_LINK_CLASS =
  "bg-accent-tint text-accent-ink controls:bg-surface controls:text-ink controls:shadow-(--np-shadow-raised)"

// The fade at a scrolled edge: shown only on a side that has something
// hidden behind it. Exactly one page gutter wide, which is also the strip's
// scroll padding, so a capsule scrolled or tabbed to the end comes to rest
// just clear of the fade rather than under it.
const EDGE_CUE_CLASS =
  "pointer-events-none absolute inset-y-0 z-10 w-(--np-page-pad-x) opacity-0 transition-opacity duration-(--np-duration-fast)"

/** Treat sub-pixel scroll offsets as "at the end": they are rounding, not room. */
const SCROLL_EPSILON = 1

export function LocationTabNav({
  locationId,
  canManageConsoles,
}: {
  locationId: string
  canManageConsoles: boolean
}) {
  const pathname = usePathname()
  const base = `/locations/${locationId}`
  const activeSegment = pathname.startsWith(base)
    ? pathname.slice(base.length).replace(/^\//, "")
    : ""
  const stripRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef<HTMLAnchorElement | null>(null)
  // The first pass jumps; later ones (the operator changed section) glide.
  const hasScrolledRef = useRef(false)
  const [overflow, setOverflow] = useState({ start: false, end: false })
  const sections = visibleLocationSections(canManageConsoles)
  const reviewCounts = useImportReviewCounts().data?.counts ?? []
  const pendingBySegment = new Map<string, number>()
  for (const entry of reviewCounts) {
    if (entry.locationId !== locationId) continue
    const segment = PROPOSAL_SEGMENTS[entry.resourceType]
    if (segment === undefined) continue
    pendingBySegment.set(
      segment,
      (pendingBySegment.get(segment) ?? 0) + entry.pending
    )
  }

  const measureOverflow = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return
    const room = strip.scrollWidth - strip.clientWidth
    const scrolled = strip.scrollLeft
    setOverflow((previous) => {
      const next = {
        start: room > SCROLL_EPSILON && scrolled > SCROLL_EPSILON,
        end: room > SCROLL_EPSILON && scrolled < room - SCROLL_EPSILON,
      }
      return previous.start === next.start && previous.end === next.end
        ? previous
        : next
    })
  }, [])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    measureOverflow()
    strip.addEventListener("scroll", measureOverflow, { passive: true })
    // The strip stops overflowing when the viewport widens, when the
    // control grid takes over, and when a pending badge appears — so watch the
    // scroll port and its content, not just the window. jsdom has no
    // ResizeObserver; there the cues simply stay hidden.
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(measureOverflow)
        : null
    observer?.observe(strip)
    if (strip.firstElementChild) observer?.observe(strip.firstElementChild)
    return () => {
      strip.removeEventListener("scroll", measureOverflow)
      observer?.disconnect()
    }
  }, [measureOverflow])

  useEffect(() => {
    const strip = stripRef.current
    const link = activeRef.current
    const wasFirstPass = !hasScrolledRef.current
    hasScrolledRef.current = true
    if (!strip || !link) return
    // Never `scrollIntoView`: it walks every scrollable ancestor, so on a
    // phone it drags the page (and the workspace's own pane) to reach a
    // capsule. Only this strip should move.
    if (typeof strip.scrollBy !== "function") return
    if (strip.scrollWidth - strip.clientWidth <= SCROLL_EPSILON) return
    const port = strip.getBoundingClientRect()
    const item = link.getBoundingClientRect()
    // Land the capsule inside the gutter rather than flush against the
    // bleed edge, which is also what keeps its focus halo on screen.
    const style = window.getComputedStyle(strip)
    const visibleStart = port.left + (Number.parseFloat(style.paddingLeft) || 0)
    const visibleEnd = port.right - (Number.parseFloat(style.paddingRight) || 0)
    const hiddenStart = visibleStart - item.left
    const hiddenEnd = item.right - visibleEnd
    if (hiddenStart <= SCROLL_EPSILON && hiddenEnd <= SCROLL_EPSILON) return
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    strip.scrollBy({
      left: hiddenStart > 0 ? -hiddenStart : hiddenEnd,
      behavior: wasFirstPass || reducedMotion ? "auto" : "smooth",
    })
  }, [activeSegment])

  return (
    <nav
      aria-label="Location sections"
      // shrink-0: the workspace <main> is height-constrained (overflow
      // hidden), and an overflow-x-auto child has min-height 0, so without
      // this the nav is the one thing that collapses when tab content is
      // taller than the viewport. The negative margin is the workspace's own
      // gutter, given back as padding on the scroll port below: the strip
      // scrolls to the screen's edge instead of clipping mid-capsule, the
      // focus halo always has room inside the port, and both follow the page
      // padding rather than a hard-coded copy of it.
      className="relative -mx-(--np-page-pad-x) shrink-0"
    >
      <div
        ref={stripRef}
        // py-1 and the scroll padding are the focus ring's room: an
        // `overflow-x-auto` box clips the other axis too, and the halo is
        // 3.5px on every side. The scroll padding is the page gutter, so a
        // capsule tabbed to at either end lands inside it, halo and all.
        className="flex scroll-px-(--np-page-pad-x) overflow-x-auto px-(--np-page-pad-x) py-1"
      >
        <ul className="flex min-w-max items-center gap-2 controls:grid controls:min-w-0 controls:grid-cols-[max-content] controls:items-end controls:gap-x-6 controls:gap-y-4 controls:lg:grid-cols-[repeat(2,max-content)] controls:xl:grid-cols-[repeat(4,max-content)]">
          {sections.map((section, sectionIndex) => (
            <li
              key={section.id}
              className="flex items-center gap-2 controls:items-end controls:gap-4"
            >
              {sectionIndex > 0 ? (
                <span
                  aria-hidden
                  className="h-5 w-px shrink-0 bg-line controls:hidden"
                />
              ) : null}
              <div className="flex items-center gap-2 controls:flex-col controls:items-start controls:gap-1.5">
                {/* Visible at every width. On a phone it sits on the capsules'
                    own line — ten undifferentiated capsules behind a hairline
                    is a list, not four jobs — set in caps so it reads as the
                    label of the group rather than another destination. */}
                <span className="px-1 text-caption font-medium whitespace-nowrap text-ink-muted capsules:tracking-wide capsules:uppercase">
                  {section.label}
                </span>
                <ul className={TRACK_CLASS}>
                  {section.tabs.map((tab) => {
                    const href = tab.segment ? `${base}/${tab.segment}` : base
                    const isActive = activeSegment === tab.segment
                    const pending = pendingBySegment.get(tab.segment) ?? 0
                    return (
                      <li
                        key={tab.segment || "profile"}
                        className="flex controls:h-full"
                      >
                        <Link
                          ref={isActive ? activeRef : undefined}
                          href={href}
                          prefetch
                          aria-current={isActive ? "page" : undefined}
                          // Spelled out on the link itself: `aria-label` on
                          // the badge span is advisory (a span has no role to
                          // hang a name on), and the two adjacent nodes would
                          // otherwise announce as "Suggested updates3".
                          aria-label={
                            pending > 0
                              ? `${tab.label}, ${pending} ${
                                  pending === 1 ? "suggestion" : "suggestions"
                                } from Google`
                              : undefined
                          }
                          className={cn(
                            LINK_CLASS,
                            isActive && ACTIVE_LINK_CLASS
                          )}
                        >
                          {tab.label}
                          {pending > 0 ? (
                            // The badge keeps the solid accent in every state:
                            // its own pairing is the audited one, so neither
                            // the tinted active capsule nor the grey inactive
                            // one can wash it out.
                            <span
                              aria-hidden
                              className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-(--np-radius-pill) bg-primary px-1.5 text-caption font-semibold text-primary-foreground tabular-nums"
                            >
                              {pending}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <span
        aria-hidden
        className={cn(
          EDGE_CUE_CLASS,
          "left-0 bg-linear-to-r from-canvas to-transparent",
          overflow.start && "opacity-100"
        )}
      />
      <span
        aria-hidden
        className={cn(
          EDGE_CUE_CLASS,
          "right-0 bg-linear-to-l from-canvas to-transparent",
          overflow.end && "opacity-100"
        )}
      />
    </nav>
  )
}
