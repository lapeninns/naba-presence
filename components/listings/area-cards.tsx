"use client"

import { EyeIcon, PencilIcon } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { areaState, suggestionCount } from "@/lib/listings/area-state"
import {
  listingHref,
  visibleListingAreas,
  type ListingArea,
} from "@/lib/listings/areas"
import {
  resourceDisabledReason,
  type LocationCapabilities,
} from "@/lib/locations/gating"
import { cn } from "@/lib/utils"

const GRID =
  "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]"

function AreaCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-(--np-radius-card) border border-line bg-surface p-4">
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="ml-auto h-[30px] w-20" />
    </div>
  )
}

/**
 * One area as a card (reference `.area-card`): name and what it holds, the
 * status pill at the top edge, and the one line of substance with the way in
 * at the foot. A blocked area is drawn sunken and says why instead of
 * offering the way in.
 */
function AreaCard({
  area,
  pill,
  line,
  action,
  blocked = false,
  emphasis = false,
}: {
  area: ListingArea
  pill: React.ReactNode
  line: React.ReactNode
  action?: React.ReactNode
  blocked?: boolean
  emphasis?: boolean
}) {
  return (
    <article
      data-slot="area-card"
      data-area={area.key}
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-(--np-radius-card) border bg-surface p-4",
        blocked ? "border-line bg-surface-alt" : "border-line",
        emphasis && "border-warning-solid"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-0.5">
          <h3 className="text-title font-semibold text-ink">{area.label}</h3>
          <p className="text-caption text-ink-muted">{area.description}</p>
        </div>
        {pill}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3">
        <p
          className={cn(
            "min-w-0 text-ui break-words",
            blocked ? "text-ink-muted" : "text-ink-secondary"
          )}
        >
          {line}
        </p>
        {action}
      </div>
    </article>
  )
}

/**
 * One card per area of the listing: what it is, where it stands, and the
 * way in. The status comes from the DB-only summary, so the grid answers
 * "which of these needs me" without loading a single editor. An area whose
 * capability is blocked or unavailable says why instead of offering Edit.
 * Suggested updates lead the grid, outlined, while any are waiting.
 */
function AreaCards({
  locationId,
  linked,
  summary,
  summaryFailed = false,
  caps,
  canManageConsoles,
}: {
  locationId: string
  linked: boolean
  summary: ListingSummary | undefined
  /** The summary did not load: each card offers "Open to check". */
  summaryFailed?: boolean
  caps: LocationCapabilities | undefined
  canManageConsoles: boolean
}) {
  const waiting = suggestionCount(summary)
  const areas = visibleListingAreas(canManageConsoles)
    .filter((area) => (area.key === "suggestions" ? waiting > 0 : true))
    // Waiting suggestions are the one decision on this page: first.
    .sort((a, b) =>
      a.key === "suggestions" ? -1 : b.key === "suggestions" ? 1 : 0
    )

  if (!summary && !summaryFailed) {
    return (
      <div aria-busy="true" className={GRID}>
        {areas.map((area) => (
          <AreaCardSkeleton key={area.key} />
        ))}
      </div>
    )
  }

  return (
    <div className={GRID}>
      {areas.map((area) => {
        const blocked = !linked
          ? "Link this listing to Google to manage it here."
          : area.capability
            ? resourceDisabledReason(caps, area.capability, true)
            : null
        const readOnly =
          Boolean(blocked) &&
          caps?.resources?.[area.capability ?? ""]?.state === "readOnly"

        if (blocked && !readOnly) {
          return (
            <AreaCard
              key={area.key}
              area={area}
              blocked
              pill={
                <StatusPill tone="neutral" plain>
                  Unavailable
                </StatusPill>
              }
              line={blocked}
            />
          )
        }

        const verb =
          area.key === "suggestions" ? "Review" : readOnly ? "View" : "Edit"
        const action = (
          <Link
            href={listingHref(locationId, area.segment)}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
            aria-label={`${verb} ${area.label}`}
          >
            {verb === "Edit" ? (
              <PencilIcon aria-hidden strokeWidth={1.75} />
            ) : verb === "View" ? (
              <EyeIcon aria-hidden strokeWidth={1.75} />
            ) : null}
            {verb}
          </Link>
        )

        if (!summary) {
          return (
            <AreaCard
              key={area.key}
              area={area}
              pill={
                <StatusPill tone="neutral" dashed>
                  Open to check
                </StatusPill>
              }
              line={
                <span className="text-ink-muted">
                  Status unknown ·{" "}
                  {area.model === "google_direct"
                    ? "changes go to Google directly"
                    : "editable here"}
                </span>
              }
              action={action}
            />
          )
        }

        const state = areaState(area.key, summary)
        return (
          <AreaCard
            key={area.key}
            area={area}
            emphasis={area.key === "suggestions"}
            pill={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
            line={
              state.line ?? (
                <span className="text-ink-muted">Nothing to add</span>
              )
            }
            action={action}
          />
        )
      })}
    </div>
  )
}

export { AreaCards }
