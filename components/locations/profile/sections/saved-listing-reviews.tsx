"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { SavedWorkList } from "@/components/reviewed-write/saved-work-list"
import { ReviewChangesSheet } from "@/components/reviewed-write/lazy-sheets"
import { savedChangeItem } from "./saved-change-work"
import { approveBusinessInformation, fetchBusinessInformationReviews, publishBusinessInformation } from "@/lib/api/location-business-information"
import { businessInformationLocationUpdateSchema } from "@/lib/contracts/location-business-information"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { draftFromLocation } from "@/lib/locations/business-information-draft"
import { locationDiffRows } from "@/lib/locations/google-values"
import { usePublishFlow } from "@/lib/editors/use-publish-flow"
import { queryKeys } from "@/lib/queries/keys"

const supported = new Set(["storefrontAddress.languageCode", "storefrontAddress.organization", "storefrontAddress.recipients", "storefrontAddress.sortingCode", "adWordsLocationExtensions", "relationshipData.parentChain", "relationshipData.parentLocation", "relationshipData.childrenLocations", "serviceArea", "storeCode", "labels", "categories", "storefrontAddress", "storefrontAddress.addressLines", "storefrontAddress.locality", "storefrontAddress.postalCode", "storefrontAddress.regionCode", "storefrontAddress.administrativeArea", "storefrontAddress.sublocality", "openInfo.status", "openInfo.openingDate", "phoneNumbers"])

/** The jump target for saved profile reviews. */
export const SAVED_LISTING_REVIEWS_ID = "section-saved-reviews"

export function SavedListingReviews({ locationId, enabled, publishReason }: { locationId: string; enabled: boolean; publishReason?: string | null }) {
  const [selected, setSelected] = useState<GbpChangeSet | null>(null)
  const saved = useQuery({
    queryKey: [...queryKeys.locationBusinessInformation(locationId), "reviews"],
    queryFn: ({ signal }) => fetchBusinessInformationReviews(locationId, { signal }),
    enabled,
  })
  const parsed = selected ? businessInformationLocationUpdateSchema.safeParse({
    operation: "update_location", confirmation: "publish_business_information_to_google",
    payload: selected.payload, updateMask: selected.updateMask, expectedGoogleHash: selected.baselineHash, changeSetId: selected.id,
  }) : null
  const rows = parsed?.success && selected ? locationDiffRows(parsed.data.updateMask,
    draftFromLocation(selected.baseline), draftFromLocation({ ...selected.baseline, ...selected.payload }))
    .map((row) => ({ key: row.key, field: row.label, before: row.currentValue ?? "Not set", after: row.nextValue ?? "Not set" })) : []
  const flow = usePublishFlow({
    steps: () => selected && parsed?.success ? [{
      key: "listing", label: "Publish reviewed Google profile fields", run: async () => {
        if (!selected.approvedBy) await approveBusinessInformation(locationId, selected.id, selected.payloadHash)
        return publishBusinessInformation(locationId, parsed.data)
      },
    }] : [],
    invalidate: [queryKeys.locationBusinessInformation(locationId), queryKeys.locationProfile(locationId), queryKeys.locationActivity(locationId)],
    onSuccess: () => setSelected(null),
  })
  if (!enabled) return null
  const reviews = (saved.data ?? []).filter((review) => review.updateMask.length > 0 && review.updateMask.every((field) => supported.has(field)))
  if (!reviews.length && !saved.isError) return null
  return <div id={SAVED_LISTING_REVIEWS_ID} className="flex min-w-0 scroll-mt-18 flex-col desk:scroll-mt-4">
    <SavedWorkList
      id={`${SAVED_LISTING_REVIEWS_ID}-heading`}
      headingLevel="h3"
      title="Saved profile reviews"
      description="Review exact changes saved by your team. Publishing rechecks access and Google's current state."
      items={reviews.map((review) => savedChangeItem({
        change: review, recorded: false,
        operation: `Profile changes for ${review.locationName}`,
        actionLabel: `Review ${review.updateMask.length} saved profile ${review.updateMask.length === 1 ? "field" : "fields"}${review.approvedBy ? " (approved)" : ""}`,
        onOpen: () => { flow.reset(); setSelected(review) },
        disabled: false,
      }))}
      pending={saved.isPending}
      failed={saved.isError}
      loadingText="Loading saved profile reviews…"
      errorText="Saved profile reviews could not be loaded."
      emptyText="No saved profile reviews."
      reloadLabel="Reload saved profile reviews"
      reloading={saved.isFetching}
      onReload={() => void saved.refetch()}
    />
    <ReviewChangesSheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} rows={rows}
      locationName={selected?.locationName ?? "this location"} onPublish={() => { void flow.publish() }}
      publishing={flow.isPublishing} results={flow.results} error={flow.error}
      publishDisabledReason={publishReason ?? (!parsed?.success ? "This saved review cannot be displayed safely." : selected?.requiresSecondApprover && !selected.approvedBy && !selected.canApprove ? "A different authorised user must approve this saved review." : null)} />
  </div>
}
