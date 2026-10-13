"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { unsupportedAddressDetails } from "@/lib/domain/business-information"
import { asRecord, type BusinessInformationDraft } from "@/lib/locations/google-values"

export function AddressDetailsFields({ draft, setDraft, location, disabled, error }: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  location: unknown
  disabled: boolean
  error?: string
}) {
  const joined = (draft.addressRecipients ?? []).join("\n")
  const [text, setText] = useState(joined)
  const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines(text).join("\n") !== joined) setText(joined)
  const address = asRecord(location).storefrontAddress
  const blocked = (field: string) => disabled || unsupportedAddressDetails(address, [`storefrontAddress.${field}`])
  const unsupported = unsupportedAddressDetails(address, ["languageCode", "organization", "recipients", "sortingCode"].map((field) => `storefrontAddress.${field}`))
  const showSorting = Boolean(draft.addressSortingCode) || typeof asRecord(address).sortingCode === "string" || ["FR", "JM", "MW", "CI"].includes(draft.regionCode)
  return <details className="rounded-(--np-radius-control) border border-line p-4" id="profile-address-details">
    {/* A 44px touch row on a phone (its 20px line alone is under the touch
        floor); padding, not flex, so the disclosure marker stays. */}
    <summary className="cursor-pointer py-3 text-ui font-medium desk:py-0">Additional address details</summary>
    <div className="mt-4 flex flex-col gap-4">
      {unsupported && <p role="status" className="text-ui text-ink-muted">Some address details cannot be edited safely here. <a href="https://business.google.com/locations" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Manage address details in Google</a>, then refresh.</p>}
      <Field><FieldLabel htmlFor="profile-address-organization">Address organisation (optional)</FieldLabel>
        <Input id="profile-address-organization" value={draft.addressOrganization ?? ""} maxLength={200} disabled={blocked("organization")} onChange={(event) => setDraft((current) => ({ ...current, addressOrganization: event.target.value }))} />
        <FieldDescription>Organisation named in the postal address. This is separate from the business name.</FieldDescription>
      </Field>
      <Field><FieldLabel htmlFor="profile-address-recipients">Address recipients (optional)</FieldLabel>
        <Textarea id="profile-address-recipients" value={text} rows={3} disabled={blocked("recipients")} onChange={(event) => { setText(event.target.value); setDraft((current) => ({ ...current, addressRecipients: lines(event.target.value) })) }} />
        <FieldDescription>One postal recipient or care-of line per line. Leave blank to remove existing recipients.</FieldDescription>
      </Field>
      {showSorting && <Field><FieldLabel htmlFor="profile-address-sorting">Postal sorting code (optional)</FieldLabel>
        <Input id="profile-address-sorting" value={draft.addressSortingCode ?? ""} maxLength={100} disabled={blocked("sortingCode")}
          {...inputHints.identifier} autoCapitalize="characters" onChange={(event) => setDraft((current) => ({ ...current, addressSortingCode: event.target.value }))} />
        <FieldDescription>A country-specific code, such as CEDEX in France. It is not a UK postcode. Existing values are shown so they can be preserved or explicitly cleared.</FieldDescription>
      </Field>}
      {/* The language tag is a code: it follows the human address details. */}
      <Field error={error}>
        <FieldLabel htmlFor="profile-address-language">Address language (optional)</FieldLabel>
        <Input id="profile-address-language" value={draft.addressLanguageCode ?? ""} maxLength={35} disabled={blocked("languageCode")}
          {...inputHints.identifier} onChange={(event) => setDraft((current) => ({ ...current, addressLanguageCode: event.target.value }))} />
        <FieldDescription>Use a language tag such as en or cy only when known. Leave it blank if unknown; this does not change the profile language.</FieldDescription>
        <FieldError />
      </Field>
    </div>
  </details>
}
