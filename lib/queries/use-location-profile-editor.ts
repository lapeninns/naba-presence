"use client"

import type { ResourceQuery } from "@/components/locations/location-tab"
import type { ProfileState } from "@/lib/api/location-profile"
import type { BusinessInformationState } from "@/lib/api/location-business-information"
import { useBusinessInformation } from "@/lib/queries/use-location-business-information"
import { useProfile } from "@/lib/queries/use-location-profile"

export type ProfileEditorState = {
  /** The NabaPresence copy: name, description, phone, website. */
  profile: ProfileState
  /**
   * What Google holds: categories, address, open status, attributes. Null
   * until it arrives, and null for good if Google can't be reached.
   */
  business: BusinessInformationState | null
  businessPending: boolean
  businessError: boolean
}

/**
 * Both halves of a location's listing, as one resource.
 *
 * They were two tabs — "Profile" and "Business info" — editing the same
 * listing with two save models and two publish buttons, and each linked to the
 * other in a paragraph explaining which fields lived where. Nobody should have
 * to hold that map in their head, so the editor takes both and shows the
 * listing once.
 */
export function useProfileEditor(
  locationId: string
): ResourceQuery<ProfileEditorState> {
  const profile = useProfile(locationId)
  // Held back until the NabaPresence copy is in: see the note on the hook.
  const business = useBusinessInformation(locationId, {
    enabled: profile.isSuccess,
  })

  return {
    data: profile.data
      ? {
          profile: profile.data,
          business: business.data ?? null,
          businessPending: business.isPending || business.isFetching,
          businessError: business.isError,
        }
      : undefined,
    // The editor opens as soon as the NabaPresence copy is here. Google's side
    // fans out across several of its APIs and is rate-limited per connection,
    // so waiting for both would leave the page blank for seconds — and would
    // hide the name and description entirely whenever Google is unreachable,
    // which is exactly when someone needs to check what NabaPresence holds.
    isPending: profile.isPending,
    isError: profile.isError,
    error: profile.error,
    refetch: () => {
      void profile.refetch()
      void business.refetch()
    },
  }
}
