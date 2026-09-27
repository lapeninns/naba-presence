"use client"

import { ChevronDownIcon, ChevronUpIcon, Plus, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { FoodMenu } from "@/lib/api/location-menu"
import { cn } from "@/lib/utils"

type Json = Record<string, unknown>

/**
 * The price as the operator is typing it, kept on the item while it differs
 * from the stored price ("12." on the way to "12.50", or "12,5O" that needs
 * fixing). It never leaves the browser: `stripDraftKeys` removes it before
 * the menu is saved or compared with Google.
 */
const PRICE_TEXT_KEY = "__npPriceText"

/** An amount in the item's currency: whole units, then up to two decimals. */
const PRICE_PATTERN = /^\d{1,7}(\.\d{1,2})?$/

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

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£",
  EUR: "€",
  USD: "$",
  AUD: "$",
  CAD: "$",
  NZD: "$",
  INR: "₹",
  JPY: "¥",
}

// The item's own currency, derived from its existing price; GBP only as a
// fallback for an item that has never had a price (never rewrites another currency).
export function currencyOf(item: Json): string {
  const price = (item.attributes ?? {}) as Json
  const code = (price.price ?? {}) as Json
  return typeof code.currencyCode === "string" && code.currencyCode
    ? code.currencyCode
    : "GBP"
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

/** What the price field shows: the text being typed, else the stored price. */
function priceText(item: Json): string {
  const typed = item[PRICE_TEXT_KEY]
  return typeof typed === "string" ? typed : readPrice(item)
}

function withPriceText(item: Json, value: string): Json {
  const trimmed = value.trim()
  const attributes = { ...((item.attributes ?? {}) as Json) }
  let next: Json = { ...item }
  if (!trimmed) {
    delete attributes.price
    next = { ...next, attributes }
  } else if (PRICE_PATTERN.test(trimmed)) {
    // Preserve the item's existing currency; default GBP only for a
    // brand-new price.
    const existing = (attributes.price ?? {}) as Json
    const currencyCode =
      typeof existing.currencyCode === "string" && existing.currencyCode
        ? existing.currencyCode
        : "GBP"
    const [unitsPart, fractionPart = ""] = trimmed.split(".")
    const units = String(Number.parseInt(unitsPart || "0", 10) || 0)
    const nanos = fractionPart
      ? Math.round(Number(`0.${fractionPart}`) * 1e9)
      : 0
    attributes.price = { currencyCode, units, nanos }
    next = { ...next, attributes }
  }
  // Keep the typed text only while it reads differently from the stored
  // price, so retyping the original value leaves the item unchanged.
  if (value === readPrice(next)) delete next[PRICE_TEXT_KEY]
  else next[PRICE_TEXT_KEY] = value
  return next
}

function sectionsOf(menu: Json): Json[] {
  return Array.isArray(menu.sections) ? (menu.sections as Json[]) : []
}

function itemsOf(section: Json): Json[] {
  return Array.isArray(section.items) ? (section.items as Json[]) : []
}

/** Removes the editor's typing state so only Google's own fields remain. */
export function stripDraftKeys(menus: FoodMenu[]): FoodMenu[] {
  return menus.map((menu) => {
    if (!Array.isArray(menu.sections)) return menu
    return {
      ...menu,
      sections: (menu.sections as Json[]).map((section) => {
        if (!Array.isArray(section.items)) return section
        return {
          ...section,
          items: (section.items as Json[]).map((item) => {
            if (!(PRICE_TEXT_KEY in item)) return item
            const clean = { ...item }
            delete clean[PRICE_TEXT_KEY]
            return clean
          }),
        }
      }),
    }
  })
}

export const menuFieldId = {
  section: (s: number) => `menu-s${s}-name`,
  itemName: (s: number, i: number) => `menu-s${s}-i${i}-name`,
  itemPrice: (s: number, i: number) => `menu-s${s}-i${i}-price`,
}

export type MenuProblem = { fieldId: string; message: string }

/**
 * What must be fixed before the menu can be reviewed: every section and item
 * needs a name (Google shows nothing else to customers), and a price must
 * be an amount. Returned in reading order so the summary lists them as they
 * appear.
 */
export function validateMenu(menus: FoodMenu[]): MenuProblem[] {
  const problems: MenuProblem[] = []
  const menu = (menus[0] ?? {}) as Json
  sectionsOf(menu).forEach((section, s) => {
    const sectionName = label(section).displayName.trim()
    const where = sectionName || `Section ${s + 1}`
    if (!sectionName)
      problems.push({
        fieldId: menuFieldId.section(s),
        message: `Section ${s + 1}: name this section.`,
      })
    itemsOf(section).forEach((item, i) => {
      const itemName = label(item).displayName.trim()
      if (!itemName)
        problems.push({
          fieldId: menuFieldId.itemName(s, i),
          message: `${where}, item ${i + 1}: name this item.`,
        })
      const typed = item[PRICE_TEXT_KEY]
      if (
        typeof typed === "string" &&
        typed.trim() &&
        !PRICE_PATTERN.test(typed.trim())
      )
        problems.push({
          fieldId: menuFieldId.itemPrice(s, i),
          message: `${itemName || `${where}, item ${i + 1}`}: enter the price as an amount, like 12.50.`,
        })
    })
  })
  return problems
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [entry] = next.splice(from, 1)
  next.splice(to, 0, entry as T)
  return next
}

function FieldCaption({
  htmlFor,
  children,
}: {
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[11.5px] leading-4 font-semibold text-ink-muted"
    >
      {children}
    </label>
  )
}

function InlineError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-caption font-medium text-danger-ink">
      {message}
    </p>
  )
}

