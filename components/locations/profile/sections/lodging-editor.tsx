"use client"

import { useId, useState } from "react"
import { flushSync } from "react-dom"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { LODGING_EDITOR_GROUPS, type LodgingEditorNode } from "@/lib/locations/forms/lodging-catalogue"
import { lodgingErrorsWithin, lodgingRecord } from "@/lib/locations/forms/lodging-draft"
import { LodgingErrorMarker, LodgingFieldControl, lodgingErrorCountText } from "./lodging-field-control"
import { SettingsGroupLabel } from "./setting-rows"

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
  return <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-col gap-1">
      <SettingsGroupLabel as="h4" id={`${id}-title`}>Lodging details</SettingsGroupLabel>
      <p className="text-caption text-ink-muted">Not recorded, No and conditional availability are different values. Choose a detail to edit, then review the exact changes before sending.</p>
    </div>
    {/* A static group of links, not an announcement: the polite/assertive
        role an Alert would add is replaced by the group role it had. */}
    {invalid.length ? <Alert variant="destructive" role="group" aria-labelledby={`${id}-invalid`}>
      <AlertTitle id={`${id}-invalid`}>Details to correct before review</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {invalid.map(({ node, count }) => <li key={node.key}>
            <Button type="button" size="sm" variant="link" className="text-danger-ink" onClick={() => correct(node.key)}>{node.label}: {lodgingErrorCountText(count)}</Button>
          </li>)}
        </ul>
      </AlertDescription>
    </Alert> : null}
    <Field><FieldLabel>Find a lodging detail</FieldLabel><Input type="search" value={search} onChange={(event) => {
      setSearch(event.target.value)
      setOpened(new Set(event.target.value ? groups.map((node) => node.key) : []))
    }} placeholder="Rooms, parking, accessibility…" /></Field>
    {visible.length === 0 ? <p role="status" className="text-ui text-ink-muted">No lodging details match this search.</p> : null}
    {/* One list of disclosure rows (hairlines between, one card around), not
        a card per group. A group holding invalid details says so in words
        beside its name. */}
    {visible.length ? <ul className="flex min-w-0 flex-col divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">{visible.map((node) => {
      const expanded = opened.has(node.key), count = invalidCount(node.key)
      return <li key={node.key} data-invalid={count ? "" : undefined} className="min-w-0">
        <div className="flex min-w-0 items-center gap-2 pr-3">
          <Button id={`${id}-${node.key}-toggle`} type="button" variant="ghost" className="min-h-(--np-row-h) min-w-0 flex-1 justify-start rounded-none px-(--np-card-pad) py-3 font-medium focus-visible:[box-shadow:inset_var(--np-focus-halo)]" aria-expanded={expanded} aria-controls={`${id}-${node.key}`} aria-describedby={count ? `${id}-${node.key}-invalid` : undefined} onClick={() => setOpened((previous) => {
            const next = new Set(previous)
            if (next.has(node.key)) next.delete(node.key)
            else next.add(node.key)
            return next
          })}>
            {expanded ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}{node.label}
          </Button>
          <LodgingErrorMarker id={`${id}-${node.key}-invalid`} count={count} />
        </div>
        {expanded ? <div id={`${id}-${node.key}`} className="min-w-0 border-t border-line-subtle p-(--np-card-pad)">
          <LodgingFieldControl node={node} value={draft[node.key]} original={original[node.key]} disabled={disabled} errors={errors} onChange={(next) => {
            const updated = { ...draft }
            if (next === undefined) delete updated[node.key]
            else updated[node.key] = next
            onChange(updated)
          }} />
        </div> : null}
      </li>
    })}</ul> : null}
  </section>
}
