"use client"

import type { Dispatch, SetStateAction } from "react"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { advertisingBaselineSupported } from "@/lib/domain/google-advertising"
import { asRecord, type BusinessInformationDraft } from "@/lib/locations/google-values"
import { SectionCard } from "../section-card"

export function AdvertisingSection({ draft, setDraft, location, disabled, changed, error }: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  location: unknown
  disabled: boolean
  changed: boolean
  error?: string
}) {
  const unsupported = !advertisingBaselineSupported(asRecord(location).adWordsLocationExtensions)
  return <SectionCard id="section-advertising" title="Google Ads phone" model="google" description="An alternate phone number for this location's Google Ads location extensions." changed={changed}>
    {unsupported && <p role="status" className="text-ui text-ink-muted">The existing advertising data cannot be edited safely here. <a href="https://business.google.com/locations" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Manage advertising details in Google</a>, then refresh.</p>}
    <Field error={error}>
      <FieldLabel htmlFor="profile-ad-phone">Google Ads phone number</FieldLabel>
      <Input id="profile-ad-phone" type="tel" maxLength={50} value={draft.adPhone ?? ""} disabled={disabled || unsupported} onChange={(event) => setDraft((current) => ({ ...current, adPhone: event.target.value }))} />
      <FieldDescription>Use the full number, including the country code. Leave blank to remove an existing override. Your public primary and additional phone numbers are separate. Review and publish to request the change.</FieldDescription>
      <FieldError />
    </Field>
  </SectionCard>
}
