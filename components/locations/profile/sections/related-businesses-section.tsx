"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { googleRelevantLocationSchema, unsupportedRelationshipBaseline } from "@/lib/domain/google-relationships"
import { asRecord, type BusinessInformationDraft } from "@/lib/locations/google-values"
import { SectionCard } from "../section-card"

const relationLabels = {
  DEPARTMENT_OF: "Department",
  INDEPENDENT_ESTABLISHMENT_IN: "Independent business at the same address",
} as const

type Props = {
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  location: unknown
  disabled: boolean
  changed: boolean
  error?: string
}

export function RelatedBusinessesSection(props: Props) {
  return <SectionCard id="section-related-businesses" model="google" title="Related businesses" description="Manage parent and child business relationships using exact Google place IDs." changed={props.changed}>
    <RelationshipControl {...props} kind="parent" />
    <RelationshipControl {...props} kind="child" />
    {props.error && <p role="alert" className="text-ui text-danger-ink">{props.error}</p>}
  </SectionCard>
}

function RelationshipControl({ draft, setDraft, location, disabled, kind }: Props & { kind: "parent" | "child" }) {
  const [placeId, setPlaceId] = useState("")
  const [relationType, setRelationType] = useState<keyof typeof relationLabels | null>(null)
  const [entryError, setEntryError] = useState<string | undefined>()
  const field = kind === "parent" ? "parentLocation" : "childrenLocations"
  const unsupported = unsupportedRelationshipBaseline(asRecord(location).relationshipData, [`relationshipData.${field}`])
  const blocked = disabled || unsupported
  const parent = googleRelevantLocationSchema.safeParse(draft.relationshipData?.parentLocation)
  const related = kind === "parent" ? parent.success ? [parent.data] : [] : draft.relationshipData?.childrenLocations ?? []
  const label = kind === "parent" ? "Parent business" : "Child businesses"
  const add = () => {
    if (blocked) return
    const value = googleRelevantLocationSchema.safeParse({ placeId, relationType })
    if (!value.success) { setEntryError("Enter a Google place ID without spaces or URL characters and choose a relationship."); return }
    if (kind === "child" && related.some((item) => item.placeId === value.data.placeId)) {
      setEntryError("This child place ID is already in the draft. Remove it before changing its relationship.")
      return
    }
    setDraft((current) => ({ ...current, relationshipData: {
      ...current.relationshipData,
      ...(kind === "parent" ? { parentLocation: value.data } : { childrenLocations: [...(current.relationshipData?.childrenLocations ?? []), value.data] }),
    } }))
    setPlaceId(""); setRelationType(null); setEntryError(undefined)
  }
  return <div className="flex flex-col gap-3" role="group" aria-label={label}>
    <h3 className="text-ui font-medium">{label}</h3>
    {unsupported ? <p role="status" className="text-ui text-ink-muted">The existing {kind} business data cannot be edited safely here. <a href="https://business.google.com/locations" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Manage {kind} businesses in Google</a>, then refresh.</p> : <>
      {related.length === 0 && <p className="text-ui text-ink-muted">No {kind} business in this draft.</p>}
      {related.map((item) => <div key={item.placeId} className="flex items-start justify-between gap-3 rounded-(--np-radius-control) border border-line p-3">
        <div className="min-w-0"><p className="text-ui break-words">{relationLabels[item.relationType]}</p><p className="text-caption font-mono text-ink-muted break-all">{item.placeId}</p></div>
        <Button type="button" variant="outline" disabled={blocked} aria-label={`Remove ${kind} business ${item.placeId}`} onClick={() => setDraft((current) => ({ ...current, relationshipData: { ...current.relationshipData,
          ...(kind === "parent" ? { parentLocation: {} } : { childrenLocations: (current.relationshipData?.childrenLocations ?? []).filter((child) => child.placeId !== item.placeId) }),
        } }))}>Remove</Button>
      </div>)}
    </>}
    <Field error={entryError}>
      <FieldLabel htmlFor={`profile-${kind}-place-id`}>{kind === "parent" ? "Parent business place ID" : "New child business place ID"}</FieldLabel>
      <Input id={`profile-${kind}-place-id`} value={placeId} maxLength={255} disabled={blocked} onChange={(event) => { setPlaceId(event.target.value); setEntryError(undefined) }} />
      <FieldDescription>Use an existing Google place ID. Local checks validate format only; provider validation and confirmation are separate.</FieldDescription>
      <FieldError />
    </Field>
    <Field>
      <FieldLabel htmlFor={`profile-${kind}-relationship`}>{kind === "parent" ? "Relationship to parent" : "Relationship of child"}</FieldLabel>
      <Select value={relationType ?? "unchanged"} disabled={blocked} onValueChange={(value) => {
        if (value === "unchanged") { setRelationType(null); setEntryError(undefined) }
        if (value === "DEPARTMENT_OF" || value === "INDEPENDENT_ESTABLISHMENT_IN") { setRelationType(value); setEntryError(undefined) }
      }}>
        <SelectTrigger id={`profile-${kind}-relationship`}><SelectValue>{relationType ? relationLabels[relationType] : "Choose relationship"}</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value="unchanged">Choose relationship</SelectItem>
          <SelectItem value="DEPARTMENT_OF">Department</SelectItem>
          <SelectItem value="INDEPENDENT_ESTABLISHMENT_IN">Independent business at the same address</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>{kind === "parent" ? "Choose whether this location is a department of the parent or an independent business within it." : "Choose whether the child is a department of this location or an independent business within it."}</FieldDescription>
    </Field>
    <Button type="button" variant="outline" className="self-start" disabled={blocked || !placeId.trim() || !relationType} onClick={add}>{kind === "parent" ? "Set parent business" : "Add child business"}</Button>
  </div>
}
