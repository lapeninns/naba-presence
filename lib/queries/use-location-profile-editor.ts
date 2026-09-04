"use client"

import type { ResourceQuery } from "@/components/locations/location-tab"
import type { ProfileState } from "@/lib/api/location-profile"
import type { BusinessInformationState } from "@/lib/api/location-business-information"
import { useBusinessInformation } from "@/lib/queries/use-location-business-information"
import { useProfile } from "@/lib/queries/use-location-profile"

export type ProfileEditorState = {
  /** The NabaPresence copy: name, description, phone, website. */
  profile: ProfileState
  /** What Google holds: categories, address, open status, attributes. */
  business: BusinessInformationState
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
  const business = useBusinessInformation(locationId)

  return {
    data:
      profile.data && business.data
        ? { profile: profile.data, business: business.data }
        : undefined,
    isPending: profile.isPending || business.isPending,
    // A failure in either half is a failure of the editor: publishing the name
    // without knowing the categories would show a diff that isn't the truth.
    isError: profile.isError || business.isError,
    error: profile.error ?? business.error,
    refetch: () => {
      void profile.refetch()
      void business.refetch()
    },
  }
}
