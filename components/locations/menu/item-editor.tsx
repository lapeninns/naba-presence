"use client"

import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readLabel, withLabel, withPrice, type EditorItem, type MenuIssue } from "@/lib/locations/forms/menu-editor"

export function MenuItemEditor({ item, index, count, idPrefix, disabled, issues, onChange, onMove, onDuplicate, onRemove }: {
  item: EditorItem
  index: number
  count: number
  idPrefix: string
  disabled: boolean
  issues: MenuIssue[]
  onChange: (item: EditorItem) => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const label = readLabel(item.data)
  const name = label.displayName.trim() || `item ${index + 1}`
  const id = `${idPrefix}-${item.id}`
  const nameError = issues.find((issue) => issue.nodeId === item.id && issue.field === "name")?.message
  const priceError = issues.find((issue) => issue.nodeId === item.id && issue.field === "price")?.message
  const options = Array.isArray(item.data.options) ? item.data.options.length : 0

  return (
    <li className="flex min-w-0 flex-col gap-4 px-(--np-card-pad) py-5">
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,10rem)]">
        <Field error={nameError}>
          <FieldLabel htmlFor={`${id}-name`}>Item name</FieldLabel>
          <Input id={`${id}-name`} value={label.displayName} disabled={disabled} placeholder="For example, soup of the day" onChange={(event) => onChange({ ...item, data: withLabel(item.data, { displayName: event.target.value }) })} />
          <FieldError />
        </Field>
        <Field error={priceError}>
          <FieldLabel htmlFor={`${id}-price`}>Price ({item.currencyCode})</FieldLabel>
          <Input id={`${id}-price`} inputMode="decimal" value={item.priceText} disabled={disabled} placeholder="No price" className="tabular-nums" onChange={(event) => onChange({ ...item, priceText: event.target.value, data: withPrice(item.data, event.target.value, item.currencyCode) })} />
          <FieldError />
          <FieldDescription>Optional. Leave blank for no listed price.</FieldDescription>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-description`}>Description <span className="font-normal text-ink-muted">(optional)</span></FieldLabel>
        <Textarea id={`${id}-description`} value={label.description} disabled={disabled} rows={2} placeholder="Ingredients, preparation, or serving details" onChange={(event) => onChange({ ...item, data: withLabel(item.data, { description: event.target.value }) })} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-ink-muted">
          Item {index + 1} of {count}{options ? ` · ${options} additional ${options === 1 ? "option" : "options"} preserved` : ""}
        </p>
        {!disabled ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Actions for ${name}`}>
            <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" disabled={index === 0} aria-label={`Move ${name} up`} title="Move up" onClick={() => onMove(-1)}><ArrowUp aria-hidden strokeWidth={1.75} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" disabled={index === count - 1} aria-label={`Move ${name} down`} title="Move down" onClick={() => onMove(1)}><ArrowDown aria-hidden strokeWidth={1.75} /></Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label={`Duplicate ${name}`} onClick={onDuplicate}><Copy aria-hidden strokeWidth={1.75} data-icon="inline-start" />Duplicate</Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label={`Remove ${name}`} onClick={onRemove}><Trash2 aria-hidden strokeWidth={1.75} data-icon="inline-start" />Remove</Button>
          </div>
        ) : null}
      </div>
    </li>
  )
}
