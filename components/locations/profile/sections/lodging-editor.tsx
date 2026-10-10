"use client"

import { useId, useState } from "react"
import { flushSync } from "react-dom"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LODGING_EDITOR_GROUPS, type LodgingEditorNode } from "@/lib/locations/forms/lodging-catalogue"
import { lodgingErrorsWithin, lodgingRecord } from "@/lib/locations/forms/lodging-draft"
import { LodgingErrorMarker, LodgingFieldControl, lodgingErrorCountText } from "./lodging-field-control"

const order = ["property", "policies", "guestUnits", "commonLivingArea", "accessibility", "parking", "connectivity", "foodAndDrink", "housekeeping", "wellness", "pools", "activities", "business", "families", "pets", "services", "healthAndSafety", "sustainability", "transportation"]
const groups = [...LODGING_EDITOR_GROUPS].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
const searchable = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "")

function filtered(node: LodgingEditorNode, query: string): LodgingEditorNode | null {
  if (!query || searchable(node.label).includes(query)) return node
  if (node.kind === "group") {
    const children = node.children.flatMap((child) => { const found = filtered(child, query); return found ? [found] : [] })
    return children.length ? { ...node, children } : null
  }
  if (node.kind === "array") {
    const item = filtered(node.item, query)
    return item ? { ...node, item } : null
  }
  return null
}

export function LodgingEditor({ value, baseline, disabled, errors, onChange }: {
  readonly value: unknown; readonly baseline: unknown; readonly disabled: boolean
  readonly errors: Readonly<Record<string, string>>; readonly onChange: (value: Record<string, unknown>) => void
}) {
  const id = useId(), [search, setSearch] = useState(""), [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const query = searchable(search)
  const visible = groups.flatMap((node) => { const found = filtered(node, query); return found ? [found] : [] })
  const draft = lodgingRecord(value), original = lodgingRecord(baseline)
  const invalid = groups.flatMap((node) => { const count = lodgingErrorsWithin(errors, node.key).length; return count ? [{ node, count }] : [] })
  const invalidCount = (key: string) => invalid.find((entry) => entry.node.key === key)?.count ?? 0
  // Open the group synchronously so its first invalid control can take focus.
  const correct = (key: string) => {
    flushSync(() => {
      setSearch("")
      setOpened((previous) => new Set([...previous, key]))
    })
    const region = document.getElementById(`${id}-${key}`)
    const target = region?.querySelector<HTMLElement>('[aria-invalid="true"], [data-lodging-invalid="true"]') ?? document.getElementById(`${id}-${key}-toggle`)
    target?.focus()
  }
  return <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-col gap-1">
      <h4 id={`${id}-title`} className="text-title font-semibold text-ink">Lodging details</h4>
      <p className="text-ui text-ink-muted">Not recorded, No and conditional availability are different values. Choose a detail to edit, then review the exact changes before sending.</p>
    </div>
    {invalid.length ? <div aria-labelledby={`${id}-invalid`} role="group" className="flex min-w-0 flex-col gap-2 rounded-(--np-radius-card) border border-danger-ink p-3">
      <p id={`${id}-invalid`} className="text-ui font-semibold text-danger-ink">Details to correct before review</p>
      <ul className="flex flex-col gap-1">
        {invalid.map(({ node, count }) => <li key={node.key}>
          <Button type="button" size="sm" variant="link" className="text-danger-ink" onClick={() => correct(node.key)}>{node.label}: {lodgingErrorCountText(count)}</Button>
        </li>)}
      </ul>
    </div> : null}
    <Field><FieldLabel>Find a lodging detail</FieldLabel><Input type="search" value={search} onChange={(event) => {
      setSearch(event.target.value)
      setOpened(new Set(event.target.value ? groups.map((node) => node.key) : []))
    }} placeholder="Rooms, parking, accessibility…" /></Field>
    {visible.length === 0 ? <p role="status" className="text-ui text-ink-muted">No lodging details match this search.</p> : null}
    {visible.map((node) => {
      const expanded = opened.has(node.key), count = invalidCount(node.key)
      return <div key={node.key} data-invalid={count ? "" : undefined} className={`min-w-0 overflow-hidden rounded-(--np-radius-card) border bg-surface ${count ? "border-danger-ink" : "border-line"}`}>
        <div className="flex min-w-0 items-center gap-2 pr-3">
          <Button id={`${id}-${node.key}-toggle`} type="button" variant="ghost" className="min-w-0 flex-1 justify-start rounded-none px-4 py-3" aria-expanded={expanded} aria-controls={`${id}-${node.key}`} aria-describedby={count ? `${id}-${node.key}-invalid` : undefined} onClick={() => setOpened((previous) => {
            const next = new Set(previous)
            if (next.has(node.key)) next.delete(node.key)
            else next.add(node.key)
            return next
          })}>
            {expanded ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}{node.label}
          </Button>
          <LodgingErrorMarker id={`${id}-${node.key}-invalid`} count={count} />
        </div>
        {expanded ? <div id={`${id}-${node.key}`} className="min-w-0 border-t border-line p-4">
          <LodgingFieldControl node={node} value={draft[node.key]} original={original[node.key]} disabled={disabled} errors={errors} onChange={(next) => {
            const updated = { ...draft }
            if (next === undefined) delete updated[node.key]
            else updated[node.key] = next
            onChange(updated)
          }} />
        </div> : null}
      </div>
    })}
  </section>
}
