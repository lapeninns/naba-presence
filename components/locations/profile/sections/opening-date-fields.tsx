"use client"

import type { Dispatch, SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { BusinessInformationDraft } from "@/lib/locations/google-values"

export function OpeningDateFields({ draft, setDraft, disabled, error }: {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  disabled: boolean
  error?: string
}) {
  const date = draft.openingDate
  return <fieldset id="profile-opening-date" className="space-y-3" disabled={disabled} aria-describedby={error ? "opening-date-hint opening-date-error" : "opening-date-hint"}>
    <legend className="text-ui font-medium">Opening date</legend>
    <p id="opening-date-hint" className="text-caption text-muted-foreground">When the business first opened. Enter a month and year; leave the day blank if unknown.</p>
    {date ? <>
      <div className="grid grid-cols-3 gap-3">
        {(["day", "month", "year"] as const).map((part) => <Field key={part}>
          <FieldLabel>{part === "day" ? "Day (optional)" : part === "month" ? "Month" : "Year"}</FieldLabel>
          <Input inputMode="numeric" value={part === "day" && date.day === "0" ? "" : date[part]} aria-invalid={Boolean(error)}
            onChange={(event) => { const value = event.target.value; setDraft((current) => ({ ...current, openingDate: { ...(current.openingDate ?? { year: "", month: "", day: "" }), [part]: value } })) }} />
        </Field>)}
      </div>
      <Button type="button" variant="ghost" onClick={() => setDraft((current) => ({ ...current, openingDate: null }))}>Clear opening date</Button>
    </> : <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, openingDate: { year: "", month: "", day: "" } }))}>Add opening date</Button>}
    {error && <p id="opening-date-error" role="alert" className="text-caption text-destructive">{error}</p>}
  </fieldset>
}
