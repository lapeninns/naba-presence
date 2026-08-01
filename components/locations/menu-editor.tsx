"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { FoodMenu } from "@/lib/api/location-menu"

type Json = Record<string, unknown>

function label(node: Json): { displayName: string; description: string } {
  const labels = Array.isArray(node.labels) ? node.labels : []
  const first = (labels[0] ?? {}) as Json
  return {
    displayName: typeof first.displayName === "string" ? first.displayName : "",
    description: typeof first.description === "string" ? first.description : "",
  }
}

function withLabel(node: Json, displayName: string, description: string): Json {
  const labels = Array.isArray(node.labels) ? [...(node.labels as Json[])] : []
  // Explicit Json annotation: without it TS narrows the spread's inferred
  // type to just `{ displayName: string }` (losing the index signature),
  // which then rejects the `.description` assignment/delete below.
  const first: Json = { ...((labels[0] as Json) ?? {}), displayName }
  if (description) first.description = description
  else delete first.description
  return { ...node, labels: [first, ...labels.slice(1)] }
}

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", AUD: "$", CAD: "$", NZD: "$", INR: "₹", JPY: "¥" }

// The item's own currency, derived from its existing price; GBP only as a
// fallback for an item that has never had a price (never rewrites another currency).
export function currencyOf(item: Json): string {
  const price = (item.attributes ?? {}) as Json
  const code = (price.price ?? {}) as Json
  return typeof code.currencyCode === "string" && code.currencyCode ? code.currencyCode : "GBP"
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code
}

export function readPrice(item: Json): string {
  const attributes = (item.attributes ?? {}) as Json
  const price = (attributes.price ?? {}) as Json
  if (price.units === undefined && price.nanos === undefined) return ""
  const units = String(price.units ?? "0")
  const nanos = typeof price.nanos === "number" ? price.nanos : 0
  const fraction = nanos ? (nanos / 1e9).toFixed(2).slice(1) : ""
  return `${units}${fraction}`
}

function withPrice(item: Json, value: string): Json {
  const attributes = { ...((item.attributes ?? {}) as Json) }
  const trimmed = value.trim()
  if (!trimmed) {
    delete (attributes as Json).price
    return { ...item, attributes }
  }
  // Preserve the item's existing currency; default GBP only for a brand-new price.
  const existing = (attributes.price ?? {}) as Json
  const currencyCode = typeof existing.currencyCode === "string" && existing.currencyCode ? existing.currencyCode : "GBP"
  const [unitsPart, fractionPart = ""] = trimmed.split(".")
  const units = String(Number.parseInt(unitsPart || "0", 10) || 0)
  const nanos = fractionPart ? Math.round(Number(`0.${fractionPart}`) * 1e9) : 0
  attributes.price = { currencyCode, units, nanos }
  return { ...item, attributes }
}

export function MenuEditor({ menus, onChange, disabled }: { menus: FoodMenu[]; onChange: (next: FoodMenu[]) => void; disabled: boolean }) {
  const menu = (menus[0] ?? {}) as Json
  const sections = Array.isArray(menu.sections) ? (menu.sections as Json[]) : []

  function setSections(next: Json[]) {
    onChange([{ ...menu, sections: next }, ...menus.slice(1)])
  }
  function setSection(index: number, section: Json) {
    setSections(sections.map((s, i) => (i === index ? section : s)))
  }
  function setItems(sectionIndex: number, items: Json[]) {
    setSection(sectionIndex, { ...sections[sectionIndex], items })
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section, sectionIndex) => {
        const items = Array.isArray(section.items) ? (section.items as Json[]) : []
        const sectionLabel = label(section)
        return (
          <section key={sectionIndex} className="flex flex-col gap-3 rounded-(--nr-radius-card) border border-border p-4">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Section ${sectionIndex + 1} name`}
                value={sectionLabel.displayName}
                disabled={disabled}
                onChange={(event) => setSection(sectionIndex, withLabel(section, event.target.value, sectionLabel.description))}
                className="max-w-xs font-medium"
              />
              {!disabled ? (
                <Button variant="ghost" size="sm" onClick={() => setSections(sections.filter((_, i) => i !== sectionIndex))}>
                  Remove section
                </Button>
              ) : null}
            </div>
            <ul className="flex flex-col gap-3">
              {items.map((item, itemIndex) => {
                const itemLabel = label(item)
                return (
                  <li key={itemIndex} className="flex flex-wrap items-start gap-2">
                    <Input aria-label={`Item name`} value={itemLabel.displayName} disabled={disabled} onChange={(event) => setItems(sectionIndex, items.map((it, i) => (i === itemIndex ? withLabel(it, event.target.value, itemLabel.description) : it)))} className="w-48" />
                    <Textarea aria-label={`Item description`} value={itemLabel.description} disabled={disabled} rows={1} onChange={(event) => setItems(sectionIndex, items.map((it, i) => (i === itemIndex ? withLabel(it, itemLabel.displayName, event.target.value) : it)))} className="w-56" />
                    <span className="flex items-center gap-1">
                      <span className="text-caption text-muted-foreground">{currencySymbol(currencyOf(item))}</span>
                      <Input aria-label={`Item price`} inputMode="decimal" value={readPrice(item)} disabled={disabled} onChange={(event) => setItems(sectionIndex, items.map((it, i) => (i === itemIndex ? withPrice(it, event.target.value) : it)))} className="w-24" />
                    </span>
                    {!disabled ? (
                      <Button variant="ghost" size="sm" onClick={() => setItems(sectionIndex, items.filter((_, i) => i !== itemIndex))}>
                        Remove
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
            {!disabled ? (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setItems(sectionIndex, [...items, { labels: [{ displayName: "" }] }])}>
                Add item
              </Button>
            ) : null}
          </section>
        )
      })}
      {!disabled ? (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setSections([...sections, { labels: [{ displayName: "" }], items: [] }])}>
          Add section
        </Button>
      ) : null}
    </div>
  )
}
