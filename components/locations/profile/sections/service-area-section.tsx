"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { googleServiceAreaSchema } from "@/lib/domain/google-service-area"
import { asRecord, type BusinessInformationDraft } from "@/lib/locations/google-values"
import { SectionCard } from "../section-card"

export function ServiceAreaSection({ draft, setDraft, location, disabled, changed, error }: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  location: unknown
  disabled: boolean
  changed: boolean
  error?: string
}) {
  const [name, setName] = useState("")
  const [placeId, setPlaceId] = useState("")
  const [entryError, setEntryError] = useState<string | undefined>()
  const baseline = asRecord(location)
  const unsupported = baseline.serviceArea !== undefined && !googleServiceAreaSchema.safeParse(baseline.serviceArea).success
  const area = draft.serviceArea
  const places = area?.places?.placeInfos ?? []
  const blocked = disabled || unsupported
  const existingCountry = asRecord(baseline.serviceArea).regionCode
  return <SectionCard id="section-service-area" model="google" title="Service area" description="Choose where you meet customers and the areas you serve." changed={changed}>
    {unsupported && <p role="status" className="text-ui text-ink-muted">Google returned service-area data this editor cannot preserve. <a className="underline underline-offset-4" href="https://business.google.com/locations" target="_blank" rel="noopener noreferrer">Manage service areas in Google</a>, then refresh this profile.</p>}
    <Field error={error}>
      <FieldLabel htmlFor="profile-service-area">Where do you serve customers?</FieldLabel>
      <Select value={area?.businessType ?? "unchanged"} disabled={blocked} onValueChange={(value) => {
        if (value !== "CUSTOMER_LOCATION_ONLY" && value !== "CUSTOMER_AND_BUSINESS_LOCATION") return
        setDraft((current) => ({ ...current, serviceArea: { ...current.serviceArea, businessType: value }, clearStorefrontAddress: value === "CUSTOMER_LOCATION_ONLY" ? current.clearStorefrontAddress : false }))
      }}>
        <SelectTrigger id="profile-service-area"><SelectValue>{area?.businessType === "CUSTOMER_LOCATION_ONLY" ? "Customer locations only" : area ? "Business and customer locations" : "No service area configured"}</SelectValue></SelectTrigger>
        <SelectContent>
          {!area && <SelectItem value="unchanged">No service area configured</SelectItem>}
          <SelectItem value="CUSTOMER_AND_BUSINESS_LOCATION">Business and customer locations</SelectItem>
          <SelectItem value="CUSTOMER_LOCATION_ONLY">Customer locations only</SelectItem>
        </SelectContent>
      </Select>
      <FieldError />
    </Field>
    {area && <>
      <Field>
        <FieldLabel htmlFor="profile-service-country">Service-area country code</FieldLabel>
        <Input id="profile-service-country" value={area.regionCode ?? ""} maxLength={2} disabled={blocked || typeof existingCountry === "string"}
          onChange={(event) => setDraft((current) => current.serviceArea ? { ...current, serviceArea: { ...current.serviceArea, regionCode: event.target.value.toUpperCase() } } : current)} />
        <FieldDescription>Two-letter country code, such as GB. Google requires this for customer-only businesses and does not allow an existing country to change.</FieldDescription>
      </Field>
      {area.businessType === "CUSTOMER_LOCATION_ONLY" && (asRecord(baseline.serviceArea).businessType !== "CUSTOMER_LOCATION_ONLY" || Object.keys(asRecord(baseline.storefrontAddress)).length > 0) && <Field>
        <div className="flex items-start gap-3">
          <Checkbox id="profile-clear-storefront" checked={Boolean(draft.clearStorefrontAddress)} disabled={blocked}
            onCheckedChange={(checked) => setDraft((current) => ({ ...current, clearStorefrontAddress: checked === true }))} />
          <FieldLabel htmlFor="profile-clear-storefront">Remove the storefront address from this profile</FieldLabel>
        </div>
        <FieldDescription>Required for customer-only businesses. The address removal will appear in your review before publishing.</FieldDescription>
      </Field>}
      <div className="flex flex-col gap-3">
        {places.map((place, index) => <div key={place.placeId} className="flex items-start justify-between gap-3 rounded-(--np-radius-control) border border-line p-3">
          <div className="min-w-0"><p className="text-ui font-medium break-words">{place.placeName}</p><p className="text-caption font-mono text-ink-muted break-all">{place.placeId}</p></div>
          <Button type="button" variant="outline" disabled={blocked} aria-label={`Remove service area ${place.placeName}`} onClick={() => setDraft((current) => current.serviceArea ? { ...current, serviceArea: { ...current.serviceArea, places: { placeInfos: (current.serviceArea.places?.placeInfos ?? []).filter((_, position) => position !== index) } } } : current)}>Remove</Button>
        </div>)}
        <p className="text-ui text-ink-muted">{places.length} of 20 service areas in this draft.</p>
      </div>
      {places.length < 20 && <div className="flex flex-col gap-3">
        <Field><FieldLabel htmlFor="profile-area-name">New area name</FieldLabel><Input id="profile-area-name" value={name} maxLength={255} disabled={blocked} onChange={(event) => { setName(event.target.value); setEntryError(undefined) }} /></Field>
        <Field error={entryError}><FieldLabel htmlFor="profile-area-id">New area place ID</FieldLabel><Input id="profile-area-id" value={placeId} maxLength={255} disabled={blocked} onChange={(event) => { setPlaceId(event.target.value); setEntryError(undefined) }} /><FieldError />
          <FieldDescription>Use an existing Google place ID. These checks validate format only; Google validates the proposed areas before publication.</FieldDescription>
        </Field>
        <Button className="self-start" type="button" variant="outline" disabled={blocked || !name.trim() || !placeId.trim()} onClick={() => {
          const next = googleServiceAreaSchema.safeParse({ ...area, places: { placeInfos: [...places, { placeName: name, placeId }] } })
          if (!next.success) { setEntryError(next.error.issues[0]?.message ?? "Check the area name and place ID."); return }
          setDraft((current) => ({ ...current, serviceArea: next.data }))
          setName(""); setPlaceId(""); setEntryError(undefined)
        }}>Add service area</Button>
      </div>}
    </>}
  </SectionCard>
}
