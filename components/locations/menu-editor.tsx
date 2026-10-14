"use client"

import { Plus, RotateCcw, Trash2Icon, UtensilsCrossed } from "lucide-react"
import { useEffect, useImperativeHandle, useRef, useState } from "react"

import {
  InlineError,
  MenuItemRow,
  MenuItemSheet,
} from "@/components/locations/menu/item-editor"
import { MenuPreview } from "@/components/locations/menu/menu-preview"
import { MenuSectionEditor } from "@/components/locations/menu/section-editor"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import { Textarea } from "@/components/ui/textarea"
import type { FoodMenu } from "@/lib/api/location-menu"
import {
  currencyOf as storedCurrencyOf,
  hydrateMenus,
  insertAt,
  moveBy,
  parseMenuPrice,
  readLabel,
  readPrice,
  withPrice,
} from "@/lib/locations/forms/menu-editor"

export { currencySymbol, readPrice } from "@/lib/locations/forms/menu-editor"

type Json = Record<string, unknown>

/**
 * The price as the operator is typing it, kept on the item while it differs
 * from the stored price ("12." on the way to "12.50", or "12,5O" that needs
 * fixing). It never leaves the browser: `stripDraftKeys` removes it before
 * the menu is saved or compared with Google.
 */
const PRICE_TEXT_KEY = "__npPriceText"
/**
 * The currency of a price the operator cleared, so re-entering an amount in
 * the same session keeps EUR rather than falling back to GBP. Browser only,
 * like PRICE_TEXT_KEY.
 */
const CURRENCY_KEY = "__npPriceCurrency"
const DRAFT_KEYS = [PRICE_TEXT_KEY, CURRENCY_KEY] as const

/** Google accepts at most this many menus in one replacement. */
const MAX_MENUS = 100

/**
 * One group of the editor (the menu switcher, the menu's details, the find
 * bar): no card chrome on a phone, a bordered card on the desk.
 */
const GROUP_CLASS =
  "flex flex-col gap-3 desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:p-(--np-card-pad)"

/** The menu's name as the switcher shows it. */
function menuTitle(menu: Json, index: number): string {
  return readLabel(menu).displayName || `Untitled menu ${index + 1}`
}

/**
 * Change the primary label only; translations and unknown label properties
 * survive. A cleared description is removed rather than sent empty.
 */
function withLabel(node: Json, displayName: string, description: string): Json {
  const labels = Array.isArray(node.labels) ? [...(node.labels as Json[])] : []
  const first: Json = { ...((labels[0] as Json) ?? {}), displayName }
  if (description) first.description = description
  else delete first.description
  return { ...node, labels: [first, ...labels.slice(1)] }
}

/**
 * The item's currency: the one it is priced in, else the one it was priced
 * in before the operator cleared it, else GBP for a never-priced item. An
 * imported currency is never rewritten.
 */
export function currencyOf(item: Json): string {
  const remembered = item[CURRENCY_KEY]
  if (typeof remembered === "string" && remembered) {
    const stored = (item.attributes as Json | undefined)?.price
    if (!stored) return remembered
  }
  return storedCurrencyOf(item)
}

/**
 * The stored price as an editable amount: exact (never rounded to two
 * places), with a whole amount shown without a trailing ".00".
 */
function storedPriceText(item: Json): string {
  const exact = readPrice(item)
  return exact.endsWith(".00") ? exact.slice(0, -3) : exact
}

/** What the price field shows: the text being typed, else the stored price. */
function priceText(item: Json): string {
  const typed = item[PRICE_TEXT_KEY]
  return typeof typed === "string" ? typed : storedPriceText(item)
}

function withPriceText(item: Json, value: string): Json {
  const parsed = parseMenuPrice(value)
  const currency = currencyOf(item)
  const hadPrice = Boolean((item.attributes as Json | undefined)?.price)
  let next: Json = { ...item }
  if (parsed.ok && parsed.value === null) {
    if (hadPrice) {
      next = withPrice(item, "")
      // Remember a non-default currency so typing a new amount keeps it.
      if (currency !== "GBP") next[CURRENCY_KEY] = currency
    }
  } else if (parsed.ok) {
    // Exact decimal conversion; invalid text never replaces a valid price.
    next = withPrice(item, value, currency)
    delete next[CURRENCY_KEY]
  }
  // Keep the typed text only while it reads differently from the stored
  // price, so retyping the original value leaves the item unchanged.
  if (value === storedPriceText(next)) delete next[PRICE_TEXT_KEY]
  else next[PRICE_TEXT_KEY] = value
  return next
}

