"use client"

import { SectionPanel } from "@/components/locations/section-panel"
import type { IndustryState } from "@/lib/api/location-industry"
import { lodgingRecord } from "@/lib/locations/forms/lodging-draft"
import { SectionCard } from "../section-card"
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
    {/* The profile's own section shell (same id, focusable h3 and scroll
        margin as before), without card chrome: the lodging blocks below
        draw their own rows. */}
    {state.lodging.data != null || state.lodging.error ? <SectionCard id={INDUSTRY_LODGING_ID} title="Lodging" bare>
      <SectionPanel title="Lodging" result={state.lodging}>{(data) => <CompleteLodgingSection
        locationId={locationId} loaded={lodgingRecord(data)} suggested={state.lodgingUpdated.data}
        suggestedError={state.lodgingUpdated.error} disabled={disabled} publishReason={publishReason}
        googleHash={state.lodgingHash} savedReviews={state.lodgingChangeSets ?? []}
      />}</SectionPanel>
    </SectionCard> : null}
  </div>
}
