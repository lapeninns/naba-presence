"use client"

import { useId } from "react"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { VerificationOptionsInput } from "@/lib/contracts/google-verification-options"

export function VerificationTextField({ label, value, onChange, disabled, hint, readOnly, maxLength }: {
  readonly label: string; readonly value: string; readonly onChange?: (value: string) => void
  readonly disabled?: boolean; readonly hint?: string; readonly readOnly?: boolean; readonly maxLength?: number
}) {
  const id = useId()
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} value={value} onChange={(event) => onChange?.(event.target.value)} disabled={disabled} readOnly={readOnly} maxLength={maxLength} autoComplete="off" />
    {hint && <FieldDescription>{hint}</FieldDescription>}
  </Field>
}

type Address = NonNullable<VerificationOptionsInput["context"]>["address"]
const optionalFields = [
  ["locality", "Town or city"], ["administrativeArea", "County or region"],
  ["postalCode", "Postcode"], ["sublocality", "Neighbourhood"],
  ["sortingCode", "Sorting code"], ["organization", "Organisation"],
] as const

export function VerificationContextFields({ value, disabled, onChange }: {
  readonly value: Address; readonly disabled: boolean; readonly onChange: (value: Address) => void
}) {
  const linesId = useId(), recipientsId = useId()
  return <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
    <legend className="mb-2 text-ui font-semibold text-ink">Private service-business address</legend>
    <p className="text-caption text-ink-muted">Use the real address Google requires to offer verification methods. This is verification context, not a public profile address change.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <VerificationTextField label="Country code" value={value.regionCode} maxLength={2} onChange={(regionCode) => onChange({ ...value, regionCode: regionCode.toUpperCase() })} hint="Two-letter country code, for example GB." />
      <VerificationTextField label="Address language" value={value.languageCode ?? ""} onChange={(languageCode) => onChange({ ...value, languageCode: languageCode || undefined })} hint="Optional language tag, for example en-GB." />
      <Field className="sm:col-span-2"><FieldLabel htmlFor={linesId}>Street address</FieldLabel>
        <Textarea id={linesId} value={value.addressLines.join("\n")} onChange={(event) => onChange({ ...value, addressLines: event.target.value.split("\n") })} autoComplete="off" />
        <FieldDescription>One address line per line; up to five.</FieldDescription>
      </Field>
      {optionalFields.map(([key, label]) => <VerificationTextField key={key} label={label} value={value[key] ?? ""} onChange={(text) => onChange({ ...value, [key]: text || undefined })} maxLength={key === "postalCode" || key === "sortingCode" ? 40 : 200} />)}
      <Field className="sm:col-span-2"><FieldLabel htmlFor={recipientsId}>Address recipients</FieldLabel>
        <Textarea id={recipientsId} value={value.recipients?.join("\n") ?? ""} onChange={(event) => onChange({ ...value, recipients: event.target.value ? event.target.value.split("\n") : undefined })} autoComplete="off" />
        <FieldDescription>Optional; one recipient per line.</FieldDescription>
      </Field>
    </div>
  </fieldset>
}
