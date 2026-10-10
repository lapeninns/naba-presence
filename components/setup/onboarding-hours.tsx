"use client"

import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GOOGLE_DAYS } from "@/lib/domain/hours-vocabulary"
import {
  googleOnboardingRegularHoursSchema, googleOnboardingSpecialHoursSchema,
  googleHoursPeriodLabel, googleSpecialHoursPeriodLabel,
  type GoogleOnboardingRegularHours, type GoogleOnboardingSpecialHours,
} from "@/lib/domain/google-onboarding-hours"

type Props = {
  readonly regular: GoogleOnboardingRegularHours | undefined
  readonly special: GoogleOnboardingSpecialHours | undefined
  readonly onRegularChange: (value: GoogleOnboardingRegularHours | undefined) => void
  readonly onSpecialChange: (value: GoogleOnboardingSpecialHours | undefined) => void
  readonly onEntryChange: (dirty: boolean) => void
}

export function timeValue(raw: string) {
  if (!/^(?:[01]\d|2[0-4]):[0-5]\d$/.test(raw)) return undefined
  const [hours, minutes] = raw.split(":").map(Number)
  return { hours, minutes }
}
function dateValue(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined
  const [year, month, day] = raw.split("-").map(Number)
  return { year, month, day }
}

export function OnboardingHours(props: Props) {
  const [regularDirty, setRegularDirty] = useState(false)
  const [specialDirty, setSpecialDirty] = useState(false)
  const { onEntryChange } = props
  useEffect(() => {
    onEntryChange(regularDirty || specialDirty)
    return () => onEntryChange(false)
  }, [regularDirty, specialDirty, onEntryChange])
  return <div role="group" aria-label="Creation opening hours" className="flex min-w-0 flex-col gap-5 sm:col-span-2">
    <div className="space-y-1"><h4 className="text-ui font-semibold">Opening hours</h4><p className="text-caption text-ink-muted">Propose local business times using the 24-hour clock. Google validates these hours before creation approval. No hours are assumed for days you do not supply.</p></div>
    <RegularEntry value={props.regular} onChange={props.onRegularChange} onEntryChange={setRegularDirty} specialPresent={Boolean(props.special)} />
    <SpecialEntry value={props.special} onChange={props.onSpecialChange} onEntryChange={setSpecialDirty} regularPresent={Boolean(props.regular)} />
  </div>
}

