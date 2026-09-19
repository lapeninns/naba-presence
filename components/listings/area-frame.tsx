"use client"

import { ArrowLeftIcon } from "lucide-react"
import Link from "next/link"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ActivityDrawer } from "@/components/editors/activity-drawer"
import { CapabilityBanner } from "@/components/editors/capability-banner"
import { ListingGate } from "@/components/listings/listing-gate"
import { SiblingSwitcher } from "@/components/listings/sibling-switcher"
import { buttonVariants } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import { syncStatusLabel, syncStatusTone } from "@/lib/listings/health"
import {
  listingArea,
  listingHref,
  modelNote,
  type ListingAreaKey,
} from "@/lib/listings/areas"
import { useListingSummary } from "@/lib/queries/use-listing-summary"

/**
 * The gutters and bottom padding of PageFrame, negated and then restored as
 * padding on the scrolling pane: an editor's sticky footer bleeds to the
 * pane's edges (its own negative margins mirror these), and `overflow-y-auto`
 * would otherwise clip that bleed.
 */
const PANE_BLEED =
  "-mx-5 -mb-6 px-5 pb-6 md:-mx-(--np-page-pad-x) md:-mb-(--np-page-pad-y) md:px-(--np-page-pad-x) md:pb-(--np-page-pad-y)"

/**
 * One area of a listing, as a focused page.
 *
 * The header says which listing this is and the way back to it, names the
 * area, and shows the same status its card showed on the overview, so
 * opening an editor never changes the story. Google-direct areas carry the
 * one sentence the review-then-publish areas never needed: that a change
 * here goes to Google as soon as it is confirmed.
 */
function AreaFrame({
  locationId,
  role,
  area: areaKey,
  children,
}: {
  locationId: string
  role: string | null
  area: ListingAreaKey
  children: React.ReactNode
}) {
  const area = listingArea(areaKey)
  const summary = useListingSummary(locationId)

  const synced =
    areaKey === "profile"
      ? summary.data?.profile
      : areaKey === "hours"
        ? summary.data?.hours
        : areaKey === "menu"
          ? summary.data?.menu
          : undefined

  return (
    <ListingGate locationId={locationId} role={role}>
      {(entry) => (
        <PageFrame width="workspace">
          <PageHeader
            eyebrow={
              <Link
                href={listingHref(locationId)}
                className="inline-flex items-center gap-1 rounded-(--np-radius-tag) text-caption font-medium text-accent-ink underline-offset-4 focus-halo hover:underline"
              >
                <ArrowLeftIcon
                  className="size-3.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
                {entry.name}
                {entry.clientName ? (
                  <span className="text-ink-muted"> · {entry.clientName}</span>
                ) : null}
              </Link>
            }
            title={area.label}
            meta={
              <span className="flex flex-wrap items-center gap-2">
                {synced && synced.status !== "unknown" ? (
                  <StatusPill tone={syncStatusTone(synced.status)}>
                    {syncStatusLabel(synced.status)}
                  </StatusPill>
                ) : null}
                <SiblingSwitcher current={entry} role={role} />
              </span>
            }
            description={area.description}
            actions={
              <>
                <ActivityDrawer locationId={locationId} />
                <Link
                  href={listingHref(locationId)}
                  className={buttonVariants({ variant: "secondary" })}
                >
                  Back to listing
                </Link>
              </>
            }
          />

          {area.model === "google_direct" ? (
            <CapabilityBanner
              tone="info"
              title="Changes here go to Google straight away"
              description="There is no review step for this area: confirming a change publishes it."
            />
          ) : null}

          {/* The scrolling pane: PageFrame width="workspace" hides overflow on
              <main>, so the editor scrolls here and its footer pins to the
              pane's bottom edge. */}
          <div
            className={`flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto ${PANE_BLEED}`}
          >
            {children}
          </div>
        </PageFrame>
      )}
    </ListingGate>
  )
}

/** A short note for an area's card or header, from its model. */
export { AreaFrame, modelNote }
