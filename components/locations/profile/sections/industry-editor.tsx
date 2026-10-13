"use client"

import { SectionPanel } from "@/components/locations/section-panel"
import type { IndustryState } from "@/lib/api/location-industry"
import { lodgingRecord } from "@/lib/locations/forms/lodging-draft"
import { CompleteLodgingSection } from "./complete-lodging-section"
import { INDUSTRY_LODGING_ID } from "./industry-section-ids"

/**
 * The lodging block of the profile editor. It and everything under it (the
 * lodging draft, catalogue and suggestions) read the Google lodging discovery
 * schema, so `./industry-sections` loads this module only once a listing's
 * industry state says it has lodging details.
 */
export function IndustryEditor({ locationId, state, disabled, publishReason }: {
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
