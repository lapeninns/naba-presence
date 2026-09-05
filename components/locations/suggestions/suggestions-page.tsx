"use client"

import { CircleCheckIcon } from "lucide-react"

import { SuggestionList } from "@/components/locations/suggestions/suggestion-list"
import { EditorFrame } from "@/components/editors/editor-frame"
import { LocationTab } from "@/components/locations/location-tab"
import { Empty } from "@/components/ui/empty"
import { useImportReview } from "@/lib/queries/use-import-review"
import { useProfile } from "@/lib/queries/use-location-profile"

/**
 * Everything Google has changed that NabaPresence has not accepted yet.
 *
 * The decisions are per field and per menu item, and they belong together: an
 * operator working through them is doing one job, not visiting two editors to
 * find the queue hiding above each one's fields.
 */
export function SuggestionsTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab locationId={locationId} loadingLabel="suggested updates" useResource={useProfile}>
      {({ data: profile, editReason }) => (
        <SuggestionsView
          locationId={locationId}
          canonicalRevision={profile.canonicalResource.revision}
          editReason={editReason}
        />
      )}
    </LocationTab>
  )
}

function SuggestionsView({
  locationId,
  canonicalRevision,
  editReason,
}: {
  locationId: string
  canonicalRevision: string
  editReason: string | null
}) {
  const profileReview = useImportReview(locationId, "profile")
  const menuReview = useImportReview(locationId, "food_menus")
  const pending =
    (profileReview.data?.proposals.filter((p) => p.status === "pending")
      .length ?? 0) +
    (menuReview.data?.proposals.filter((p) => p.status === "pending").length ??
      0)

  return (
    <EditorFrame
      title="Suggested updates"
      description="Changes Google has made to this listing that NabaPresence has not taken yet. Accepting one updates the NabaPresence copy; dismissing one keeps what you have."
      statusLabel={pending === 0 ? "Nothing waiting" : undefined}
      tone="healthy"
      gateReason={editReason}
    >
      {pending === 0 &&
      !profileReview.isPending &&
      !menuReview.isPending ? (
        <Empty
          icon={<CircleCheckIcon />}
          title="Nothing to review"
          description="When Google changes this listing behind your back, the change shows up here for you to accept or dismiss."
        />
      ) : null}

      <SuggestionList
        locationId={locationId}
        resourceType="profile"
        canonicalRevision={canonicalRevision}
        editDisabledReason={editReason}
      />
      <SuggestionList
        locationId={locationId}
        resourceType="food_menus"
        canonicalRevision={canonicalRevision}
        editDisabledReason={editReason}
      />
    </EditorFrame>
  )
}
