"use client"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input, inputHints } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CodeCombobox } from "./code-combobox"
import type { GoogleServiceCategory } from "@/lib/domain/google-services"
import { serviceCategoryId } from "@/lib/domain/google-services"
import { codeLabel, currencyOptions, typedCurrencyCode, withCurrent } from "@/lib/setup/onboarding-codes"
import { servicePriceText, setServiceDescription, type ServiceDraftRow } from "@/lib/locations/forms/services"

export function OnboardingServiceRow({ row, index, categories, onChange, onRemove }: {
  row: ServiceDraftRow
  index: number
  categories: readonly GoogleServiceCategory[]
  onChange: (row: ServiceDraftRow) => void
  onRemove: () => void
}) {
  const custom = "freeFormServiceItem" in row.item ? row.item.freeFormServiceItem : null
  const structured = "structuredServiceItem" in row.item ? row.item.structuredServiceItem : null
  const title = custom?.label.displayName || categories.flatMap((category) => category.serviceTypes).find((item) => item.serviceTypeId === structured?.serviceTypeId)?.displayName || structured?.serviceTypeId || `Service ${index + 1}`
  const description = custom?.label.description ?? structured?.description ?? ""
  const price = row.priceEdit.mode === "set" ? row.priceEdit.amount : row.priceEdit.mode === "clear" ? "" : servicePriceText(row.item.price)
  const currency = row.priceEdit.mode === "set" ? row.priceEdit.currency : row.item.price?.currencyCode ?? "GBP"
  // The currency picker's list, with a saved code kept in it.
  const currencies = withCurrent(currencyOptions(), currency, "currency")
  const prefix = `onboarding-service-${index}`
  return <div role="group" aria-label={`Service ${index + 1}`} className="flex min-w-0 flex-col gap-3 border-t border-line-subtle pt-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h5 className="text-body font-medium break-words text-ink">{title}</h5>
        <p className="text-caption text-ink-muted break-all">{custom ? categories.find((category) => serviceCategoryId(category.name) === serviceCategoryId(custom.category))?.displayName ?? custom.category : structured?.serviceTypeId}</p>
      </div>
      <Button type="button" variant="outline" aria-label={`Remove service ${index + 1}`} onClick={onRemove}>Remove</Button>
    </div>
    {custom && <Field>
      <FieldLabel htmlFor={`${prefix}-name`}>Custom service name</FieldLabel>
      <Input id={`${prefix}-name`} value={custom.label.displayName} onChange={(event) => {
        if ("freeFormServiceItem" in row.item) onChange({ ...row, item: { ...row.item, freeFormServiceItem: { ...row.item.freeFormServiceItem, label: { ...row.item.freeFormServiceItem.label, displayName: event.target.value } } } })
      }} />
    </Field>}
    <Field>
      <FieldLabel htmlFor={`${prefix}-description`}>Service description</FieldLabel>
      <Textarea id={`${prefix}-description`} rows={2} value={description} maxLength={structured ? 300 : undefined} onChange={(event) => onChange({ ...row, item: setServiceDescription(row.item, event.target.value) })} />
    </Field>
    <Button type="button" variant="ghost" className="self-start" onClick={() => onChange({ ...row, item: setServiceDescription(row.item, undefined) })}>Clear service description</Button>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={`${prefix}-price`}>Service price</FieldLabel>
        <Input id={`${prefix}-price`} {...inputHints.decimal} value={price} onChange={(event) => onChange({ ...row, priceEdit: { mode: "set", amount: event.target.value, currency } })} />
      </Field>
      <Field>
        <FieldLabel>Service currency</FieldLabel>
        <CodeCombobox title="Service currency" placeholder="Choose a currency" value={currency} options={currencies} typed={(text) => typedCurrencyCode(text, currencies)} label={(code) => codeLabel("currency", code)} onValueChange={(code) => onChange({ ...row, priceEdit: { mode: "set", amount: price, currency: code } })} />
      </Field>
    </div>
    <Button type="button" variant="ghost" className="self-start" onClick={() => onChange({ ...row, priceEdit: { mode: "clear" } })}>Clear service price</Button>
  </div>
}
