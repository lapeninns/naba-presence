"use client"

import { useEffect, useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { SupportDetails } from "@/components/editors/support-details"
import { Field, FieldError, FieldLabel, FormError } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fetchOnboardingServices } from "@/lib/api/google-onboarding-services"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import { googleHoursPeriodLabel, googleOnboardingMoreHoursSchema, type GoogleOnboardingMoreHours } from "@/lib/domain/google-onboarding-hours"
import { describeActionError } from "@/lib/errors/action-errors"
import { requestOptions } from "@/lib/queries/request-options"
import { DayField, HoursTimeField, timeValue } from "./onboarding-hours"

export function OnboardingMoreHours({ draft, value, contextSaved, onChange, onEntryChange }: {
  readonly draft: GoogleOnboardingDraft
  readonly value: GoogleOnboardingMoreHours | undefined
  readonly contextSaved: boolean
  readonly onChange: (value: GoogleOnboardingMoreHours | undefined) => void
  readonly onEntryChange: (dirty: boolean) => void
}) {
  const id = useId()
  const [type, setType] = useState("")
  const [openDay, setOpenDay] = useState("")
  const [closeDay, setCloseDay] = useState("")
  const [opens, setOpens] = useState("")
  const [closes, setCloses] = useState("")
  const [error, setError] = useState<string>()
  const dirty = Boolean(type || openDay || closeDay || opens || closes)
  useEffect(() => { onEntryChange(dirty); return () => onEntryChange(false) }, [dirty, onEntryChange])
  const hasCategory = Boolean(draft.payload.categories?.primaryCategory)
  const metadata = useQuery({
    queryKey: ["onboarding-services", draft.accountId, draft.id, draft.revision],
    queryFn: (ctx) => fetchOnboardingServices({ accountId: draft.accountId, draftId: draft.id, expectedRevision: draft.revision }, requestOptions(ctx)),
    enabled: hasCategory && contextSaved,
    retry: false,
  })
  const current = metadata.data?.revision === draft.revision && metadata.data.payloadHash === draft.payloadHash
  const choices = current ? [...new Map((metadata.data?.categories ?? []).flatMap((category) => category.moreHoursTypes ?? []).map((item) => [item.hoursTypeId, item])).values()] : []
  const ready = contextSaved && current && metadata.isSuccess && !metadata.isFetching && !metadata.error
  const label = (hoursTypeId: string) => {
    const choice = choices.find((item) => item.hoursTypeId === hoursTypeId)
    return choice?.localizedDisplayName ?? choice?.displayName ?? hoursTypeId
  }
  const reset = () => { setType(""); setOpenDay(""); setCloseDay(""); setOpens(""); setCloses(""); setError(undefined) }
  const add = () => {
    if (!ready || !choices.some((item) => item.hoursTypeId === type)) { setError("Refresh hour types and choose a supported type before adding this period."); return }
    const period = { openDay, closeDay, openTime: timeValue(opens), closeTime: timeValue(closes) }
    const exists = value?.some((item) => item.hoursTypeId === type)
    const proposed = exists ? value?.map((item) => item.hoursTypeId === type ? { ...item, periods: [...item.periods, period] } : item) : [...(value ?? []), { hoursTypeId: type, periods: [period] }]
    const parsed = googleOnboardingMoreHoursSchema.safeParse(proposed)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the additional hours period."); return }
    onChange(parsed.data); reset()
  }
  return <div role="group" aria-label="Creation additional service hours" className="flex min-w-0 flex-col gap-3 sm:col-span-2">
    <h4 className="text-ui font-semibold text-ink">Additional service hours</h4>
    <p className="text-caption text-ink-muted">Propose hours for services supported by the saved categories. Each service keeps its own schedule. Google validation and approval are separate from saving.</p>
    {!hasCategory || !contextSaved ? <p role="status" className="text-body text-ink-muted">Select and save the categories, language and country before loading hour types.</p> : metadata.isFetching ? <p role="status" className="text-body text-ink-muted">Loading supported hour types…</p> : null}
    {metadata.error && <div className="flex flex-col gap-2"><FormError>{describeActionError(metadata.error)}</FormError><Button type="button" variant="outline" className="self-start" disabled={!contextSaved} onClick={() => void metadata.refetch()}>Retry hour types</Button></div>}
    {!value && <p className="text-caption text-ink-muted">No additional service hours in this proposal.</p>}
    {value?.map((schedule) => <div key={schedule.hoursTypeId} role="group" aria-label={`Proposed service hours ${schedule.hoursTypeId}`} className="flex min-w-0 flex-col gap-2 border-b border-line-subtle pb-3">
      <h5 className="text-ui font-medium break-words text-ink-muted">{label(schedule.hoursTypeId)}</h5>
      <SupportDetails items={[schedule.hoursTypeId]} />
      {!choices.some((item) => item.hoursTypeId === schedule.hoursTypeId) && <p className="text-caption text-ink-muted">This saved type is retained. Its current support must be confirmed before creation.</p>}
      {schedule.periods.map((period, index) => <div key={googleHoursPeriodLabel(period)} className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between">
        <p className="text-body break-words tabular-nums">{googleHoursPeriodLabel(period)}</p>
        <Button type="button" variant="outline" aria-label={`Remove ${schedule.hoursTypeId} period ${index + 1}`} onClick={() => {
          const schedules = value.flatMap((item) => {
            if (item.hoursTypeId !== schedule.hoursTypeId) return [item]
            const periods = item.periods.filter((_, position) => position !== index)
            return periods.length ? [{ ...item, periods }] : []
          })
          onChange(schedules.length ? schedules : undefined)
        }}>Remove</Button>
      </div>)}
    </div>)}
    <Field><FieldLabel htmlFor={id}>Additional hours type</FieldLabel><Select value={type || "choose"} disabled={!ready || choices.length === 0} onValueChange={(next) => { if (typeof next === "string") setType(next === "choose" ? "" : next) }}>
      <SelectTrigger id={id}><SelectValue>{type ? label(type) : "Choose a supported hour type"}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value="choose">Choose a supported hour type</SelectItem>{choices.map((item) => <SelectItem key={item.hoursTypeId} value={item.hoursTypeId}>{label(item.hoursTypeId)}</SelectItem>)}</SelectContent>
    </Select></Field>
    {ready && choices.length === 0 && <p role="status" className="text-caption text-ink-muted">Google returned no additional hour types for these saved categories.</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <DayField label="Additional opening day" value={openDay} onChange={setOpenDay} />
      <HoursTimeField label="Additional opening time" value={opens} onChange={setOpens} />
      <DayField label="Additional closing day" value={closeDay} onChange={setCloseDay} />
      <HoursTimeField label="Additional closing time" value={closes} onChange={setCloses} />
    </div>
    <Field error={error}><FieldError /></Field>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!ready || !type || !openDay || !closeDay || !opens || !closes} onClick={add}>Add service hours period</Button>{dirty && <Button type="button" variant="ghost" onClick={reset}>Discard service hours entry</Button>}</div>
    {dirty && <p role="status" className="text-caption text-ink-muted">Add or discard this service hours entry before saving or searching.</p>}
  </div>
}