function sectionsOf(menu: Json): Json[] {
  return Array.isArray(menu.sections) ? (menu.sections as Json[]) : []
}

function itemsOf(section: Json): Json[] {
  return Array.isArray(section.items) ? (section.items as Json[]) : []
}

function stripItem(item: Json): Json {
  if (!DRAFT_KEYS.some((key) => key in item)) return item
  const clean = { ...item }
  for (const key of DRAFT_KEYS) delete clean[key]
  return clean
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
          items: (section.items as Json[]).map(stripItem),
        }
      }),
    }
  })
}

// The first menu keeps the ids it always had, so links into it still work.
const scope = (m: number) => (m === 0 ? "menu" : `menu-m${m}`)

export const menuFieldId = {
  menuName: (m = 0) => `menu-m${m}-title`,
  section: (s: number, m = 0) => `${scope(m)}-s${s}-name`,
  sectionDescription: (s: number, m = 0) => `${scope(m)}-s${s}-description`,
  itemName: (s: number, i: number, m = 0) => `${scope(m)}-s${s}-i${i}-name`,
  itemPrice: (s: number, i: number, m = 0) => `${scope(m)}-s${s}-i${i}-price`,
  itemDescription: (s: number, i: number, m = 0) =>
    `${scope(m)}-s${s}-i${i}-description`,
}

/** The row of an item, for focus to return to when its sheet closes. */
const itemRowId = (s: number, i: number, m = 0) =>
  `${menuFieldId.itemName(s, i, m)}-row`

/** The menu search field: focus falls back here when a filtered row is gone. */
const MENU_SEARCH_ID = "menu-search"

/** Where a field id points: its menu, and its section and item if any. */
function parseFieldId(
  fieldId: string
): { m: number; s?: number; i?: number } | null {
  const title = /^menu-m(\d+)-title$/.exec(fieldId)
  if (title) return { m: Number(title[1]) }
  const node =
    /^menu(?:-m(\d+))?-s(\d+)(?:-i(\d+))?-(?:name|price|description)$/.exec(
      fieldId
    )
  if (!node) return null
  return {
    m: node[1] === undefined ? 0 : Number(node[1]),
    s: Number(node[2]),
    i: node[3] === undefined ? undefined : Number(node[3]),
  }
}

/**
 * Opens whatever holds a field (its menu, its section, an item's sheet) and
 * resolves once the field is in the document, for ValidationSummary's
 * `onNavigate`.
 */
export type MenuFieldNavigator = (fieldId: string) => Promise<void>

/** Resolves once `id` is in the document, or after about a second. */
function whenMounted(id: string): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0
    const look = () => {
      if (document.getElementById(id) || frames++ > 60) resolve()
      else requestAnimationFrame(look)
    }
    look()
  })
}

export type MenuProblem = {
  fieldId: string
  message: string
  /** Which menu the field is in, so the editor can show that menu first. */
  menuIndex?: number
}

/**
 * What must be fixed before the menu can be reviewed: every menu, section
 * and item needs a name (Google shows nothing else to customers), and a
 * price must be an exact, non-negative amount. Every menu is checked, not
 * only the one on screen. Returned in reading order so the summary lists
 * them as they appear.
 */
export function validateMenu(menus: FoodMenu[]): MenuProblem[] {
  const problems: MenuProblem[] = []
  const several = menus.length > 1
  menus.forEach((menu, m) => {
    const menuName = readLabel(menu).displayName.trim()
    const menuWhere = menuName || `Menu ${m + 1}`
    const prefix = several ? `${menuWhere} · ` : ""
    if (!menuName)
      problems.push({
        menuIndex: m,
        fieldId: menuFieldId.menuName(m),
        message: `Menu ${m + 1}: name this menu.`,
      })
    sectionsOf(menu).forEach((section, s) => {
      const sectionName = readLabel(section).displayName.trim()
      const where = sectionName || `Section ${s + 1}`
      if (!sectionName)
        problems.push({
          menuIndex: m,
          fieldId: menuFieldId.section(s, m),
          message: `${prefix}Section ${s + 1}: name this section.`,
        })
      itemsOf(section).forEach((item, i) => {
        const itemName = readLabel(item).displayName.trim()
        if (!itemName)
          problems.push({
            menuIndex: m,
            fieldId: menuFieldId.itemName(s, i, m),
            message: `${prefix}${where}, item ${i + 1}: name this item.`,
          })
        const typed = item[PRICE_TEXT_KEY]
        const parsed = typeof typed === "string" ? parseMenuPrice(typed) : null
        if (parsed && !parsed.ok)
          problems.push({
            menuIndex: m,
            fieldId: menuFieldId.itemPrice(s, i, m),
            message: `${prefix}${itemName || `${where}, item ${i + 1}`}: ${
              /too large/.test(parsed.error)
                ? "this price is too large."
                : "enter the price as an amount, like 12.50."
            }`,
          })
      })
    })
  })
  return problems
}