export function DayField({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  const id = useId()
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select value={value || "choose"} onValueChange={(next) => { if (typeof next === "string") onChange(next === "choose" ? "" : next) }}>
    <SelectTrigger id={id}><SelectValue>{value ? value.charAt(0) + value.slice(1).toLowerCase() : "Choose day"}</SelectValue></SelectTrigger>
    <SelectContent><SelectItem value="choose">Choose day</SelectItem>{GOOGLE_DAYS.map((day) => <SelectItem key={day} value={day}>{day.charAt(0) + day.slice(1).toLowerCase()}</SelectItem>)}</SelectContent>
  </Select></Field>
}
export function TimeField({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  const id = useId()
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Input id={id} value={value} maxLength={5} placeholder="HH:MM" onChange={(event) => onChange(event.target.value)} /><FieldDescription>00:00 to 24:00. 24:00 is midnight at the end of the selected day.</FieldDescription></Field>
}

function RegularEntry({ value, onChange, onEntryChange, specialPresent }: {
  readonly value: Props["regular"]; readonly onChange: Props["onRegularChange"]; readonly onEntryChange: Props["onEntryChange"]; readonly specialPresent: boolean
}) {
  const [openDay, setOpenDay] = useState("")
  const [closeDay, setCloseDay] = useState("")
  const [opens, setOpens] = useState("")
  const [closes, setCloses] = useState("")
  const [error, setError] = useState<string>()
  const dirty = Boolean(openDay || closeDay || opens || closes)
  useEffect(() => { onEntryChange(dirty); return () => onEntryChange(false) }, [dirty, onEntryChange])
  const reset = () => { setOpenDay(""); setCloseDay(""); setOpens(""); setCloses(""); setError(undefined) }
  const add = () => {
    const parsed = googleOnboardingRegularHoursSchema.safeParse({ periods: [...(value?.periods ?? []), { openDay, closeDay, openTime: timeValue(opens), closeTime: timeValue(closes) }] })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the opening period."); return }
    onChange(parsed.data); reset()
  }
  return <div role="group" aria-label="Proposed regular hours" className="flex min-w-0 flex-col gap-3">
    <h5 className="text-ui font-medium">Regular hours</h5>
    {!value && <p className="text-caption text-ink-muted">Regular hours are not supplied in this proposal.</p>}
    {value?.periods.map((period, index) => <div key={googleHoursPeriodLabel(period)} className="flex min-w-0 flex-col items-start gap-2 rounded-(--np-radius-control) border border-line p-3 sm:flex-row sm:justify-between">
      <p className="text-ui break-words">{googleHoursPeriodLabel(period)}</p>
      <Button type="button" variant="outline" disabled={value.periods.length === 1 && specialPresent} aria-label={`Remove regular period ${index + 1}`} onClick={() => {
        const periods = value.periods.filter((_, current) => current !== index)
        onChange(periods.length ? { periods } : undefined)
      }}>Remove</Button>
    </div>)}
    {specialPresent && <p className="text-caption text-ink-muted">Remove special dates before removing the final regular period.</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <DayField label="Regular opening day" value={openDay} onChange={setOpenDay} />
      <TimeField label="Regular opening time" value={opens} onChange={setOpens} />
      <DayField label="Regular closing day" value={closeDay} onChange={setCloseDay} />
      <TimeField label="Regular closing time" value={closes} onChange={setCloses} />
    </div>
    <Field error={error}><FieldError /></Field>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!openDay || !closeDay || !opens || !closes} onClick={add}>Add regular period</Button>{dirty && <Button type="button" variant="ghost" onClick={reset}>Discard regular entry</Button>}</div>
    {dirty && <p role="status" className="text-caption text-ink-muted">Add or discard this regular entry before saving or searching.</p>}
  </div>
}

function SpecialEntry({ value, onChange, onEntryChange, regularPresent }: {
  readonly value: Props["special"]; readonly onChange: Props["onSpecialChange"]; readonly onEntryChange: Props["onEntryChange"]; readonly regularPresent: boolean
}) {
  const prefix = useId()
  const [date, setDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [kind, setKind] = useState<"" | "closed" | "open">("")
  const [opens, setOpens] = useState("")
  const [closes, setCloses] = useState("")
  const [error, setError] = useState<string>()
  const dirty = Boolean(date || endDate || kind || opens || closes)
  useEffect(() => { onEntryChange(dirty); return () => onEntryChange(false) }, [dirty, onEntryChange])
  const reset = () => { setDate(""); setEndDate(""); setKind(""); setOpens(""); setCloses(""); setError(undefined) }
  const add = () => {
    const period = kind === "closed" ? { startDate: dateValue(date), closed: true } : { startDate: dateValue(date), ...(endDate ? { endDate: dateValue(endDate) } : {}), openTime: timeValue(opens), closeTime: timeValue(closes) }
    const parsed = googleOnboardingSpecialHoursSchema.safeParse({ specialHourPeriods: [...(value?.specialHourPeriods ?? []), period] })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the special date."); return }
    onChange(parsed.data); reset()
  }
  return <div role="group" aria-label="Proposed special hours" className="flex min-w-0 flex-col gap-3">
    <h5 className="text-ui font-medium">Special dates</h5>
    {!value && <p className="text-caption text-ink-muted">No special dates in this proposal.</p>}
    {value?.specialHourPeriods.map((period, index) => <div key={googleSpecialHoursPeriodLabel(period)} className="flex min-w-0 flex-col items-start gap-2 rounded-(--np-radius-control) border border-line p-3 sm:flex-row sm:justify-between">
      <p className="text-ui break-words">{googleSpecialHoursPeriodLabel(period)}</p>
      <Button type="button" variant="outline" aria-label={`Remove special period ${index + 1}`} onClick={() => {
        const specialHourPeriods = value.specialHourPeriods.filter((_, current) => current !== index)
        onChange(specialHourPeriods.length ? { specialHourPeriods } : undefined)
      }}>Remove</Button>
    </div>)}
    <Field><FieldLabel htmlFor={`${prefix}-date`}>Special start date</FieldLabel><Input id={`${prefix}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
    <Field><FieldLabel htmlFor={`${prefix}-kind`}>Special date opening</FieldLabel><Select value={kind || "choose"} onValueChange={(next) => { if (next === "choose") setKind(""); if (next === "closed" || next === "open") setKind(next) }}>
      <SelectTrigger id={`${prefix}-kind`}><SelectValue>{kind === "closed" ? "Closed all day" : kind === "open" ? "Custom hours" : "Choose opening"}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value="choose">Choose opening</SelectItem><SelectItem value="closed">Closed all day</SelectItem><SelectItem value="open">Custom hours</SelectItem></SelectContent>
    </Select></Field>
    {kind === "open" && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <TimeField label="Special opening time" value={opens} onChange={setOpens} />
      <TimeField label="Special closing time" value={closes} onChange={setCloses} />
      <Field className="sm:col-span-2"><FieldLabel htmlFor={`${prefix}-end`}>Special end date (optional)</FieldLabel><Input id={`${prefix}-end`} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /><FieldDescription>Leave blank for the same date. Overnight periods must end before noon the following date and last less than 24 hours.</FieldDescription></Field>
    </div>}
    <Field error={error}><FieldError /></Field>
    {!regularPresent && <p className="text-caption text-ink-muted">Add regular hours before proposing a special date.</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!regularPresent || !date || !kind || (kind === "open" && (!opens || !closes))} onClick={add}>Add special date</Button>{dirty && <Button type="button" variant="ghost" onClick={reset}>Discard special entry</Button>}</div>
    {dirty && <p role="status" className="text-caption text-ink-muted">Add or discard this special entry before saving or searching.</p>}
  </div>
}
