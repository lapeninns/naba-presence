"use client"

import { EyeIcon, PencilIcon } from "lucide-react"

import { ShellLink } from "@/components/app-shell/shell-link"
import { buttonVariants } from "@/components/ui/button"
import { Card, cardClassName, cardLinkClassName } from "@/components/ui/card"
import { RelativeTime } from "@/components/ui/relative-time"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { areaState, suggestionCount } from "@/lib/listings/area-state"
import { comparisonCheck } from "@/lib/listings/health"
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
import { useNow } from "@/lib/time/server-now"

const GRID =
  "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]"

function AreaCardSkeleton() {
  return (
    <div className={cardClassName({ className: "flex flex-col gap-2.5 p-4" })}>
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="ml-auto h-8 w-20" />
    </div>
  )
}

/**
 * One area as a card (reference `.area-card`): name and what it holds, the
 * status pill at the top edge, and the one line of substance with the way in
 * at the foot. A blocked area is drawn sunken and says why instead of
 * offering the way in.
 *
 * An interactive `Card` (listings-content-18): the way in is the card's
 * `CardLink`, drawn as the small verb button, and its hit area is the whole
 * card, so a thumb can tap anywhere on it while the card draws the hover,
 * pressed and focus states. Its name keeps the verb ("Check Opening hours").
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
    <Card
      as="article"
      size="sm"
      interactive={Boolean(action)}
      surface={blocked ? "sunken" : "default"}
      data-slot="area-card"
      data-area={area.key}
      className={cn(
        "gap-2.5 px-(--card-spacing)",
        emphasis && "border-warning-solid"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
        <div className="flex min-w-0 grow basis-36 flex-col gap-0.5">
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
    </Card>
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
  const now = useNow()
  const waiting = suggestionCount(summary)
  const areas = visibleListingAreas(canManageConsoles)
    .filter((area) => (area.key === "suggestions" ? waiting > 0 : true))
    .sort((a, b) => {
      const priority = (area: ListingArea) => {
        if (area.key === "suggestions") return 0
        if (!summary) return 4
        const tone = areaState(area.key, summary, now).tone
        return tone === "at-risk"
          ? 1
          : tone === "attention"
            ? 2
            : tone === "pending"
              ? 3
              : 4
      }
      return priority(a) - priority(b)
    })

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
        const capability = caps?.resources?.[area.capability ?? ""]
        const readOnly =
          capability?.state === "readOnly" ||
          (capability?.state === "blocked" &&
            ["publish_not_allowed", "publishing_paused"].includes(
              capability.reasonCode ?? ""
            )) ||
          (!blocked &&
            area.model === "canonical" &&
            caps?.canEditCanonical === false)

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

        const synced =
          summary &&
          (area.key === "profile" ||
            area.key === "hours" ||
            area.key === "menu")
            ? summary[area.key]
            : null
        const needsReview =
          area.key === "suggestions" ||
          synced?.status === "core_dirty" ||
          synced?.status === "conflict" ||
          synced?.status === "google_dirty"
        const verb = needsReview
          ? "Review"
          : readOnly ||
              (area.key === "menu" && summary?.menu.eligible === false)
            ? "View"
            : !summary ||
                (synced && comparisonCheck(synced, now) !== "checked") ||
                ["photos", "posts", "people", "verification"].includes(area.key)
              ? "Check"
              : "Edit"
        const action = (
          // The card's link, drawn as a button. `static` undoes the button's
          // `relative` so the stretched hit area reaches the card's edges;
          // the button keeps its own focus halo and drops the link's hover
          // underline. A ShellLink, so it prefetches on intent, not on view.
          // The small button's own touch overhang (`after:inset-y-…`) would
          // win the merge and shrink the stretch to a band across the card's
          // middle, so the full-card `after:inset-0` is restated last.
          <ShellLink
            data-slot="card-link"
            href={listingHref(locationId, area.segment)}
            className={cn(
              cardLinkClassName,
              buttonVariants({ variant: "secondary", size: "sm" }),
              "static after:inset-0 hover-fine:hover:no-underline desk:after:block"
            )}
            aria-label={`${verb} ${area.label}`}
          >
            {verb === "Edit" ? (
              <PencilIcon aria-hidden strokeWidth={1.75} />
            ) : verb === "View" ? (
              <EyeIcon aria-hidden strokeWidth={1.75} />
            ) : null}
            {verb}
          </ShellLink>
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

        const state = areaState(area.key, summary, now)
        return (
          <AreaCard
            key={area.key}
            area={area}
            emphasis={area.key === "suggestions"}
            pill={<StatusPill tone={state.tone}>{state.label}</StatusPill>}
            line={
              <>
                {state.line && state.since ? (
                  <RelativeTime
                    iso={state.since}
                    prefix={`${state.line} `}
                    casing="mid-sentence"
                  />
                ) : (
                  (state.line ?? (
                    <span className="text-ink-muted">Nothing to add</span>
                  ))
                )}
                {area.key === "photos" ? (
                  <span className="mt-1 block text-caption text-ink-muted">
                    Owner photos on Google, including uploads outside this app.
                  </span>
                ) : null}
                {area.key === "posts" ? (
                  <span className="mt-1 block text-caption text-ink-muted">
                    Posts on Google, including posts created outside this app.
                  </span>
                ) : null}
              </>
            }
            action={action}
          />
        )
      })}
    </div>
  )
}

export { AreaCards }