type MenuIdentities = {
  keys: ReadonlyMap<Json, string>
  nextId: number
}

function registerMenuNodes(
  menus: Json[],
  previous: MenuIdentities
): MenuIdentities {
  const nodes = menus.flatMap((menu) => [
    menu,
    ...sectionsOf(menu).flatMap((section) => [section, ...itemsOf(section)]),
  ])
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

/** The last removal, restorable into the CURRENT draft (one level, session). */
type Removal =
  | { kind: "menu"; node: Json; index: number }
  | { kind: "section"; node: Json; index: number; menuKey: string }
  | {
      kind: "item"
      node: Json
      index: number
      menuKey: string
      sectionKey: string
    }

function removalName(removal: Removal): string {
  return readLabel(removal.node).displayName.trim() || `this ${removal.kind}`
}

function removalItemCount(removal: Removal): number {
  if (removal.kind === "item") return 1
  if (removal.kind === "section") return itemsOf(removal.node).length
  return sectionsOf(removal.node).reduce(
    (sum, section) => sum + itemsOf(section).length,
    0
  )
}

/**
 * The food menu workspace. Choose a menu, find a section, edit its items,
 * preview the draft, then review. The menu selector scopes editing only:
 * validation, review and publishing always cover every menu.
 *
 * Each section is a settings group whose label is its name, with the item
 * count, the disclosure and the order controls; each item is a list row
 * (name, description, price) that opens the item's sheet, with move,
 * duplicate and remove in an overflow menu that is always visible (never
 * hover-only). Removal asks first and can be undone once without losing
 * later edits. Anything else Google stores on menus, sections and items
 * (options, attributes, extra labels) is carried through untouched, and an
 * item with options says so.
 *
 * `navigatorRef` receives a `MenuFieldNavigator` for the tab's
 * ValidationSummary, so every error link opens the field's menu, section
 * or item sheet before focus moves to it.
 */
export function MenuEditor({
  menus,
  onChange,
  disabled,
  problems = [],
  changedPaths = [],
  validationAttempt = 0,
  navigatorRef,
}: {
  menus: FoodMenu[]
  onChange: (next: FoodMenu[]) => void
  disabled: boolean
  /** Shown beside their fields once a review has been attempted. */
  problems?: MenuProblem[]
  changedPaths?: readonly string[]
  validationAttempt?: number
  navigatorRef?: React.Ref<MenuFieldNavigator>
}) {
  const [search, setSearch] = useState("")
  const [changedOnly, setChangedOnly] = useState(false)
  // The item whose sheet is open (or closing), and the field it opens on.
  // An open sheet keeps its item shown under a filter, as a focused inline
  // field did.
  const [editing, setEditing] = useState<{
    key: string
    focusId?: string
    open: boolean
  } | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [view, setView] = useState<"edit" | "preview">("edit")
  const [pending, setPending] = useState<Removal | null>(null)
  const [undo, setUndo] = useState<Removal | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [identity, setIdentity] = useState(() =>
    registerMenuNodes(menus, { keys: new Map(), nextId: 0 })
  )
  const registered = registerMenuNodes(menus, identity)
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
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    menus[0] ? keyOf(menus[0]) : null
  )
  const [collapsed, setCollapsed] = useState(
    () =>
      new Set(
        menus.flatMap((menu) => {
          const sections = sectionsOf(menu)
          return sections.length > 8 ? sections.slice(1).map(keyOf) : []
        })
      )
  )
  const [focusTarget, setFocusTarget] = useState<{ fieldId: string } | null>(
    null
  )
  const removedRef = useRef(false)
  const undoRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // A draft replaced from outside (Discard, a colleague's revision, Start
  // from Google) is not ours to undo into: drop the removal history then.
  const [source, setSource] = useState(menus)
  const [emitted, setEmitted] = useState<FoodMenu[] | null>(null)
  if (menus !== source) {
    setSource(menus)
    if (menus !== emitted) {
      setUndo(null)
      setPending(null)
    }
  }

  // Selecting a menu that only exists after the parent re-renders.
  const [pendingSelect, setPendingSelect] = useState<number | null>(null)
  if (pendingSelect !== null && menus[pendingSelect]) {
    setPendingSelect(null)
    setSelectedKey(keyOf(menus[pendingSelect]))
  }
  // Opening the sheet of an item that only exists after the parent
  // re-renders (a new or duplicated item), by position as its field ids are.
  const [pendingEdit, setPendingEdit] = useState<{
    m: number
    s: number
    i: number
    focusId: string
  } | null>(null)
  if (pendingEdit) {
    const node = itemsOf(
      sectionsOf(menus[pendingEdit.m] ?? {})[pendingEdit.s] ?? {}
    )[pendingEdit.i]
    if (node) {
      setPendingEdit(null)
      setEditing({ key: keyOf(node), focusId: pendingEdit.focusId, open: true })
    }
  }

  const foundIndex = menus.findIndex(
    (menu) => registered.keys.get(menu) === selectedKey
  )
  const activeIndex = foundIndex === -1 ? 0 : foundIndex
  const menu = (menus[activeIndex] ?? {}) as Json
  const sections = sectionsOf(menu)

  const [lastValidationAttempt, setLastValidationAttempt] =
    useState(validationAttempt)
  if (validationAttempt !== lastValidationAttempt) {
    setLastValidationAttempt(validationAttempt)
    if (problems.length > 0) {
      setSearch("")
      setChangedOnly(false)
      setCollapsed(new Set())
      setView("edit")
      // Show the menu holding the first problem, so the summary's link and
      // the field's own error are on screen together.
      const here = problems.some(
        (problem) => (problem.menuIndex ?? 0) === activeIndex
      )
      const first = menus[problems[0]?.menuIndex ?? 0]
      if (!here && first) setSelectedKey(keyOf(first))
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
    if (
      (editing?.open && editing.key === keyOf(item)) ||
      activeSection === keyOf(section)
    )
      return true
    const details = readLabel(item)
    const itemPath = `menus[${activeIndex}].sections[${sectionIndex}].items[${itemIndex}]`
    const changed = changedPaths.some(
      (path) =>
        path === itemPath ||
        path.startsWith(`${itemPath}.`) ||
        itemPath.startsWith(`${path}[`) ||
        itemPath.startsWith(`${path}.`)
    )
    const text =
      `${readLabel(section).displayName} ${details.displayName} ${details.description}`.toLocaleLowerCase()
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
    setView("edit")
    setCollapsed(
      (current) =>
        new Set([...current].filter((key) => key !== keyOf(sections[index])))
    )
    setFocusTarget({ fieldId: menuFieldId.section(index, activeIndex) })
  }

  const problemFor = (fieldId: string) =>
    problems.find((problem) => problem.fieldId === fieldId)?.message

  function emit(next: FoodMenu[]) {
    if (disabled) return
    setEmitted(next)
    onChange(next)
  }
  function setMenu(next: Json) {
    carryIdentity(menu, next)
    emit(menus.map((entry, m) => (m === activeIndex ? next : entry)))
  }
  function setSections(next: Json[]) {
    setMenu({ ...menu, sections: next })
  }
  function setSection(index: number, section: Json) {
    carryIdentity(sections[index], section)
    setSections(sections.map((s, i) => (i === index ? section : s)))
  }
  function setItems(sectionIndex: number, items: Json[]) {
    setSection(sectionIndex, { ...sections[sectionIndex], items })
  }

  function addMenu() {
    if (disabled || menus.length >= MAX_MENUS) return
    const created: Json = { labels: [{ displayName: "" }] }
    emit([...menus, created])
    // The new object is registered on the next render; select it by index.
    setPendingSelect(menus.length)
    setView("edit")
    setSearch("")
    setChangedOnly(false)
    setFocusTarget({ fieldId: menuFieldId.menuName(menus.length) })
    setAnnouncement("New menu added. Enter its name.")
  }
  function addSection() {
    if (disabled) return
    setSections([...sections, { labels: [{ displayName: "" }], items: [] }])
    setSearch("")
    setChangedOnly(false)
    setFocusTarget({
      fieldId: menuFieldId.section(sections.length, activeIndex),
    })
    setAnnouncement("New section added. Enter its name.")
  }

  function addItem(sectionIndex: number, duplicateOf?: number) {
    if (disabled) return
    const items = itemsOf(sections[sectionIndex])
    const source = duplicateOf === undefined ? null : items[duplicateOf]
    const position = source ? (duplicateOf as number) + 1 : items.length
    const created: Json = source
      ? withLabel(
          source,
          `${readLabel(source).displayName || "Item"} (copy)`,
          readLabel(source).description
        )
      : { labels: [{ displayName: "" }] }
    setItems(sectionIndex, insertAt(items, position, created))
    // The new item opens in its sheet, on its name.
    setPendingEdit({
      m: activeIndex,
      s: sectionIndex,
      i: position,
      focusId: menuFieldId.itemName(sectionIndex, position, activeIndex),
    })
    setAnnouncement(
      source
        ? "Item duplicated. Edit the copy below the original."
        : "New item added. Enter its name."
    )
  }

  function remove() {
    const removal = pending
    if (!removal || disabled) return
    removedRef.current = true
    if (removal.kind === "menu") {
      emit(menus.filter((_, m) => m !== removal.index))
    } else if (removal.kind === "section") {
      setSections(sections.filter((_, s) => s !== removal.index))
    } else {
      const sectionIndex = sections.findIndex(
        (section) => keyOf(section) === removal.sectionKey
      )
      if (sectionIndex !== -1)
        setItems(
          sectionIndex,
          itemsOf(sections[sectionIndex]).filter((_, i) => i !== removal.index)
        )
    }
    setUndo(removal)
    setPending(null)
    setAnnouncement(
      `${removalName(removal)} removed from the draft. Undo is available.`
    )
  }

  function restore() {
    const removal = undo
    if (!removal || disabled) return
    setUndo(null)
    if (removal.kind === "menu") {
      const index = Math.min(removal.index, menus.length)
      emit(insertAt(menus, index, removal.node))
      setPendingSelect(index)
      setFocusTarget({ fieldId: menuFieldId.menuName(index) })
    } else {
      const m = menus.findIndex((entry) => keyOf(entry) === removal.menuKey)
      const target = menus[m]
      if (!target) {
        setAnnouncement(
          "That entry’s menu was removed, so it can’t be restored."
        )
        return
      }
      const targetSections = sectionsOf(target)
      let next: Json
      let fieldId: string
      if (removal.kind === "section") {
        const index = Math.min(removal.index, targetSections.length)
        next = {
          ...target,
          sections: insertAt(targetSections, index, removal.node),
        }
        fieldId = menuFieldId.section(index, m)
      } else {
        const s = targetSections.findIndex(
          (section) => keyOf(section) === removal.sectionKey
        )
        const section = targetSections[s]
        if (!section) {
          setAnnouncement(
            "That item’s section was removed, so it can’t be restored."
          )
          return
        }
        const items = itemsOf(section)
        const index = Math.min(removal.index, items.length)
        const restored = {
          ...section,
          items: insertAt(items, index, removal.node),
        }
        carryIdentity(section, restored)
        next = {
          ...target,
          sections: targetSections.map((entry, i) =>
            i === s ? restored : entry
          ),
        }
        // The restored item's row: its fields are in its sheet.
        fieldId = itemRowId(s, index, m)
        setCollapsed(
          (current) =>
            new Set([...current].filter((key) => key !== removal.sectionKey))
        )
      }
      carryIdentity(target, next)
      emit(menus.map((entry, i) => (i === m ? next : entry)))
      setSelectedKey(removal.menuKey)
      setFocusTarget({ fieldId })
    }
    setSearch("")
    setChangedOnly(false)
    setView("edit")
    setAnnouncement(
      `${removalName(removal)} restored. Your other edits are unchanged.`
    )
  }

  const allProblems = validateMenu(menus)
  const previewBlocked = allProblems.length > 0
  const showPreview = view === "preview" && !previewBlocked

  /**
   * ValidationSummary's `onNavigate`: for an item field that would be on
   * screen inline (its menu selected, the edit view shown, its section
   * expanded and the item not filtered out), open the item's sheet on it.
   * Nothing else changes: a field the editor isn't showing stays out of
   * reach, exactly as the inline field was.
   */
  function reveal(fieldId: string): Promise<void> {
    const at = parseFieldId(fieldId)
    if (!at || at.i === undefined || at.s === undefined)
      return Promise.resolve()
    if (at.m !== activeIndex || showPreview) return Promise.resolve()
    const section = sections[at.s]
    const item = section ? itemsOf(section)[at.i] : undefined
    if (!section || !item) return Promise.resolve()
    const expanded = filtering || !collapsed.has(keyOf(section))
    if (!expanded || !itemMatches(section, at.s, item, at.i))
      return Promise.resolve()
    setEditing({ key: keyOf(item), focusId: fieldId, open: true })
    return whenMounted(fieldId)
  }
  useImperativeHandle(navigatorRef, () => reveal)
  const menuLabel = readLabel(menu)
  const menuNameId = menuFieldId.menuName(activeIndex)
  const menuNameError = problemFor(menuNameId)
  const pendingCount = pending ? removalItemCount(pending) : 0

  // The item in the sheet, found by identity in the menu on screen: a move
  // keeps it, and a removal (or a replaced draft) closes the sheet.
  const sheet = (() => {
    if (!editing) return null
    for (const [s, section] of sections.entries()) {
      const items = itemsOf(section)
      const i = items.findIndex((item) => keyOf(item) === editing.key)
      if (i === -1) continue
      const item = items[i]!
      return {
        key: editing.key,
        open: editing.open,
        focusId: editing.focusId,
        item,
        s,
        i,
        count: items.length,
        sectionName: readLabel(section).displayName || `Section ${s + 1}`,
        update: (next: Json) => {
          carryIdentity(item, next)
          setItems(
            s,
            items.map((entry, index) => (index === i ? next : entry))
          )
        },
      }
    }
    return null
  })()

  if (menus.length === 0) {
    return (
      <Empty
        placement="page"
        icon={<UtensilsCrossed aria-hidden />}
        titleAs="h3"
        title="Build your first menu"
        description="Create a menu, organise it into sections, and add your dishes or drinks. Nothing changes on Google until you review and publish."
        action={
          disabled ? undefined : (
            <Button onClick={addMenu}>
              <Plus aria-hidden />
              Create menu
            </Button>
          )
        }
      />
    )
  }

  return (
    <div data-slot="menu-editor" className="flex min-w-0 flex-col gap-6">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {undo ? (
        <Alert variant="info">
          <AlertTitle>{removalName(undo)} removed from this draft</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Undo the last removal without losing your other edits.</span>
            <Button
              ref={undoRef}
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={restore}
            >
              <RotateCcw aria-hidden />
              Undo removal
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div data-slot="menu-toolbar" className={GROUP_CLASS}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-sm">
            <span
              id="menu-select-label"
              className="text-caption font-semibold text-ink-muted"
            >
              Menu
            </span>
            <Select
              value={keyOf(menu)}
              onValueChange={(value) => {
                if (typeof value !== "string") return
                setSelectedKey(value)
                setSearch("")
                setChangedOnly(false)
              }}
            >
              <SelectTrigger
                id="menu-select"
                aria-labelledby="menu-select-label"
                className="w-full"
              >
                <SelectValue>
                  {(value: string | null) => {
                    const m = menus.findIndex((entry) => keyOf(entry) === value)
                    return m < 0 ? "" : menuTitle(menus[m]!, m)
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent title="Menu">
                {menus.map((entry, m) => (
                  <SelectItem key={keyOf(entry)} value={keyOf(entry)}>
                    {menuTitle(entry, m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              aria-label="Menu view"
              value={showPreview ? "preview" : "edit"}
              onValueChange={(next) =>
                setView(next === "preview" ? "preview" : "edit")
              }
            >
              <SegmentedControlItem value="edit">
                Edit menu
              </SegmentedControlItem>
              <SegmentedControlItem value="preview" disabled={previewBlocked}>
                Preview
              </SegmentedControlItem>
            </SegmentedControl>
            {!disabled ? (
              <Button
                variant="secondary"
                disabled={menus.length >= MAX_MENUS}
                onClick={addMenu}
              >
                <Plus aria-hidden />
                New menu
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-caption text-ink-muted">
          {menus.length} {menus.length === 1 ? "menu" : "menus"} in this draft.
          Saving, review and publishing include every menu, not only the one
          selected.
          {menus.length >= MAX_MENUS
            ? ` Google allows at most ${MAX_MENUS} menus.`
            : ""}
          {previewBlocked && view === "preview"
            ? " Fix the names and prices that need attention to preview."
            : ""}
        </p>
      </div>

      {showPreview ? (
        <MenuPreview
          menu={hydrateMenus(stripDraftKeys([menu]), keyOf(menu))[0]!}
        />
      ) : (
        <>
          <SettingsGroup
            label="Menu details"
            headingAs="h3"
            headingId="menu-details-heading"
            actions={
              !disabled ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger-ink hover:not-data-disabled:bg-danger-tint"
                  aria-label={`Remove menu ${menuLabel.displayName || `Untitled menu ${activeIndex + 1}`}`}
                  onClick={() =>
                    setPending({ kind: "menu", node: menu, index: activeIndex })
                  }
                >
                  <Trash2Icon aria-hidden />
                  Remove menu
                </Button>
              ) : undefined
            }
            card
            bodyAs="div"
            className="mt-0"
          >
            <SettingsRow
              label="Menu name"
              controlId={menuNameId}
              className="desk:px-3"
              control={
                <div data-slot="field" className="flex min-w-0 flex-col gap-1">
                  <Input
                    id={menuNameId}
                    aria-invalid={menuNameError ? true : undefined}
                    aria-describedby={
                      menuNameError ? `${menuNameId}-error` : undefined
                    }
                    placeholder="For example, lunch menu"
                    value={menuLabel.displayName}
                    disabled={disabled}
                    onChange={(event) =>
                      setMenu(
                        withLabel(
                          menu,
                          event.target.value,
                          menuLabel.description
                        )
                      )
                    }
                  />
                  <InlineError
                    id={`${menuNameId}-error`}
                    message={menuNameError}
                  />
                </div>
              }
            />
            <SettingsRow
              label={
                <>
                  Menu description{" "}
                  <span className="font-normal text-ink-muted">(optional)</span>
                </>
              }
              controlId={`${menuNameId}-description`}
              className="desk:px-3"
              control={
                <Textarea
                  id={`${menuNameId}-description`}
                  autoSize
                  minRows={2}
                  maxRows={8}
                  placeholder="A short introduction to this menu"
                  value={menuLabel.description}
                  disabled={disabled}
                  onChange={(event) =>
                    setMenu(
                      withLabel(menu, menuLabel.displayName, event.target.value)
                    )
                  }
                />
              }
            />
          </SettingsGroup>

          {sections.length > 0 ? (
            <div
              className={GROUP_CLASS}
              role="search"
              aria-label="Find menu items"
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  id={MENU_SEARCH_ID}
                  type="search"
                  aria-label="Search menu"
                  placeholder="Search items, descriptions or sections"
                  value={search}
                  onChange={(event) => {
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
                  <SelectTrigger
                    aria-label="Jump to section"
                    className="sm:w-64"
                  >
                    <SelectValue placeholder="Jump to section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((section, index) => (
                      <SelectItem key={keyOf(section)} value={String(index)}>
                        {readLabel(section).displayName ||
                          `Section ${index + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox
                  checked={changedOnly}
                  onCheckedChange={(checked) =>
                    setChangedOnly(Boolean(checked))
                  }
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
                {shownItems} of {totalItems} items shown · {sections.length}{" "}
                sections total
              </p>
              {filtering && shownItems === 0 ? (
                <p className="text-body text-ink-muted">
                  No items match these filters. Saving and reviewing still
                  includes your full menu.
                </p>
              ) : null}
            </div>
          ) : (
            <Empty
              size="sm"
              icon={<UtensilsCrossed aria-hidden />}
              titleAs="h3"
              title="Start with a section"
              description="Group this menu into sections such as starters, mains or drinks, then add the items customers can order."
            />
          )}

          {sections.map((section, sectionIndex) => {
            const items = itemsOf(section)
            const sectionKey = keyOf(section)
            const expanded = filtering || !collapsed.has(sectionKey)
            const matching = items.filter((item, itemIndex) =>
              itemMatches(section, sectionIndex, item, itemIndex)
            )
            if (filtering && matching.length === 0) return null
            const sectionLabel = readLabel(section)
            const sectionId = menuFieldId.section(sectionIndex, activeIndex)
            return (
              <MenuSectionEditor
                key={sectionKey}
                section={section}
                sectionIndex={sectionIndex}
                count={sections.length}
                itemCount={items.length}
                panelId={`${sectionKey}-items`}
                ids={{
                  name: sectionId,
                  description: menuFieldId.sectionDescription(
                    sectionIndex,
                    activeIndex
                  ),
                }}
                expanded={expanded}
                disabled={disabled}
                nameError={problemFor(sectionId)}
                onActivate={() => setActiveSection(sectionKey)}
                onDeactivate={() => setActiveSection(null)}
                onToggle={() => {
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
                onName={(value) =>
                  setSection(
                    sectionIndex,
                    withLabel(section, value, sectionLabel.description)
                  )
                }
                onDescription={(value) =>
                  setSection(
                    sectionIndex,
                    withLabel(section, sectionLabel.displayName, value)
                  )
                }
                onMove={(direction) => {
                  setSections(moveBy(sections, sectionIndex, direction))
                  setAnnouncement(
                    `${sectionLabel.displayName || "Section"} moved ${direction < 0 ? "up" : "down"}.`
                  )
                }}
                onRemove={() =>
                  setPending({
                    kind: "section",
                    node: section,
                    index: sectionIndex,
                    menuKey: keyOf(menu),
                  })
                }
                onAddItem={() => addItem(sectionIndex)}
              >
                {items.map((item, itemIndex) => {
                  if (!itemMatches(section, sectionIndex, item, itemIndex))
                    return null
                  const itemKey = keyOf(item)
                  const nameId = menuFieldId.itemName(
                    sectionIndex,
                    itemIndex,
                    activeIndex
                  )
                  const priceId = menuFieldId.itemPrice(
                    sectionIndex,
                    itemIndex,
                    activeIndex
                  )
                  const errors = [
                    problemFor(nameId),
                    problemFor(priceId),
                  ].filter((message): message is string => Boolean(message))
                  return (
                    <MenuItemRow
                      key={itemKey}
                      item={item}
                      itemIndex={itemIndex}
                      count={items.length}
                      rowId={itemRowId(sectionIndex, itemIndex, activeIndex)}
                      currency={currencyOf(item)}
                      priceText={priceText(item)}
                      disabled={disabled}
                      errors={errors}
                      onOpen={() => setEditing({ key: itemKey, open: true })}
                      onMove={(direction) =>
                        setItems(
                          sectionIndex,
                          moveBy(items, itemIndex, direction)
                        )
                      }
                      onDuplicate={() => addItem(sectionIndex, itemIndex)}
                      onRemove={() =>
                        setPending({
                          kind: "item",
                          node: item,
                          index: itemIndex,
                          menuKey: keyOf(menu),
                          sectionKey,
                        })
                      }
                    />
                  )
                })}
              </MenuSectionEditor>
            )
          })}
          {!disabled ? (
            <Button
              variant="secondary"
              className="self-start"
              onClick={addSection}
            >
              <Plus aria-hidden />
              Add section
            </Button>
          ) : null}
        </>
      )}

      {sheet ? (
        <MenuItemSheet
          // One sheet per item: another item's sheet starts fresh.
          key={sheet.key}
          open={sheet.open && !showPreview}
          onClose={() =>
            setEditing((current) =>
              current ? { ...current, open: false } : current
            )
          }
          focusId={sheet.focusId}
          rowId={itemRowId(sheet.s, sheet.i, activeIndex)}
          fallbackFocusId={MENU_SEARCH_ID}
          item={sheet.item}
          sectionName={sheet.sectionName}
          sectionIndex={sheet.s}
          itemIndex={sheet.i}
          count={sheet.count}
          ids={{
            name: menuFieldId.itemName(sheet.s, sheet.i, activeIndex),
            price: menuFieldId.itemPrice(sheet.s, sheet.i, activeIndex),
            description: menuFieldId.itemDescription(
              sheet.s,
              sheet.i,
              activeIndex
            ),
          }}
          currency={currencyOf(sheet.item)}
          priceText={priceText(sheet.item)}
          disabled={disabled}
          nameError={problemFor(
            menuFieldId.itemName(sheet.s, sheet.i, activeIndex)
          )}
          priceError={problemFor(
            menuFieldId.itemPrice(sheet.s, sheet.i, activeIndex)
          )}
          onName={(value) =>
            sheet.update(
              withLabel(sheet.item, value, readLabel(sheet.item).description)
            )
          }
          onDescription={(value) =>
            sheet.update(
              withLabel(sheet.item, readLabel(sheet.item).displayName, value)
            )
          }
          onPrice={(value) => sheet.update(withPriceText(sheet.item, value))}
        />
      ) : null}

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent
          initialFocus={cancelRef}
          finalFocus={() => {
            if (!removedRef.current) return true
            removedRef.current = false
            return undoRef.current ?? true
          }}
        >
          <AlertDialogTitle>
            Remove {pending ? removalName(pending) : "this entry"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingCount} {pendingCount === 1 ? "item will" : "items will"} be
            removed from this draft. You can undo the last removal, and Google
            keeps its menu until you review and publish.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button ref={cancelRef} variant="ghost">
                  Keep editing
                </Button>
              }
            />
            <Button variant="danger" disabled={disabled} onClick={remove}>
              Remove {pending?.kind ?? "entry"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
