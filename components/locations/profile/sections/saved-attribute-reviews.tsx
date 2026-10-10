"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { ReviewChangesSheet } from "@/components/editors/review-changes-sheet"
import { SectionCard } from "../section-card"
import { approveBusinessAttributes, fetchBusinessAttributeReviews, publishBusinessAttributes, type AttributeMetadata } from "@/lib/api/location-business-information"
import { businessInformationAttributeUpdateSchema } from "@/lib/contracts/location-business-information"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { attributesFromState, describeAttributeValue } from "@/lib/locations/google-values"
import { usePublishFlow } from "@/lib/editors/use-publish-flow"
import { queryKeys } from "@/lib/queries/keys"

export function SavedAttributeReviews({ locationId, enabled, metadata, publishReason }: { locationId: string; enabled: boolean; metadata: readonly AttributeMetadata[]; publishReason?: string | null }) {
  const [selected, setSelected] = useState<GbpChangeSet | null>(null)
  const saved = useQuery({ queryKey: [...queryKeys.locationBusinessInformation(locationId), "attribute_reviews"], queryFn: ({ signal }) => fetchBusinessAttributeReviews(locationId, { signal }), enabled })
  const parsed = selected ? businessInformationAttributeUpdateSchema.safeParse({ operation: "update_attributes", confirmation: "publish_business_attributes_to_google", attributes: selected.payload.attributes, attributeMask: selected.updateMask, expectedGoogleHash: selected.baselineHash, changeSetId: selected.id }) : null
  const before = attributesFromState(selected?.baseline, metadata)
  const after = attributesFromState(selected?.payload, metadata)
  const rows = (selected?.updateMask ?? []).map((name) => {
    const meta = metadata.find((item) => item.parent === name)
    return { key: name, field: meta?.displayName ?? name, before: describeAttributeValue(meta, before[name]) ?? "Unsupported value", after: describeAttributeValue(meta, after[name]) ?? "Unsupported value" }
  })
  const displayable = selected?.updateMask.every((name) => {
    const meta = metadata.find((item) => item.parent === name)
    return meta && !meta.deprecated && ["BOOL", "ENUM", "URL", "REPEATED_ENUM"].includes(meta.valueType ?? "")
  })
  const flow = usePublishFlow({
    steps: () => selected && parsed?.success ? [{ key: "attributes", label: "Publish reviewed attributes", run: async () => {
      if (!selected.approvedBy) await approveBusinessAttributes(locationId, selected.id, selected.payloadHash)
      return publishBusinessAttributes(locationId, parsed.data)
    } }] : [],
    invalidate: [queryKeys.locationBusinessInformation(locationId), queryKeys.locationActivity(locationId).slice(0, -1)],
    onSuccess: () => setSelected(null),
  })
  if (!enabled || (!saved.data?.length && !saved.isError)) return null
  return <SectionCard id="section-saved-attribute-reviews" model="google" title="Saved attribute reviews" description="Review the exact attribute changes saved by your team.">
    {saved.isError && <p role="alert" className="text-ui text-danger-ink">Saved attribute reviews could not be loaded.</p>}
    {(saved.data ?? []).map((review) => <Button key={review.id} type="button" variant="outline" onClick={() => { flow.reset(); setSelected(review) }}>Review {review.updateMask.length} saved {review.updateMask.length === 1 ? "attribute" : "attributes"}{review.approvedBy ? " (approved)" : ""}</Button>)}
    <ReviewChangesSheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} rows={rows} locationName={selected?.locationName ?? "this location"}
      onPublish={() => { void flow.publish() }} publishing={flow.isPublishing} results={flow.results} error={flow.error}
      publishDisabledReason={publishReason ?? (!parsed?.success || !displayable ? "This saved review cannot be displayed safely. Refresh metadata or create a new review." : selected?.requiresSecondApprover && !selected.approvedBy && !selected.canApprove ? "A different authorised user must approve this saved review." : null)} />
  </SectionCard>
}