type MenuIdentities = {
  keys: ReadonlyMap<Json, string>
  nextId: number
}

function registerMenuNodes(
  sections: Json[],
  previous: MenuIdentities
): MenuIdentities {
  const nodes = sections.flatMap((section) => [section, ...itemsOf(section)])
  if (
    nodes.length === previous.keys.size &&
    nodes.every((node) => previous.keys.has(node))
  ) {
    return previous
  }
  let nextId = previous.nextId
  const keys = new Map<Json, string>()
  for (const node of nodes) {
    keys.set(node, previous.keys.get(node) ?? `menu-entry-${nextId++}`)
  }
  return { keys, nextId }
}

/**
 * The food menu editor (reference `.menu-ed`). Each section is a card with a
 * sunken head holding its name, item count and order controls; each item is
 * a bordered row inside it with name, description and price, and move and
 * remove controls that are always visible (never hover-only).
 *
 * It edits the first menu's sections and items, the parts the repo's menu
 * model covers. Anything else Google stores on them (options, attributes,
 * extra labels) is carried through untouched, and an item with options says
 * so.
 */
export function MenuEditor({
  menus,
  onChange,
  disabled,
  problems = [],
  changedPaths = [],
  validationAttempt = 0,
}: {
  menus: FoodMenu[]
  onChange: (next: FoodMenu[]) => void
  disabled: boolean
  /** Shown beside their fields once a review has been attempted. */
  problems?: MenuProblem[]
  changedPaths?: readonly string[]
  validationAttempt?: number
}) {
  const menu = (menus[0] ?? {}) as Json
  const sections = sectionsOf(menu)
  const [removeIndex, setRemoveIndex] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [changedOnly, setChangedOnly] = useState(false)
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [identity, setIdentity] = useState(() =>
    registerMenuNodes(sections, { keys: new Map(), nextId: 0 })
  )
  const registered = registerMenuNodes(sections, identity)
  if (registered !== identity) setIdentity(registered)
  function keyOf(node: Json): string {
    const key = registered.keys.get(node)
    if (!key) throw new Error("Menu entry has no navigation identity")
    return key
  }
  function carryIdentity(previous: Json, next: Json) {
    const key = keyOf(previous)
    setIdentity((current) => ({
      ...current,
      keys: new Map(current.keys).set(next, key),
    }))
  }
  const [collapsed, setCollapsed] = useState(
    () => new Set(sections.length > 8 ? sections.slice(1).map(keyOf) : [])
  )
  const [focusTarget, setFocusTarget] = useState<{ fieldId: string } | null>(
    null
  )
  const [lastValidationAttempt, setLastValidationAttempt] =
    useState(validationAttempt)
  if (validationAttempt !== lastValidationAttempt) {
    setLastValidationAttempt(validationAttempt)
    if (problems.length > 0) {
      setSearch("")
      setChangedOnly(false)
      setCollapsed(new Set())
    }
  }
  useEffect(() => {
    if (!focusTarget) return
    const target = document.getElementById(focusTarget.fieldId)
    target?.scrollIntoView?.({ block: "center" })
    target?.focus({ preventScroll: true })
  }, [focusTarget])
  const query = search.trim().toLocaleLowerCase()
  const filtering = Boolean(query) || changedOnly
  const totalItems = sections.reduce(
    (sum, section) => sum + itemsOf(section).length,
    0
  )
  function itemMatches(
    section: Json,
    sectionIndex: number,
    item: Json,
    itemIndex: number
  ) {
    if (activeItem === keyOf(item) || activeSection === keyOf(section))
      return true
    const details = label(item)
    const itemPath = `menus[0].sections[${sectionIndex}].items[${itemIndex}]`
    const changed = changedPaths.some(
      (path) =>
        path === itemPath ||
        path.startsWith(`${itemPath}.`) ||
        itemPath.startsWith(`${path}[`) ||
        itemPath.startsWith(`${path}.`)
    )
    const text =
      `${label(section).displayName} ${details.displayName} ${details.description}`.toLocaleLowerCase()
    return (!query || text.includes(query)) && (!changedOnly || changed)
  }
  const shownItems = sections.reduce(
    (sum, section, sectionIndex) =>
      sum +
      (filtering || !collapsed.has(keyOf(section))
        ? itemsOf(section).filter((item, itemIndex) =>
            itemMatches(section, sectionIndex, item, itemIndex)
          ).length
        : 0),
    0
  )
  function revealSection(index: number) {
    setSearch("")
    setChangedOnly(false)
    setCollapsed(
      (current) =>
        new Set([...current].filter((key) => key !== keyOf(sections[index])))
    )
    setFocusTarget({ fieldId: menuFieldId.section(index) })
  }

  const problemFor = (fieldId: string) =>
    problems.find((problem) => problem.fieldId === fieldId)?.message

  function setSections(next: Json[]) {
    onChange([{ ...menu, sections: next }, ...menus.slice(1)])
  }
  function setSection(index: number, section: Json) {
    carryIdentity(sections[index], section)
    setSections(sections.map((s, i) => (i === index ? section : s)))
  }
  function setItems(sectionIndex: number, items: Json[]) {
    setSection(sectionIndex, { ...sections[sectionIndex], items })
  }

  const removing = removeIndex === null ? null : sections[removeIndex]
  const removingName = removing ? label(removing).displayName.trim() : ""
  const removingCount = removing ? itemsOf(removing).length : 0

  return (
    <div className="flex flex-col gap-3.5">
      <div
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
        role="search"
        aria-label="Find menu items"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="search"
            aria-label="Search menu"
            placeholder="Search items, descriptions or sections"
            value={search}
            onChange={(event) => {
              setActiveItem(null)
              setActiveSection(null)
              setSearch(event.target.value)
            }}
            className="min-w-0 shrink-0 sm:flex-1"
          />
          <Select
            value={null}
            onValueChange={(value) => {
              if (typeof value === "string") revealSection(Number(value))
            }}
          >
            <SelectTrigger aria-label="Jump to section" className="sm:w-64">
              <SelectValue placeholder="Jump to section" />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section, index) => (
                <SelectItem key={keyOf(section)} value={String(index)}>
                  {label(section).displayName || `Section ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            checked={changedOnly}
            onCheckedChange={(checked) => setChangedOnly(Boolean(checked))}
            label="Changed items only"
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(new Set(sections.map(keyOf)))}
          >
            Collapse all sections
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(new Set())}
          >
            Expand all sections
          </Button>
          {filtering ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("")
                setChangedOnly(false)
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        <p role="status" className="text-caption text-ink-muted">
          {shownItems} of {totalItems} items shown · {sections.length} sections
          total
        </p>
        {filtering && shownItems === 0 ? (
          <p className="text-body text-ink-muted">
            No items match these filters. Saving and reviewing still includes
            your full menu.
          </p>
        ) : null}
      </div>
      {sections.map((section, sectionIndex) => {
        const items = itemsOf(section)
        const sectionLabel = label(section)
        const sectionName = sectionLabel.displayName || "this section"
        const sectionId = menuFieldId.section(sectionIndex)
        const sectionError = problemFor(sectionId)
        const sectionKey = keyOf(section)
        const expanded = filtering || !collapsed.has(sectionKey)
        const matching = items.filter((item, itemIndex) =>
          itemMatches(section, sectionIndex, item, itemIndex)
        )
        if (filtering && matching.length === 0) return null
        return (
          <section
            key={sectionKey}
            aria-label={
              sectionLabel.displayName || `Section ${sectionIndex + 1}`
            }
            className="@container/section rounded-lg border border-line bg-surface"
          >
            <div
              data-slot="field"
              className="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-line bg-surface-alt px-4 py-3"
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={expanded}
                aria-controls={`${sectionKey}-items`}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${sectionName}`}
                onClick={() => {
                  if (filtering) {
                    setSearch("")
                    setChangedOnly(false)
                  }
                  setCollapsed((current) => {
                    const next = new Set(current)
                    if (expanded) next.add(sectionKey)
                    else next.delete(sectionKey)
                    return next
                  })
                }}
              >
                {expanded ? (
                  <ChevronUpIcon aria-hidden />
                ) : (
                  <ChevronDownIcon aria-hidden />
                )}
              </Button>
              <Input
                id={sectionId}
                onFocus={() => setActiveSection(sectionKey)}
                onBlur={() => setActiveSection(null)}
                aria-label={`Section ${sectionIndex + 1} name`}
                aria-invalid={sectionError ? true : undefined}
                aria-describedby={
                  sectionError ? `${sectionId}-error` : undefined
                }
                placeholder="Section name, e.g. Starters"
                value={sectionLabel.displayName}
                disabled={disabled}
                onChange={(event) =>
                  setSection(
                    sectionIndex,
                    withLabel(
                      section,
                      event.target.value,
                      sectionLabel.description
                    )
                  )
                }
                className="min-w-0 flex-[1_1_12rem] font-semibold"
              />
              <span className="font-mono text-caption text-ink-muted tabular-nums">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
              {!disabled ? (
                <span className="ml-auto flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${sectionName} up`}
                    disabled={sectionIndex === 0}
                    onClick={() =>
                      setSections(
                        move(sections, sectionIndex, sectionIndex - 1)
                      )
                    }
                  >
                    <ChevronUpIcon aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${sectionName} down`}
                    disabled={sectionIndex === sections.length - 1}
                    onClick={() =>
                      setSections(
                        move(sections, sectionIndex, sectionIndex + 1)
                      )
                    }
                  >
                    <ChevronDownIcon aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove section ${sectionIndex + 1}`}
                    className="text-danger-ink hover:not-data-disabled:bg-danger-tint"
                    onClick={() =>
                      items.length > 0
                        ? setRemoveIndex(sectionIndex)
                        : setSections(
                            sections.filter((_, i) => i !== sectionIndex)
                          )
                    }
                  >
                    <Trash2Icon aria-hidden />
                  </Button>
                </span>
              ) : null}
              {sectionError ? (
                <div className="basis-full">
                  <InlineError
                    id={`${sectionId}-error`}
                    message={sectionError}
                  />
                </div>
              ) : null}
            </div>

            {expanded ? (
              <div
                id={`${sectionKey}-items`}
                className="flex flex-col gap-2.5 p-4"
              >
                {items.length === 0 ? (
                  <p className="text-caption text-ink-muted">
                    No items in this section yet.
                  </p>
                ) : null}
                {items.map((item, itemIndex) => {
                  if (!itemMatches(section, sectionIndex, item, itemIndex))
                    return null
                  const itemLabel = label(item)
                  const itemName =
                    itemLabel.displayName || `item ${itemIndex + 1}`
                  const nameId = menuFieldId.itemName(sectionIndex, itemIndex)
                  const priceId = menuFieldId.itemPrice(sectionIndex, itemIndex)
                  const descriptionId = `menu-s${sectionIndex}-i${itemIndex}-description`
                  const nameError = problemFor(nameId)
                  const priceError = problemFor(priceId)
                  const currency = currencyOf(item)
                  const options = Array.isArray(item.options)
                    ? item.options.length
                    : 0
                  const updateItem = (next: Json) => {
                    carryIdentity(item, next)
                    setItems(
                      sectionIndex,
                      items.map((it, i) => (i === itemIndex ? next : it))
                    )
                  }
                  return (
                    <div
                      key={keyOf(item)}
                      onFocusCapture={() => setActiveItem(keyOf(item))}
                      onBlurCapture={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                          setActiveItem(null)
                      }}
                      className="rounded-md border border-line bg-surface p-3"
                    >
                      <div
                        className={cn(
                          "grid grid-cols-1 items-start gap-x-3 gap-y-2.5 @[26rem]/section:grid-cols-[minmax(0,1fr)_auto]",
                          "@[46rem]/section:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_8rem_auto]"
                        )}
                      >
                        <div
                          data-slot="field"
                          className="flex min-w-0 flex-col gap-1"
                        >
                          <FieldCaption htmlFor={nameId}>
                            Item name
                          </FieldCaption>
                          <Input
                            id={nameId}
                            aria-label={`Item name — section ${sectionIndex + 1}, item ${itemIndex + 1}`}
                            aria-invalid={nameError ? true : undefined}
                            aria-describedby={
                              nameError ? `${nameId}-error` : undefined
                            }
                            placeholder="Item"
                            value={itemLabel.displayName}
                            disabled={disabled}
                            onChange={(event) =>
                              updateItem(
                                withLabel(
                                  item,
                                  event.target.value,
                                  itemLabel.description
                                )
                              )
                            }
                          />
                          <InlineError
                            id={`${nameId}-error`}
                            message={nameError}
                          />
                        </div>

                        <div
                          className={cn(
                            "row-start-2 flex min-w-0 flex-col gap-1 @[26rem]/section:col-span-2",
                            "@[46rem]/section:col-span-1 @[46rem]/section:col-start-2 @[46rem]/section:row-start-1"
                          )}
                        >
                          <FieldCaption htmlFor={descriptionId}>
                            Description
                          </FieldCaption>
                          <Textarea
                            id={descriptionId}
                            aria-label={`Description — section ${sectionIndex + 1}, item ${itemIndex + 1}`}
                            placeholder="Description"
                            value={itemLabel.description}
                            disabled={disabled}
                            rows={1}
                            onChange={(event) =>
                              updateItem(
                                withLabel(
                                  item,
                                  itemLabel.displayName,
                                  event.target.value
                                )
                              )
                            }
                            // Grows with its content where the browser can
                            // (`field-sizing`), so a two-line description is
                            // read rather than half-shown behind a scrollbar.
                            className="field-sizing-content min-h-(--np-field-h)"
                          />
                        </div>

                        <div
                          data-slot="field"
                          className={cn(
                            "row-start-3 flex max-w-48 min-w-0 flex-col gap-1",
                            "@[46rem]/section:col-start-3 @[46rem]/section:row-start-1 @[46rem]/section:max-w-none"
                          )}
                        >
                          <FieldCaption htmlFor={priceId}>
                            Price ({currency})
                          </FieldCaption>
                          <div className="relative">
                            <span
                              aria-hidden
                              className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 font-mono text-ui text-ink-muted"
                            >
                              {currencySymbol(currency)}
                            </span>
                            <Input
                              id={priceId}
                              aria-label={`Price (${currency}) — section ${sectionIndex + 1}, item ${itemIndex + 1}`}
                              aria-invalid={priceError ? true : undefined}
                              aria-describedby={
                                priceError ? `${priceId}-error` : undefined
                              }
                              inputMode="decimal"
                              placeholder="0.00"
                              value={priceText(item)}
                              disabled={disabled}
                              onChange={(event) =>
                                updateItem(
                                  withPriceText(item, event.target.value)
                                )
                              }
                              className="pl-7 font-mono tabular-nums"
                            />
                          </div>
                          <InlineError
                            id={`${priceId}-error`}
                            message={priceError}
                          />
                        </div>

                        {!disabled ? (
                          <div
                            className={cn(
                              "row-start-4 flex items-center gap-0.5 justify-self-end @[26rem]/section:col-start-2 @[26rem]/section:row-start-1 @[26rem]/section:self-end",
                              "@[46rem]/section:col-start-4"
                            )}
                          >
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Move ${itemName} up`}
                              disabled={itemIndex === 0}
                              onClick={() =>
                                setItems(
                                  sectionIndex,
                                  move(items, itemIndex, itemIndex - 1)
                                )
                              }
                            >
                              <ChevronUpIcon aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Move ${itemName} down`}
                              disabled={itemIndex === items.length - 1}
                              onClick={() =>
                                setItems(
                                  sectionIndex,
                                  move(items, itemIndex, itemIndex + 1)
                                )
                              }
                            >
                              <ChevronDownIcon aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-danger-ink hover:not-data-disabled:bg-danger-tint"
                              aria-label={`Remove item ${itemIndex + 1} from section ${sectionIndex + 1}`}
                              onClick={() =>
                                setItems(
                                  sectionIndex,
                                  items.filter((_, i) => i !== itemIndex)
                                )
                              }
                            >
                              <Trash2Icon aria-hidden />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {options > 0 ? (
                        <p className="mt-2 text-caption text-ink-muted">
                          {options} {options === 1 ? "option" : "options"} from
                          Google kept as they are.
                        </p>
                      ) : null}
                    </div>
                  )
                })}
                {!disabled ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="self-start"
                    onClick={() =>
                      setItems(sectionIndex, [
                        ...items,
                        { labels: [{ displayName: "" }] },
                      ])
                    }
                  >
                    <Plus aria-hidden />
                    Add item
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>
        )
      })}
      {!disabled ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() =>
            setSections([
              ...sections,
              { labels: [{ displayName: "" }], items: [] },
            ])
          }
        >
          <Plus aria-hidden />
          Add section
        </Button>
      ) : null}

      <AlertDialog
        open={removeIndex !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveIndex(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Remove this section?</AlertDialogTitle>
          <AlertDialogDescription>
            {removingName ? `“${removingName}”` : "The section"} and its{" "}
            {removingCount} {removingCount === 1 ? "item" : "items"} leave this
            draft. Google keeps its menu until you publish, and Discard brings
            the section back.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button variant="ghost">Keep it</Button>}
            />
            <Button
              variant="danger"
              onClick={() => {
                if (removeIndex !== null)
                  setSections(sections.filter((_, i) => i !== removeIndex))
                setRemoveIndex(null)
              }}
            >
              Remove section
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
