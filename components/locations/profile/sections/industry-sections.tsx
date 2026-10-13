"use client"

import { SectionPanel } from "@/components/locations/section-panel"
import { TabError } from "@/components/locations/tab-states"
import type { IndustryState } from "@/lib/api/location-industry"
import { lodgingRecord } from "@/lib/locations/forms/lodging-draft"
import { tabGateReasons, type LocationCapabilities } from "@/lib/locations/gating"
import { useIndustry } from "@/lib/queries/use-location-industry"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { CompleteLodgingSection } from "./complete-lodging-section"

/** The lodging block's jump target in the profile's section navigation. */
export const INDUSTRY_LODGING_ID = "section-lodging"

export function IndustrySections({ locationId, enabled = true }: { locationId: string; enabled?: boolean }) {
  const caps = useLocationCapabilities(locationId)
  if (!caps.data?.canEditCanonical) return null
  return <IndustryResource locationId={locationId} caps={caps.data} enabled={enabled} />
}

function IndustryResource({ locationId, caps, enabled }: {
  locationId: string; caps: LocationCapabilities; enabled: boolean
}) {
  const query = useIndustry(locationId, { enabled })
  if (!enabled || query.isPending) return null
  if (query.isError) return <TabError error={query.error} onRetry={() => void query.refetch()} />
  const { disabled, editReason, publishReason } = tabGateReasons(caps, "industry", query.data.writesEnabled ?? true)
  if (query.data.lodging.data == null && !query.data.lodging.error) return null
  return <IndustryEditor locationId={locationId} state={query.data} disabled={disabled} publishReason={editReason ?? publishReason} />
}

function IndustryEditor({ locationId, state, disabled, publishReason }: {
  locationId: string; state: IndustryState; disabled: boolean; publishReason: string | null
}) {
  return <div className="flex min-w-0 flex-col gap-(--np-gap-section)">
    {state.lodging.data != null || state.lodging.error ? <section id={INDUSTRY_LODGING_ID} aria-labelledby={`${INDUSTRY_LODGING_ID}-heading`} className="flex min-w-0 scroll-mt-18 flex-col gap-3 desk:scroll-mt-4">
      <h3 id={`${INDUSTRY_LODGING_ID}-heading`} tabIndex={-1} className="text-title font-semibold text-ink outline-none">Lodging</h3>
      <SectionPanel title="Lodging" result={state.lodging}>{(data) => <CompleteLodgingSection
        locationId={locationId} loaded={lodgingRecord(data)} suggested={state.lodgingUpdated.data}
        suggestedError={state.lodgingUpdated.error} disabled={disabled} publishReason={publishReason}
        googleHash={state.lodgingHash} savedReviews={state.lodgingChangeSets ?? []}
      />}</SectionPanel>
    </section> : null}
  </div>
}
