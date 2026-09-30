"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fetchOnboardingChains } from "@/lib/api/google-onboarding-chains"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import type { GoogleRelationship } from "@/lib/domain/google-relationships"
import { describeActionError } from "@/lib/errors/action-errors"
import { removeOnboardingChain } from "@/lib/locations/onboarding-relationships"
import { requestOptions } from "@/lib/queries/request-options"

export function OnboardingChain({ draft, value, onChange }: {
  draft: GoogleOnboardingDraft
  value: GoogleRelationship | undefined
  onChange: (value: GoogleRelationship | undefined) => void
}) {
  const [query, setQuery] = useState("")
  const [searched, setSearched] = useState("")
  const search = useQuery({
    queryKey: ["onboarding-chains", draft.accountId, draft.id, draft.revision, searched],
    queryFn: (ctx) => fetchOnboardingChains({ accountId: draft.accountId, draftId: draft.id, expectedRevision: draft.revision, query: searched }, requestOptions(ctx)),
    enabled: Boolean(searched),
    retry: false,
  })
  const current = search.data?.revision === draft.revision && search.data.payloadHash === draft.payloadHash && search.data.query === searched
  const ready = current && search.isSuccess && !search.isFetching && !search.error
  const choices = ready ? search.data?.choices ?? [] : []
  const selected = choices.find((choice) => choice.name === value?.parentChain)
  const runSearch = () => {
    if (!query.trim() || search.isFetching) return
    if (searched === query.trim()) void search.refetch()
    else setSearched(query.trim())
  }
  return <div role="group" aria-label="Creation chain affiliation" className="flex min-w-0 flex-col gap-3 sm:col-span-2">
    <h4 className="text-ui font-semibold">Chain affiliation</h4>
    <div className="flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row">
      <div className="min-w-0"><p className="text-ui">{selected?.label ?? (value?.parentChain ? "Proposed chain" : "No chain affiliation in this proposal.")}</p>{value?.parentChain && <p className="text-caption font-mono text-ink-muted break-all">{value.parentChain}</p>}</div>
      {value?.parentChain && <Button type="button" variant="outline" onClick={() => onChange(removeOnboardingChain(value))}>Remove chain from proposal</Button>}
    </div>
    <Field>
      <FieldLabel htmlFor="onboarding-chain-search">Search Google chains</FieldLabel>
      <div className="flex items-center gap-3">
        <Input className="min-w-0 flex-1" id="onboarding-chain-search" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); runSearch() } }} />
        <Button type="button" variant="outline" disabled={!query.trim() || search.isFetching} onClick={runSearch}>Search chains</Button>
      </div>
      <FieldDescription>Choose an exact chain returned by Google. Search results do not confirm affiliation; Google validates the saved proposal before approval.</FieldDescription>
    </Field>
    {searched && <div className="flex flex-col gap-3" aria-label="Creation chain search results">
      {search.isFetching ? <p role="status" className="text-ui text-ink-muted">Searching Google chains...</p> : search.error ? <p role="alert" className="text-ui text-danger-ink">{describeActionError(search.error)} Search again to retry.</p> : ready && !choices.length ? <p role="status" className="text-ui text-ink-muted">No chains found for {searched}. Try another name.</p> : null}
      {choices.map((choice) => <div key={choice.name} className="flex min-w-0 items-start justify-between gap-3 rounded-(--np-radius-control) border border-line p-3">
        <div className="min-w-0"><p className="text-ui break-words">{choice.label}</p><p className="text-caption font-mono text-ink-muted break-all">{choice.name}</p></div>
        <Button type="button" variant="outline" disabled={value?.parentChain === choice.name} aria-label={`Select chain ${choice.label}`} onClick={() => onChange({ ...value, parentChain: choice.name })}>{value?.parentChain === choice.name ? "Selected" : "Select"}</Button>
      </div>)}
    </div>}
  </div>
}
