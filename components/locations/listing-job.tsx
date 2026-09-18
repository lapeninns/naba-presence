"use client"

import { useEffect } from "react"

import { BookingTab } from "@/components/locations/booking-tab"
import { HoursTab } from "@/components/locations/hours-tab"
import { ProfileTab } from "@/components/locations/profile/profile-editor"
import { SuggestionsTab } from "@/components/locations/suggestions/suggestions-page"
import {
  LISTING_ANCHORS,
  type ListingAnchor,
} from "@/lib/locations/location-ia"

const SECTIONS: Record<
  ListingAnchor,
  React.ComponentType<{ locationId: string }>
> = {
  profile: ProfileTab,
  hours: HoursTab,
  booking: BookingTab,
  suggestions: SuggestionsTab,
}

/**
 * The four listing editors as one scroll.
 *
 * Each editor's footer is `sticky` inside its own section, so only the
 * section on screen pins its footer; the next one takes over as it scrolls
 * in. The anchor ids match the row under the job switcher, and each carries
 * a scroll margin so a jump lands the heading clear of the pane's top edge.
 * Every section is its own landmark region so the four are navigable by
 * assistive tech without a heading level above the editors' own h2s.
 */
function ListingJob({ locationId }: { locationId: string }) {
  // The workspace renders after the directory resolves, so the sections are
  // not in the server HTML and the browser's own fragment scroll finds
  // nothing on load. Do it once the anchors exist: a retired `/hours`
  // bookmark redirects to `#hours` and should land there.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!LISTING_ANCHORS.some((anchor) => anchor.id === id)) return
    document.getElementById(id)?.scrollIntoView({ block: "start" })
  }, [locationId])

  return (
    <div data-slot="listing-job" className="flex flex-col gap-10">
      {LISTING_ANCHORS.map((anchor) => {
        const Section = SECTIONS[anchor.id]
        return (
          <div
            key={anchor.id}
            id={anchor.id}
            role="region"
            aria-label={anchor.label}
            className="flex scroll-mt-4 flex-col"
          >
            <Section locationId={locationId} />
          </div>
        )
      })}
    </div>
  )
}

export { ListingJob }
