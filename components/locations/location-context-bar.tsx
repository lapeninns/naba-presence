import Link from "next/link"

// Names the business the flat pages are acting on, so "Photos" is never
// ambiguous about whose photos. Renders NO heading — the page's PageHeader
// owns the single <h1>, and adding one here would break heading order.
//
// The "All locations" escape hatch appears only for orgs that actually have
// more than one location. The flat IA deliberately resolves a single primary
// rather than offering a picker, so without this a multi-location tenant would
// see one business and have no in-app route to the others.
export function LocationContextBar({
  locationName,
  locationCount,
}: {
  locationName: string
  locationCount: number
}) {
  return (
    <div
      data-slot="location-context-bar"
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <p className="text-ui text-ink-muted">{locationName}</p>
      {locationCount > 1 ? (
        <Link
          href="/locations"
          className="inline-flex min-h-6 items-center rounded-(--np-radius-tag) text-ui font-medium text-accent-ink underline-offset-4 focus-halo hover:underline"
        >
          All locations ({locationCount})
        </Link>
      ) : null}
    </div>
  )
}
