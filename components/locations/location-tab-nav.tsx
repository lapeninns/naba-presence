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
      // the viewport.
      className="shrink-0 overflow-x-auto"
    >
      <ul className="flex min-w-max items-end gap-3 border-b border-border pb-px">
        {sections.map((section, sectionIndex) => (
          <li key={section.id} className="flex items-end gap-3">
            {sectionIndex > 0 ? (
              <span aria-hidden className="mb-2 h-6 w-px shrink-0 bg-border" />
            ) : null}
            <div className="flex flex-col gap-0.5">
              <span className="px-3 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                {section.label}
              </span>
              <ul className="flex gap-1">
                {section.tabs.map((tab) => {
                  const href = tab.segment ? `${base}/${tab.segment}` : base
                  const isActive = activeSegment === tab.segment
                  return (
                    <li key={tab.segment || "profile"}>
                      <Link
                        ref={isActive ? activeRef : undefined}
                        href={href}
                        prefetch
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-ui font-medium transition-colors duration-(--np-duration-fast) focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                          isActive
                            ? "border-primary text-foreground"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {tab.label}
                        {(pendingBySegment.get(tab.segment) ?? 0) > 0 ? (
                          <span
                            aria-label={`${pendingBySegment.get(tab.segment)} suggestions from Google`}
                            className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.65rem] font-semibold text-primary-foreground"
                          >
                            {pendingBySegment.get(tab.segment)}
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
