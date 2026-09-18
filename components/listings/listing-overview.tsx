"use client"

import { UploadIcon } from "lucide-react"
import Link from "next/link"

import { PageFrame, PageHeader } from "@/components/app-shell/page-frame"
import { ActivityDrawer } from "@/components/editors/activity-drawer"
import { AreaCards } from "@/components/listings/area-cards"
import { HealthStrip } from "@/components/listings/health-strip"
import { ListingGate } from "@/components/listings/listing-gate"
import { RecentActivity } from "@/components/listings/recent-activity"
import { SiblingSwitcher } from "@/components/listings/sibling-switcher"
import { buttonVariants } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/status-pill"
import {
  listingHealth,
  listingHealthDescription,
  listingHealthLabel,
  listingHealthTone,
  unpublishedCount,
} from "@/lib/listings/health"
import { listingHref } from "@/lib/listings/areas"
import { formatAddressLine } from "@/lib/locations/address"
import { useListingSummary } from "@/lib/queries/use-listing-summary"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"

/**
 * One listing's home: what state it is in, which area needs someone, and
 * what last went to Google. Everything here paints from DB-only reads; the
 * editors are where Google is read, and they are one click away.
 */
function ListingOverview({
  locationId,
  role,
}: {
  locationId: string
  role: string | null
}) {
  const canManageConsoles = role === "owner" || role === "admin"
  const summary = useListingSummary(locationId)
  const caps = useLocationCapabilities(locationId)

  return (
    <ListingGate locationId={locationId} role={role}>
      {(entry) => {
        const health = listingHealth({
          linked: entry.linked,
          verified: entry.verified ?? summary.data?.verified,
          summary: summary.data,
        })
        const pending = summary.data ? unpublishedCount(summary.data) : 0
        const address = formatAddressLine(entry.address)
        return (
          <PageFrame width="wide">
            <PageHeader
              eyebrow={entry.clientName ?? "Not filed under a client"}
              title={entry.name}
              meta={
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={listingHealthTone(health)}>
                    {listingHealthLabel(health)}
                  </StatusPill>
                  <SiblingSwitcher current={entry} role={role} />
                </span>
              }
              description={
                <>
                  {listingHealthDescription(health)}
                  {address ? ` ${address}.` : ""}
                </>
              }
              actions={
                <>
                  <ActivityDrawer locationId={locationId} />
                  {pending > 0 ? (
                    <Link
                      href={listingHref(locationId, "changes")}
                      className={buttonVariants()}
                    >
                      <UploadIcon aria-hidden strokeWidth={1.75} />
                      Review & publish ({pending})
                    </Link>
                  ) : null}
                </>
              }
            />

            <section
              aria-labelledby="listing-health"
              className="flex flex-col gap-3"
            >
              <h2 id="listing-health" className="sr-only">
                Health
              </h2>
              <HealthStrip
                locationId={locationId}
                linked={entry.linked}
                clientId={entry.clientId ?? null}
                summary={summary.data}
                canManageConsoles={canManageConsoles}
              />
            </section>

            <section
              aria-labelledby="listing-areas"
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-0.5">
                <h2
                  id="listing-areas"
                  className="text-title font-semibold text-ink"
                >
                  Areas
                </h2>
                <p className="text-caption text-ink-muted">
                  Where each part of the listing stands. Open one to edit it.
                </p>
              </div>
              <AreaCards
                locationId={locationId}
                linked={entry.linked}
                summary={summary.data}
                caps={caps.data}
                canManageConsoles={canManageConsoles}
              />
            </section>

            <section
              aria-labelledby="listing-activity"
              className="flex flex-col gap-3"
            >
              <h2
                id="listing-activity"
                className="text-title font-semibold text-ink"
              >
                Recent activity
              </h2>
              <div className="rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
                <RecentActivity locationId={locationId} />
              </div>
            </section>
          </PageFrame>
        )
      }}
    </ListingGate>
  )
}

export { ListingOverview }
