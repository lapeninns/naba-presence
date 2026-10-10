"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"
import { SectionCard } from "../section-card"

export function AdditionalPhonesSection({ draft, setDraft, disabled, changed, error }: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  disabled: boolean
  changed: boolean
  error?: string
}) {
  const [newPhone, setNewPhone] = useState("")
  const numbers = draft.additionalPhones ?? []
  const blocked = disabled || !draft.primaryPhone.trim()
  return <SectionCard id="section-additional-phones" model="google" title="Additional phone numbers" description="Up to two additional mobile or landline numbers. Your primary number is preserved." changed={changed}>
    {!draft.primaryPhone.trim() && <p className="text-ui text-ink-muted">Publish a primary phone number before adding additional numbers.</p>}
    {numbers.map((number, index) => <div key={index} className="flex items-end gap-3">
      <Field className="min-w-0 flex-1" error={error}>
        <FieldLabel htmlFor={`profile-additional-phone-${index}`}>Additional phone {index + 1}</FieldLabel>
        <Input id={`profile-additional-phone-${index}`} type="tel" inputMode="tel" value={number} disabled={blocked} maxLength={50}
          onChange={(event) => setDraft((current) => ({ ...current, additionalPhones: (current.additionalPhones ?? []).map((phone, position) => position === index ? event.target.value : phone) }))} />
        <FieldError />
      </Field>
      <Button type="button" variant="outline" disabled={blocked} aria-label={`Remove additional phone ${index + 1}`}
        onClick={() => setDraft((current) => ({ ...current, additionalPhones: (current.additionalPhones ?? []).filter((_, position) => position !== index) }))}>Remove</Button>
    </div>)}
    {numbers.length < 2 && <Field>
        <FieldLabel htmlFor="profile-new-additional-phone">New additional phone</FieldLabel>
      <div className="flex items-center gap-3">
        <Input className="min-w-0 flex-1" id="profile-new-additional-phone" type="tel" inputMode="tel" maxLength={50} value={newPhone} disabled={blocked} onChange={(event) => setNewPhone(event.target.value)} />
      <Button type="button" variant="outline" disabled={blocked || !newPhone.trim()} onClick={() => {
        setDraft((current) => ({ ...current, additionalPhones: [...(current.additionalPhones ?? []), newPhone.trim()] }))
        setNewPhone("")
      }}>Add number</Button>
      </div>
      <FieldDescription>Include the area code. Select Add number to include it in your draft.</FieldDescription>
    </Field>}
    {numbers.length === 0 && <p className="text-ui text-ink-muted">No additional numbers in this draft.</p>}
  </SectionCard>
}
