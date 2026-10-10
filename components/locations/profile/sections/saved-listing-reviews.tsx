"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { SectionCard } from "../section-card"
import { approveBusinessInformation, fetchBusinessInformationReviews, publishBusinessInformation } from "@/lib/api/location-business-information"
import { businessInformationLocationUpdateSchema } from "@/lib/contracts/location-business-information"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { draftFromLocation } from "@/lib/locations/business-information-draft"
import { locationDiffRows } from "@/lib/locations/google-values"
import { usePublishFlow } from "@/lib/editors/use-publish-flow"
import { queryKeys } from "@/lib/queries/keys"

const supported = new Set(["storefrontAddress.languageCode", "storefrontAddress.organization", "storefrontAddress.recipients", "storefrontAddress.sortingCode", "adWordsLocationExtensions", "relationshipData.parentChain", "relationshipData.parentLocation", "relationshipData.childrenLocations", "serviceArea", "storeCode", "labels", "categories", "storefrontAddress", "storefrontAddress.addressLines", "storefrontAddress.locality", "storefrontAddress.postalCode", "storefrontAddress.regionCode", "storefrontAddress.administrativeArea", "storefrontAddress.sublocality", "openInfo.status", "openInfo.openingDate", "phoneNumbers"])

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
    invalidate: [queryKeys.locationBusinessInformation(locationId), queryKeys.locationProfile(locationId), queryKeys.locationActivity(locationId).slice(0, -1)],
    onSuccess: () => setSelected(null),
  })
  if (!enabled) return null
  const reviews = (saved.data ?? []).filter((review) => review.updateMask.length > 0 && review.updateMask.every((field) => supported.has(field)))
  if (!reviews.length && !saved.isError) return null
  return <SectionCard id="section-saved-reviews" model="google" title="Saved profile reviews" description="Review exact changes saved by your team. Publishing rechecks access and Google's current state.">
    {saved.isError && <p role="alert" className="text-ui text-danger-ink">Saved profile reviews could not be loaded.</p>}
    {reviews.map((review) => <Button key={review.id} type="button" variant="outline" onClick={() => { flow.reset(); setSelected(review) }}>
      Review {review.updateMask.length} saved profile {review.updateMask.length === 1 ? "field" : "fields"}{review.approvedBy ? " (approved)" : ""}
    </Button>)}
    <ReviewChangesSheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} rows={rows}
      locationName={selected?.locationName ?? "this location"} onPublish={() => { void flow.publish() }}
      publishing={flow.isPublishing} results={flow.results} error={flow.error}
      publishDisabledReason={publishReason ?? (!parsed?.success ? "This saved review cannot be displayed safely." : selected?.requiresSecondApprover && !selected.approvedBy && !selected.canApprove ? "A different authorised user must approve this saved review." : null)} />
  </SectionCard>
}
