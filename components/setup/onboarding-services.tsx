"use client"

import { useQuery } from "@tanstack/react-query"
import type { Dispatch, SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fetchOnboardingServices } from "@/lib/api/google-onboarding-services"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import { describeActionError } from "@/lib/errors/action-errors"
import { requestOptions } from "@/lib/queries/request-options"
import type { ServiceDraftRow } from "@/lib/locations/forms/services"
import { OnboardingServiceRow } from "./onboarding-service-row"

export function OnboardingServices({ draft, rows, setRows, contextSaved, error }: {
  draft: GoogleOnboardingDraft
  rows: ServiceDraftRow[]
  setRows: Dispatch<SetStateAction<ServiceDraftRow[]>>
  contextSaved: boolean
  error?: string
}) {
  const hasCategory = Boolean(draft.payload.categories?.primaryCategory)
  const metadata = useQuery({
    queryKey: ["onboarding-services", draft.accountId, draft.id, draft.revision],
    queryFn: (ctx) => fetchOnboardingServices({ accountId: draft.accountId, draftId: draft.id, expectedRevision: draft.revision }, requestOptions(ctx)),
    enabled: hasCategory && contextSaved,
    retry: false,
  })
  const current = metadata.data?.revision === draft.revision && metadata.data.payloadHash === draft.payloadHash
  const categories = current ? metadata.data?.categories ?? [] : []
  const choices = [...new Map(categories.flatMap((category) => category.serviceTypes).map((item) => [item.serviceTypeId, item])).values()]
  const ready = contextSaved && current && metadata.isSuccess && !metadata.isFetching && !metadata.error && rows.length < 100
  return <div role="group" aria-label="Creation services" className="flex min-w-0 flex-col gap-3 sm:col-span-2">
    <h4 className="text-ui font-semibold">Services</h4>
    <p className="text-caption text-ink-muted">Add the services this business offers. Saving keeps them in this proposal; Google validation and approval are separate.</p>
    {!hasCategory || !contextSaved ? <p role="status" className="text-ui text-ink-muted">Select and save the categories, language and country before loading service choices.</p> : metadata.isFetching ? <p role="status" className="text-ui text-ink-muted">Loading service choices…</p> : null}
    {metadata.error && <div role="alert" className="flex flex-col gap-2">
      <p className="text-ui text-danger-ink">{describeActionError(metadata.error)}</p>
      <Button type="button" variant="outline" className="self-start" disabled={!contextSaved} onClick={() => void metadata.refetch()}>Retry service choices</Button>
    </div>}
    {rows.length === 0 && <p className="text-ui text-ink-muted">No services in this proposal.</p>}
    {rows.map((row, index) => <OnboardingServiceRow key={index} row={row} index={index} categories={categories} onChange={(value) => setRows((currentRows) => currentRows.map((item, position) => position === index ? value : item))} onRemove={() => setRows((currentRows) => currentRows.filter((_, position) => position !== index))} />)}
    <Field>
      <FieldLabel htmlFor="onboarding-add-structured-service">Add a suggested service</FieldLabel>
      <Select value="choose" disabled={!ready || choices.length === 0} onValueChange={(value) => {
        const choice = choices.find((item) => item.serviceTypeId === value)
        if (choice && ready) setRows((currentRows) => [...currentRows, { item: { structuredServiceItem: { serviceTypeId: choice.serviceTypeId } }, priceEdit: { mode: "keep" } }])
      }}>
        <SelectTrigger id="onboarding-add-structured-service"><SelectValue>Choose a suggested service</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value="choose">Choose a suggested service</SelectItem>
          {choices.map((item) => <SelectItem key={item.serviceTypeId} value={item.serviceTypeId} disabled={rows.some((row) => "structuredServiceItem" in row.item && row.item.structuredServiceItem.serviceTypeId === item.serviceTypeId)}>{item.displayName ?? item.serviceTypeId}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
    {ready && choices.length === 0 && <p role="status" className="text-caption text-ink-muted">Google returned these categories without suggested services. You can propose a custom service for a selected category.</p>}
    <Field>
      <FieldLabel htmlFor="onboarding-add-custom-service">Add a custom service for category</FieldLabel>
      <Select value="choose" disabled={!ready} onValueChange={(value) => {
        const category = categories.find((item) => item.name === value)
        if (category && ready) setRows((currentRows) => [...currentRows, { item: { freeFormServiceItem: { category: category.name, label: { displayName: "", languageCode: metadata.data?.languageCode ?? draft.payload.languageCode } } }, priceEdit: { mode: "keep" } }])
      }}>
        <SelectTrigger id="onboarding-add-custom-service"><SelectValue>Choose a category for the custom service</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value="choose">Choose a category for the custom service</SelectItem>
          {categories.map((category) => <SelectItem key={category.name} value={category.name}>{category.displayName ?? category.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
    {rows.length === 100 && <p role="status" className="text-caption text-ink-muted">This proposal has the maximum of 100 services.</p>}
    {error && <p role="alert" className="text-ui text-danger-ink">{error}</p>}
  </div>
}
