"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  jobForSegment,
  segmentHref,
  visibleLocationJobs,
} from "@/lib/locations/location-ia"
import { useImportReviewCounts } from "@/lib/queries/use-import-review"
import { cn } from "@/lib/utils"

// Every pending suggestion, of either kind, counts against the Listing job
// and its Suggested updates anchor.
const PROPOSAL_RESOURCES = new Set(["profile", "food_menus"])

/**
 * The job switcher for one location, and the row beneath it.
 *
 * The switcher is a segmented control of three real links (prefetched, with
 * `aria-current`), not tabs in the ARIA sense: the browser's back button,
 * middle-click and "open in new tab" all keep working. Under it, one row
 * that depends on the job: the Listing's in-page anchors, or the Content and
 * Access sub-views as a capsule strip of real links. Both rows scroll
 * sideways on a phone rather than wrapping.
 */
const TRACK_CLASS =
  "flex h-(--np-control-h) w-max items-center gap-0.5 rounded-(--np-radius-control) bg-fill p-0.5 pointer-coarse:h-11"

const SEGMENT_CLASS = cn(
  "inline-flex h-full items-center gap-1.5 rounded-[calc(var(--np-radius-control)-2px)] px-3.5 text-ui font-medium whitespace-nowrap text-ink-muted focus-halo select-none",
  "transition-[color,background-color,transform,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:text-ink active:scale-[0.98]"
)

const ACTIVE_SEGMENT_CLASS = "bg-surface text-ink shadow-(--np-shadow-raised)"

const CAPSULE_CLASS = cn(
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-(--np-radius-pill) bg-fill px-3 text-ui font-medium whitespace-nowrap text-ink-muted focus-halo select-none pointer-coarse:h-11",
  "transition-[color,background-color,transform,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
  "hover:text-ink active:scale-[0.98]"
)

const ACTIVE_CAPSULE_CLASS = "bg-accent-tint text-accent-ink"

const BADGE_CLASS =
  "inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-(--np-radius-pill) bg-primary px-1.5 text-caption font-semibold text-primary-foreground tabular-nums"

function pendingLabel(label: string, pending: number) {
  return pending > 0
    ? `${label}, ${pending} ${pending === 1 ? "suggestion" : "suggestions"} from Google`
    : undefined
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
  const jobs = visibleLocationJobs(canManageConsoles)
  const activeJob = jobForSegment(activeSegment) ?? jobs[0]

  const reviewCounts = useImportReviewCounts().data?.counts ?? []
  const pending = reviewCounts.reduce(
    (sum, entry) =>
      entry.locationId === locationId &&
      PROPOSAL_RESOURCES.has(entry.resourceType)
        ? sum + entry.pending
        : sum,
    0
  )

  const rowClass =
    "-mx-5 flex overflow-x-auto px-5 py-1 md:-mx-(--np-page-pad-x) md:px-(--np-page-pad-x)"

  return (
    <nav
      aria-label="Location sections"
      // shrink-0: the workspace <main> is height-constrained (overflow
      // hidden), and an overflow-x-auto child has min-height 0, so without
      // this the nav is the one thing that collapses when the job's content
      // is taller than the viewport.
      className="flex shrink-0 flex-col gap-2"
    >
      <div className={rowClass}>
        <ul className={TRACK_CLASS}>
          {jobs.map((job) => {
            const isActive = job.id === activeJob.id
            const badge = job.id === "listing" ? pending : 0
            return (
              <li key={job.id} className="flex h-full">
                <Link
                  href={segmentHref(locationId, job.segment)}
                  prefetch
                  aria-current={isActive ? "page" : undefined}
                  aria-label={pendingLabel(job.label, badge)}
                  className={cn(
                    SEGMENT_CLASS,
                    isActive && ACTIVE_SEGMENT_CLASS
                  )}
                >
                  {job.label}
                  {badge > 0 ? (
                    <span aria-hidden className={BADGE_CLASS}>
                      {badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>

      {activeJob.views.length > 0 ? (
        <div className={rowClass}>
          <ul
            aria-label={`${activeJob.label} views`}
            className="flex min-w-max items-center gap-2"
          >
            {activeJob.views.map((view) => {
              const isActive = view.segment === activeSegment
              return (
                <li key={view.segment} className="flex">
                  <Link
                    href={segmentHref(locationId, view.segment)}
                    prefetch
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      CAPSULE_CLASS,
                      isActive && ACTIVE_CAPSULE_CLASS
                    )}
                  >
                    {view.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {activeJob.anchors.length > 0 ? (
        <div className={rowClass}>
          {/* In-page jumps, not routes: the Listing is one scroll and these
              land on its sections. Plain anchors so the browser's own hash
              navigation scrolls the workspace pane. */}
          <ul
            aria-label="On this page"
            className="flex min-w-max items-center gap-2"
          >
            {activeJob.anchors.map((anchor) => {
              const badge = anchor.id === "suggestions" ? pending : 0
              return (
                <li key={anchor.id} className="flex">
                  <a
                    href={`#${anchor.id}`}
                    aria-label={pendingLabel(anchor.label, badge)}
                    className={CAPSULE_CLASS}
                  >
                    {anchor.label}
                    {badge > 0 ? (
                      <span aria-hidden className={BADGE_CLASS}>
                        {badge}
                      </span>
                    ) : null}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </nav>
  )
}
