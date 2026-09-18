/**
 * The location workspace's three jobs.
 *
 * Ten peer tabs under four captions was a list to scan, not a choice to make.
 * An operator opening a location is doing one of three things: keeping the
 * listing right, keeping its content fresh, or deciding who may touch it.
 *
 * - **Listing** is one scroll — business profile, hours, booking links,
 *   suggested updates — because they are facts about the same listing and an
 *   operator checking one is checking them all. The row under the switcher
 *   holds in-page anchors, not routes.
 * - **Content** and **Access** keep their sub-views as real routes (photos
 *   carry URL state, the consoles gate their own GET), drawn as a segmented
 *   control under the switcher.
 *
 * Performance is not a job of the workspace: it is a report, and lives on
 * Reports scoped to the location.
 */
export type LocationJobId = "listing" | "content" | "access"

export type LocationSegment =
  "" | "photos" | "posts" | "menu" | "access" | "verification"

export type ListingAnchor = "profile" | "hours" | "booking" | "suggestions"

export type LocationView = { segment: LocationSegment; label: string }

export type LocationJob = {
  id: LocationJobId
  label: string
  /** The segment the job opens on. */
  segment: LocationSegment
  /** Owner/admin-only consoles (GET 403 for other roles). */
  consoleGated?: boolean
  /** Sub-views drawn as a segmented control under the switcher. */
  views: LocationView[]
  /** In-page anchors for a one-scroll job. */
  anchors: { id: ListingAnchor; label: string }[]
}

export const LISTING_ANCHORS: LocationJob["anchors"] = [
  { id: "profile", label: "Business profile" },
  { id: "hours", label: "Hours" },
  // Booking, ordering and reservation links: Google "place actions", which
  // are listing facts like the hours beside them.
  { id: "booking", label: "Booking" },
  // Accepting what Google changed is a different job from editing the
  // listing, so it keeps its own section at the end of the scroll.
  { id: "suggestions", label: "Suggested updates" },
]

export const LOCATION_JOBS: LocationJob[] = [
  {
    id: "listing",
    label: "Listing",
    segment: "",
    views: [],
    anchors: LISTING_ANCHORS,
  },
  {
    id: "content",
    label: "Content",
    segment: "photos",
    views: [
      { segment: "photos", label: "Photos" },
      { segment: "posts", label: "Posts" },
      { segment: "menu", label: "Menu" },
    ],
    anchors: [],
  },
  {
    id: "access",
    label: "Access",
    segment: "access",
    consoleGated: true,
    views: [
      { segment: "access", label: "People" },
      { segment: "verification", label: "Verification" },
    ],
    anchors: [],
  },
]

export function visibleLocationJobs(canManageConsoles: boolean): LocationJob[] {
  return LOCATION_JOBS.filter((job) => !job.consoleGated || canManageConsoles)
}

/** The job a workspace path segment belongs to; `""` is the Listing. */
export function jobForSegment(segment: string): LocationJob | undefined {
  return LOCATION_JOBS.find(
    (job) =>
      job.segment === segment ||
      job.views.some((view) => view.segment === segment)
  )
}

/** The path for a segment under a location, `""` being the location root. */
export function segmentHref(locationId: string, segment: string): string {
  const base = `/locations/${locationId}`
  return segment ? `${base}/${segment}` : base
}
