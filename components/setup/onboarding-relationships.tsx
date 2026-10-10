"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { googleRelevantLocationSchema, type GoogleRelationship } from "@/lib/domain/google-relationships"
import { relationshipLabels, removeOnboardingRelationship } from "@/lib/locations/onboarding-relationships"

type Props = {
  value: GoogleRelationship | undefined
  onChange: (value: GoogleRelationship | undefined) => void
  onEntryChange: (dirty: boolean) => void
}

export function OnboardingRelationships({ value, onChange, onEntryChange }: Props) {
  const [parentDirty, setParentDirty] = useState(false)
  const [childDirty, setChildDirty] = useState(false)
  useEffect(() => {
    onEntryChange(parentDirty || childDirty)
    return () => onEntryChange(false)
  }, [parentDirty, childDirty, onEntryChange])
  return <div role="group" aria-label="Creation business relationships" className="flex min-w-0 flex-col gap-4 sm:col-span-2">
    <div className="space-y-1">
      <h4 className="text-ui font-semibold">Related businesses</h4>
      <p className="text-caption text-ink-muted">Use exact Google place IDs. These are proposed relationships; Google validates them before approval.</p>
    </div>
    {value?.parentChain && <p className="text-caption text-ink-muted break-all">Proposed chain affiliation: {value.parentChain}. Parent and child edits preserve this affiliation.</p>}
    <RelationshipEntry value={value} onChange={onChange} onEntryChange={setParentDirty} parent />
    <RelationshipEntry value={value} onChange={onChange} onEntryChange={setChildDirty} parent={false} />
  </div>
}

function RelationshipEntry({ value, onChange, onEntryChange, parent }: Props & { parent: boolean }) {
  const [placeId, setPlaceId] = useState("")
  const [relation, setRelation] = useState<keyof typeof relationshipLabels | null>(null)
  const [error, setError] = useState<string>()
  const dirty = Boolean(placeId || relation)
  useEffect(() => {
    onEntryChange(dirty)
    return () => onEntryChange(false)
  }, [dirty, onEntryChange])
  const parsedParent = googleRelevantLocationSchema.safeParse(value?.parentLocation)
  const existingParent = parsedParent.success ? parsedParent.data : undefined
  const related = parent ? existingParent ? [existingParent] : [] : value?.childrenLocations ?? []
  const prefix = parent ? "onboarding-parent" : "onboarding-child"
  const reset = () => { setPlaceId(""); setRelation(null); setError(undefined) }
  const add = () => {
    const parsed = googleRelevantLocationSchema.safeParse({ placeId, relationType: relation })
    if (!parsed.success) { setError("Enter a Google place ID without spaces or URL characters and choose a relationship."); return }
    if (!parent && related.some((item) => item.placeId === parsed.data.placeId)) { setError("This child place ID is already in the proposal. Remove it before changing its relationship."); return }
    onChange({ ...value, ...(parent ? { parentLocation: parsed.data } : { childrenLocations: [...related, parsed.data] }) })
    reset()
  }
  return <div role="group" aria-label={parent ? "Proposed parent business" : "Proposed child businesses"} className="flex min-w-0 flex-col gap-3">
    <h5 className="text-ui font-medium">{parent ? "Parent business" : "Child businesses"}</h5>
    {related.length === 0 && <p className="text-caption text-ink-muted">No {parent ? "parent" : "child"} business in this proposal.</p>}
    {related.map((item) => <div key={item.placeId} className="flex min-w-0 items-start justify-between gap-3 rounded-(--np-radius-control) border border-line p-3">
      <div className="min-w-0"><p className="text-ui break-words">{relationshipLabels[item.relationType]}</p><p className="text-caption font-mono text-ink-muted break-all">{item.placeId}</p></div>
      <Button type="button" variant="outline" aria-label={`Remove ${parent ? "parent" : "child"} from proposal ${item.placeId}`} onClick={() => { if (value) onChange(removeOnboardingRelationship(value, { parent, placeId: item.placeId })) }}>Remove</Button>
    </div>)}
    <Field error={error}>
      <FieldLabel htmlFor={`${prefix}-place`}>{parent ? "Parent business place ID" : "New child business place ID"}</FieldLabel>
      <Input id={`${prefix}-place`} value={placeId} maxLength={255} onChange={(event) => { setPlaceId(event.target.value); setError(undefined) }} />
      <FieldDescription>Local checks validate ID format only. Use a known place ID; do not enter a Maps URL or infer an ID from a business name.</FieldDescription>
      <FieldError />
    </Field>
    <Field>
      <FieldLabel htmlFor={`${prefix}-relation`}>{parent ? "Relationship to parent" : "Relationship of child"}</FieldLabel>
      <Select value={relation ?? "choose"} onValueChange={(next) => {
        if (next === "choose") setRelation(null)
        if (next === "DEPARTMENT_OF" || next === "INDEPENDENT_ESTABLISHMENT_IN") setRelation(next)
        setError(undefined)
      }}>
        <SelectTrigger id={`${prefix}-relation`}><SelectValue>{relation ? relationshipLabels[relation] : "Choose relationship"}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="choose">Choose relationship</SelectItem><SelectItem value="DEPARTMENT_OF">Department</SelectItem><SelectItem value="INDEPENDENT_ESTABLISHMENT_IN">Independent business at the same address</SelectItem></SelectContent>
      </Select>
    </Field>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={!placeId.trim() || !relation} onClick={add}>{parent ? "Set parent business" : "Add child business"}</Button>
      {dirty && <Button type="button" variant="ghost" onClick={reset}>{parent ? "Discard parent entry" : "Discard child entry"}</Button>}
    </div>
    {dirty && <p role="status" className="text-caption text-ink-muted">{parent ? "Set the parent" : "Add the child"} or discard this entry before saving or searching.</p>}
  </div>
}
