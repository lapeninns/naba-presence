"use client"

import Link from "next/link"

import { StatusPill } from "@/components/ui/status-pill"
import { listingHref } from "@/lib/listings/areas"
import { useGoogleChanges } from "@/lib/queries/use-google-change-watch"

/**
 * "2 changed on Google": the listing's protected fields Google now shows
 * differently from ours and nobody has decided on yet, linking to the
 * suggestions tab where they are decided. Renders nothing while loading, on
 * an error, or when there is nothing to decide. Reads the database only.
 *
 * INTEGRATION(S5): S1 owns components/listings/listing-overview.tsx. Render
 * `<GoogleChangesBadge locationId={id} />` in its header next to the health
 * pill (or on the suggestions area card).
 */
export function GoogleChangesBadge({ locationId }: { locationId: string }) {
  const query = useGoogleChanges(locationId)
  const open =
    query.data?.changes.filter((change) => change.status === "open").length ?? 0
  if (open === 0) return null
  return (
    <Link
      href={listingHref(locationId, "suggestions")}
      className="focus-ring rounded-(--np-radius-pill) no-underline"
      aria-label={`${open} ${open === 1 ? "field" : "fields"} changed on Google. Review ${open === 1 ? "it" : "them"}.`}
    >
      <StatusPill tone="attention">{open} changed on Google</StatusPill>
    </Link>
  )
}
