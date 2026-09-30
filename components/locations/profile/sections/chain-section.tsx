"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { chainSearchChoices } from "@/lib/domain/google-chains"
import { unsupportedRelationshipBaseline } from "@/lib/domain/google-relationships"
import { asRecord, type BusinessInformationDraft } from "@/lib/locations/google-values"
import { useBusinessInformationMetadata } from "@/lib/queries/use-location-business-information"
import { SectionCard } from "../section-card"

export function ChainSection({ locationId, location, draft, setDraft, disabled, changed, error }: {
  locationId: string
  location: unknown
  draft: BusinessInformationDraft
  setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  disabled: boolean
  changed: boolean
  error?: string
}) {
  const [query, setQuery] = useState("")
  const [searched, setSearched] = useState("")
  const search = useBusinessInformationMetadata(locationId, "chains", searched)
  const choices = search.data ? chainSearchChoices(search.data.result) : null
  const unsupported = unsupportedRelationshipBaseline(asRecord(location).relationshipData, ["relationshipData.parentChain"])
  const blocked = disabled || unsupported
  const current = draft.relationshipData?.parentChain
  const selectedName = choices?.find((choice) => choice.name === current)?.label
  const choose = (name: string) => setDraft((value) => ({ ...value, relationshipData: { ...value.relationshipData, parentChain: name } }))
  const runSearch = () => {
    if (blocked || !query.trim() || search.isFetching) return
    if (searched === query.trim()) void search.refetch()
    else setSearched(query.trim())
  }
  return <SectionCard id="section-chain" model="google" title="Chain affiliation" description="Associate this location with a chain recognised by Google." changed={changed}>
    {unsupported ? <p role="status" className="text-ui text-ink-muted">The existing chain affiliation cannot be edited safely here. <a href="https://business.google.com/locations" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Manage it in Google</a>, then refresh.</p> : <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-ui font-medium">{selectedName ?? (current ? "Selected chain" : "No chain affiliation in this draft")}</p>{current && <p className="text-caption font-mono text-ink-muted break-all">{current}</p>}</div>
      {current && <Button type="button" variant="outline" disabled={blocked} onClick={() => choose("")}>Remove affiliation</Button>}
    </div>}
    <Field error={error}>
      <FieldLabel htmlFor="profile-chain-search">Search Google chains</FieldLabel>
      <div className="flex items-center gap-3">
        <Input className="min-w-0 flex-1" id="profile-chain-search" value={query} maxLength={255} disabled={blocked}
          onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); runSearch() }
          }} />
        <Button type="button" variant="outline" disabled={blocked || !query.trim() || search.isFetching} onClick={runSearch}>Search</Button>
      </div>
      <FieldDescription>Choose the exact chain from Google&apos;s results. Search results do not confirm this location&apos;s affiliation; review and publish to request the change.</FieldDescription>
      <FieldError />
    </Field>
    {searched && <div className="flex flex-col gap-3" aria-label="Chain search results">
      {search.isFetching ? <p role="status" className="text-ui text-ink-muted">Searching Google chains...</p>
        : search.isError || (search.data && choices === null) ? <p role="alert" className="text-ui text-danger-ink">Chain results could not be loaded. Search again to retry.</p>
        : choices?.length === 0 ? <p role="status" className="text-ui text-ink-muted">No chains found for {searched}. Try another name.</p>
        : choices?.map((choice) => <div key={choice.name} className="flex items-start justify-between gap-3 rounded-(--np-radius-control) border border-line p-3">
          <div className="min-w-0"><p className="text-ui font-medium break-words">{choice.label}</p><p className="text-caption font-mono text-ink-muted break-all">{choice.name}</p></div>
          <Button type="button" variant="outline" disabled={blocked || current === choice.name} aria-label={`Select ${choice.label}`} onClick={() => choose(choice.name)}>{current === choice.name ? "Selected" : "Select"}</Button>
        </div>)}
    </div>}
  </SectionCard>
}
