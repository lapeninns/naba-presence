"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef } from "react"

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
 * viewport is the drawing:
 *
 *   - from `md`, each job section is a segmented control — a grey track with
 *     a white thumb on the selected segment — under a caption naming the job;
 *   - below `md`, the same links become one horizontally scrolling strip of
 *     capsules, the selected one tinted, and the captions go screen-reader
 *     only so the strip stays one line tall.
 */
const TRACK_CLASS =
  "flex items-center gap-1 md:h-(--np-control-h) md:gap-0.5 md:rounded-(--np-radius-control) md:bg-fill md:p-0.5"

const LINK_CLASS = cn(
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) bg-fill px-3 text-ui font-medium whitespace-nowrap text-ink-muted focus-halo select-none",
  "transition-[color,background-color,transform,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:text-ink active:scale-[0.98]",
  "md:h-full md:rounded-[calc(var(--np-radius-control)-2px)] md:bg-transparent"
)

const ACTIVE_LINK_CLASS =
  "bg-accent-tint text-accent-ink md:bg-surface md:text-ink md:shadow-(--np-shadow-raised)"

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
  const activeRef = useRef<HTMLAnchorElement | null>(null)
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

  useEffect(() => {
    // jsdom (unit tests) doesn't implement scrollIntoView — guard so the
    // scroll affordance is a no-op there instead of throwing.
    if (typeof activeRef.current?.scrollIntoView === "function") {
      activeRef.current.scrollIntoView({ inline: "nearest", block: "nearest" })
    }
  }, [activeSegment])

  return (
    <nav
      aria-label="Location sections"
      // shrink-0: the workspace <main> is height-constrained (overflow hidden),
      // and an overflow-x-auto flex item has min-height 0, so without this the
      // nav is the one thing that collapses when tab content is taller than
      // the viewport. The negative margin lets the capsule strip scroll to the
      // gutter's edge on a phone instead of clipping mid-capsule.
      className="-mx-5 shrink-0 overflow-x-auto px-5 md:mx-0 md:px-0"
    >
      <ul className="flex min-w-max items-end gap-2 md:min-w-0 md:flex-wrap md:gap-x-4 md:gap-y-3">
        {sections.map((section, sectionIndex) => (
          <li key={section.id} className="flex items-end gap-2 md:gap-4">
            {sectionIndex > 0 ? (
              <span
                aria-hidden
                className="mb-1.5 h-4 w-px shrink-0 bg-line md:hidden"
              />
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-caption font-medium text-ink-muted max-md:sr-only">
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
                      className="flex md:h-full"
                    >
                      <Link
                        ref={isActive ? activeRef : undefined}
                        href={href}
                        prefetch
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          LINK_CLASS,
                          isActive && ACTIVE_LINK_CLASS
                        )}
                      >
                        {tab.label}
                        {pending > 0 ? (
                          <span
                            aria-label={`${pending} suggestions from Google`}
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
    </nav>
  )
}
