"use client"

import {
  BadgeCheckIcon,
  CalendarCheckIcon,
  ChevronRightIcon,
  ClockIcon,
  EyeIcon,
  ImageIcon,
  MegaphoneIcon,
  PencilIcon,
  SparklesIcon,
  StoreIcon,
  UsersIcon,
  UtensilsIcon,
  type LucideIcon,
  QrCodeIcon, // S2
} from "lucide-react"

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
  type ListingAreaKey,
} from "@/lib/listings/areas"
import {
  resourceDisabledReason,
  type LocationCapabilities,
} from "@/lib/locations/gating"
import { cn } from "@/lib/utils"
import { useNow } from "@/lib/time/server-now"

/**
 * The areas answer to their own width (`@container/areas`): under 36rem
 * (a phone) each area is a settings-style row, one per line; from 36rem a
 * card grid of two columns, three from 56rem.
 */
const GRID =
  "grid gap-2 @xl/areas:grid-cols-2 @xl/areas:gap-3 @4xl/areas:grid-cols-3"

/** The neutral leading mark of each area (an icon, never a status). */
const AREA_ICON: Record<ListingAreaKey, LucideIcon> = {
  profile: StoreIcon,
  hours: ClockIcon,
  booking: CalendarCheckIcon,
  photos: ImageIcon,
  posts: MegaphoneIcon,
  menu: UtensilsIcon,
  people: UsersIcon,
  verification: BadgeCheckIcon,
  suggestions: SparklesIcon,
  reviewLink: QrCodeIcon, // S2
}

function AreaIcon({ area }: { area: ListingAreaKey }) {
  const Icon = AREA_ICON[area]
  return (
    <span
      aria-hidden
      className="grid size-7 shrink-0 place-items-center rounded-full bg-fill text-ink-secondary"
    >
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  )
}

function AreaCardSkeleton() {
  return (
    <div className={cardClassName({ className: "flex items-start gap-3 p-4" })}>
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-5 w-24 @xl/areas:hidden" />
        <Skeleton className="hidden h-8 w-20 self-end @xl/areas:block" />
      </div>
    </div>
  )
}

/**
 * One area (reference `.area-card`), drawn two ways from one DOM:
 *
 *   phone, a settings-style row     desk, a card
 *   (o) Label .............. ›      (o) Label ........ [pill]
 *       description                     description
 *       [pill]                      line ............ [Check]
 *       line
 *
 * The parts are flex items placed by `order`, so the one link and the one
 * status line move between the two layouts without being rendered twice.
 * A blocked area is drawn sunken and says why instead of offering the way
 * in.
 *
 * An interactive `Card` (listings-content-18): the way in is the card's
 * `CardLink`, whose hit area is the whole card, so a thumb can tap anywhere
 * on it while the card draws the hover, pressed and focus states. Its name
 * keeps the verb ("Check Opening hours"); on a desk the verb is drawn as a
 * small button, on a phone as the row's chevron.
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
        "gap-0 px-(--card-spacing) py-3 @xl/areas:py-(--card-spacing)",
        emphasis && "border-warning-solid"
      )}
    >
      <div className="flex flex-1 flex-wrap items-start gap-x-3 gap-y-1.5 @xl/areas:content-between @xl/areas:gap-y-0">
        <AreaIcon area={area.key} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-body font-semibold text-ink @xl/areas:text-title">
            {area.label}
          </h3>
          <p className="text-caption text-ink-muted">{area.description}</p>
        </div>
        <div className="order-2 flex basis-full ps-10 @xl/areas:order-none @xl/areas:basis-auto @xl/areas:ps-0">
          {pill}
        </div>
        {action ? (
          <div className="order-1 flex shrink-0 self-center @xl/areas:order-6 @xl/areas:mt-2.5 @xl/areas:self-end">
            {action}
          </div>
        ) : null}
        <span
          aria-hidden
          className="hidden h-0 basis-full @xl/areas:order-4 @xl/areas:block"
        />
        <p
          className={cn(
            "order-3 min-w-0 basis-full ps-10 text-caption break-words",
            "@xl/areas:order-5 @xl/areas:mt-2.5 @xl/areas:grow @xl/areas:basis-0 @xl/areas:self-end @xl/areas:ps-0 @xl/areas:text-ui",
            blocked ? "text-ink-muted" : "text-ink-secondary"
          )}
        >
          {line}
        </p>
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
      <div className="@container/areas">
        <div aria-busy="true" className={GRID}>
          {areas.map((area) => (
            <AreaCardSkeleton key={area.key} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="@container/areas">
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
          // A role that can't change canonical data opens an area with
          // changes (or Suggested updates) only to look: the pill still says
          // what is waiting, the verb doesn't promise a review it can't do.
          const viewOnlyRole =
            caps?.canEditCanonical === false &&
            (readOnly || area.key === "suggestions")
          const verb = viewOnlyRole
            ? "View"
            : needsReview
              ? "Review"
              : readOnly ||
                  (area.key === "menu" && summary?.menu.eligible === false)
                ? "View"
                : !summary ||
                    (synced && comparisonCheck(synced, now) !== "checked") ||
                    [
                      "photos",
                      "posts",
                      "people",
                      "verification",
                      "reviewLink",
                    ].includes(area.key)
                  ? // "Check" belongs to the action that asks Google (DSK-15).
                    "Open"
                  : "Edit"
          const action = (
            // The card's link. `static` so the stretched hit area reaches the
            // card's edges (no button's touch overhang can shrink it to a
            // band: the button look is drawn by a span inside). A ShellLink,
            // so it prefetches on intent, not on view. Focus draws on the
            // whole card, inset.
            <ShellLink
              data-slot="card-link"
              href={listingHref(locationId, area.segment)}
              className={cn(
                cardLinkClassName,
                "static flex items-center after:inset-0 hover-fine:hover:no-underline desk:after:block"
              )}
              aria-label={`${verb} ${area.label}`}
            >
              <span
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" }),
                  "hidden @xl/areas:inline-flex"
                )}
              >
                {verb === "Edit" ? (
                  <PencilIcon aria-hidden strokeWidth={1.75} />
                ) : verb === "View" ? (
                  <EyeIcon aria-hidden strokeWidth={1.75} />
                ) : null}
                {verb}
              </span>
              <ChevronRightIcon
                aria-hidden
                strokeWidth={1.75}
                className="size-5 text-ink-faint @xl/areas:hidden"
              />
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
                      Owner photos on Google, including uploads outside this
                      app.
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
    </div>
  )
}

export { AreaCards }
