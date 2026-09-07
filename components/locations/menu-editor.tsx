"use client"

import { Plus, RotateCcw, Search, Trash2, UtensilsCrossed } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { MenuPreview } from "@/components/locations/menu/menu-preview"
import { MenuSectionEditor } from "@/components/locations/menu/section-editor"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel, fieldChromeClassName } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import type { FoodMenu } from "@/lib/api/location-menu"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { hydrateMenus, insertAt, menuIssues, moveBy, parseMenuPrice, readLabel, restoreRemoval, serializeMenus, withLabel, type EditorItem, type EditorMenu, type EditorSection, type MenuIssue, type Removal } from "@/lib/locations/forms/menu-editor"
import { cn } from "@/lib/utils"

// Preserve the existing helper imports used elsewhere in the repository.
export { currencyOf, currencySymbol, readPrice } from "@/lib/locations/forms/menu-editor"

export type MenuEditorValidation = { valid: boolean; hasUncommittedInput: boolean }

type EditorState = {
  source: FoodMenu[]
  menus: EditorMenu[]
  generation: number
  selected: string | null
  collapsed: ReadonlySet<string>
  pending: Removal | null
  undo: Removal | null
}

function initialState(source: FoodMenu[], generation = 0): EditorState {
  const menus = hydrateMenus(source, `g${generation}`)
  return { source, menus, generation, selected: menus[0]?.id ?? null, collapsed: new Set(menus.flatMap((menu) => menu.sections.slice(1).map((section) => section.id))), pending: null, undo: null }
}

// Called only in user-event handlers, never while rendering or during SSR.
function newId(): string { return `new-${crypto.randomUUID()}` }
function nodeName(removal: Removal): string { return readLabel(removal.node.data).displayName || `Untitled ${removal.kind}` }

/**
 * Controlled draft workspace. Source records remain passthrough; editor IDs,
 * expansion state and raw price text never enter the API payload. Raw price
 * drafts live in this tree, not mounted row components, so collapsing a
 * section or switching menus cannot discard an unfinished decimal.
 */
export function MenuEditor({ menus, onChange, disabled, onValidationChange, draftKey }: {
  menus: FoodMenu[]
  onChange: (next: FoodMenu[]) => void
  disabled: boolean
  onValidationChange?: (validation: MenuEditorValidation) => void
  draftKey?: string
}) {
  const prefix = useId()
  const [editor, setEditor] = useState(() => initialState(menus))
  const [mode, setMode] = useState("edit")
  const [search, setSearch] = useState("")
  const [announcement, setAnnouncement] = useState("")
  const cancelRef = useRef<HTMLButtonElement>(null)
  const menuSelectRef = useRef<HTMLSelectElement>(null)

  // Parent-originated replacements (Discard or a server revision) are distinct
  // from our own emitted array. Reset ephemeral state only for the former.
  if (menus !== editor.source) setEditor(initialState(menus, editor.generation + 1))

  const active = editor.menus.find((menu) => menu.id === editor.selected) ?? editor.menus[0]
  const issues = menuIssues(editor.menus)
  const valid = issues.length === 0
  const hasUncommittedInput = editor.menus.some((menu) => menu.sections.some((section) => section.items.some((item) => !parseMenuPrice(item.priceText).ok)))
  useDirtyGuard({
    key: draftKey ?? `menu-editor-${prefix}`,
    isDirty: hasUncommittedInput,
    snapshot: () => JSON.stringify(editor.menus),
  })
  useEffect(() => {
    onValidationChange?.({ valid, hasUncommittedInput })
  }, [valid, hasUncommittedInput, onValidationChange])

  function commit(next: EditorMenu[], extra: Partial<EditorState> = {}) {
    if (disabled) return
    const source = serializeMenus(next)
    setEditor({ ...editor, ...extra, source, menus: next })
    onChange(source)
  }

  function focus(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  function focusName(id: string) { focus(`${prefix}-${id}-name`) }

  function updateMenu(next: EditorMenu) {
    commit(editor.menus.map((menu) => menu.id === next.id ? next : menu))
  }

  function updateSection(next: EditorSection) {
    if (!active) return
    updateMenu({ ...active, sections: active.sections.map((section) => section.id === next.id ? next : section) })
  }

  function openSection(menuId: string, sectionId: string) {
    setMode("edit")
    setEditor((current) => ({ ...current, selected: menuId, collapsed: new Set([...current.collapsed].filter((id) => id !== sectionId)) }))
    requestAnimationFrame(() => {
      document.getElementById(`${prefix}-${sectionId}`)?.scrollIntoView({ block: "start" })
      document.getElementById(`${prefix}-${sectionId}-toggle`)?.focus({ preventScroll: true })
    })
  }

  function showIssue(issue: MenuIssue) {
    if (issue.sectionId) openSection(issue.menuId, issue.sectionId)
    else {
      setMode("edit")
      setEditor((current) => ({ ...current, selected: issue.menuId }))
    }
    focus(`${prefix}-${issue.nodeId}-${issue.field}`)
  }

  function addMenu() {
    if (disabled || editor.menus.length >= 100) return
    const menu: EditorMenu = { id: newId(), data: { labels: [{ displayName: "" }] }, sections: [] }
    commit([...editor.menus, menu], { selected: menu.id })
    setMode("edit")
    setSearch("")
    focusName(menu.id)
    setAnnouncement("New menu added. Enter its name.")
  }

  function addSection() {
    if (!active || disabled) return
    const section: EditorSection = { id: newId(), data: { labels: [{ displayName: "" }] }, items: [] }
    updateMenu({ ...active, sections: [...active.sections, section] })
    focusName(section.id)
    setAnnouncement("New section added. Enter its name.")
  }

  function addItem(section: EditorSection, duplicate?: { item: EditorItem; index: number }) {
    if (disabled) return
    const item: EditorItem = duplicate
      ? { ...duplicate.item, id: newId(), data: withLabel(duplicate.item.data, { displayName: `${readLabel(duplicate.item.data).displayName || "Item"} (copy)` }) }
      : { id: newId(), data: { labels: [{ displayName: "" }] }, priceText: "", currencyCode: "GBP" }
    updateSection({ ...section, items: insertAt(section.items, duplicate ? duplicate.index + 1 : section.items.length, item) })
    focusName(item.id)
    setAnnouncement(duplicate ? "Item duplicated. Edit the copy below." : "New item added. Enter its name.")
  }

  function askRemove(removal: Removal) {
    if (!disabled) setEditor((current) => ({ ...current, pending: removal }))
  }

  function remove() {
    const removal = editor.pending
    if (!removal || disabled) return
    const next = editor.menus.flatMap((menu) => {
      if (removal.kind === "menu") return menu.id === removal.node.id ? [] : [menu]
      if (menu.id !== removal.menuId) return [menu]
      return [{ ...menu, sections: menu.sections.flatMap((section) => {
        if (removal.kind === "section") return section.id === removal.node.id ? [] : [section]
        return [{ ...section, items: section.id === removal.sectionId ? section.items.filter((item) => item.id !== removal.node.id) : section.items }]
      }) }]
    })
    commit(next, { undo: removal, pending: null, selected: next.some((menu) => menu.id === editor.selected) ? editor.selected : (next[0]?.id ?? null) })
    setAnnouncement(`${nodeName(removal)} removed from the draft. Undo is available.`)
  }

  function undo() {
    const removal = editor.undo
    if (!removal || disabled) return
    const next = restoreRemoval(editor.menus, removal)
    const menuId = removal.kind === "menu" ? removal.node.id : removal.menuId
    const sectionId = removal.kind === "section" ? removal.node.id : removal.kind === "item" ? removal.sectionId : null
    commit(next, { undo: null, selected: menuId, collapsed: new Set([...editor.collapsed].filter((id) => id !== sectionId)) })
    setMode("edit")
    focusName(removal.node.id)
    setAnnouncement(`${nodeName(removal)} restored. Your other edits are unchanged.`)
  }

  const activeLabel = active ? readLabel(active.data) : null
  const term = search.trim().toLocaleLowerCase("en-GB")
  const navigation = active?.sections.filter((section) => {
    const label = readLabel(section.data)
    return !term || `${label.displayName} ${label.description} ${section.items.map((item) => { const value = readLabel(item.data); return `${value.displayName} ${value.description}` }).join(" ")}`.toLocaleLowerCase("en-GB").includes(term)
  }) ?? []
  const nameError = issues.find((issue) => issue.nodeId === active?.id && issue.field === "name")?.message
  const affectedCount = editor.pending?.kind === "menu"
    ? editor.pending.node.sections.reduce((count, section) => count + section.items.length, 0)
    : editor.pending?.kind === "section" ? editor.pending.node.items.length : 1

  return (
    <div data-slot="menu-editor" className="flex min-w-0 flex-col gap-5">
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {editor.undo ? (
        <Alert variant="info">
          <AlertTitle>{nodeName(editor.undo)} removed from this draft</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Undo the last removal without losing your other edits.</span>
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={undo}><RotateCcw aria-hidden strokeWidth={1.75} data-icon="inline-start" />Undo removal</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!valid ? (
        <Alert variant="destructive">
          <AlertTitle>{issues.length} {issues.length === 1 ? "field needs" : "fields need"} attention</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Check names and prices across all menus before reviewing changes.</span>
            <Button type="button" variant="secondary" size="sm" onClick={() => { if (issues[0]) showIssue(issues[0]) }}>Go to first issue</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {active && activeLabel ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Field className="min-w-0 flex-1 sm:max-w-sm">
              <FieldLabel htmlFor={`${prefix}-menu-select`}>Menu</FieldLabel>
              <select ref={menuSelectRef} id={`${prefix}-menu-select`} value={active.id} onChange={(event) => { setEditor((current) => ({ ...current, selected: event.target.value })); setSearch("") }} className={cn(fieldChromeClassName, "h-(--np-field-h) w-full px-3")}>
                {editor.menus.map((menu, index) => <option key={menu.id} value={menu.id}>{readLabel(menu.data).displayName || `Untitled menu ${index + 1}`}</option>)}
              </select>
            </Field>
            {!disabled ? <Button type="button" variant="secondary" disabled={editor.menus.length >= 100} onClick={addMenu}><Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />New menu</Button> : null}
          </div>
          {editor.menus.length >= 100 ? <p className="text-caption text-ink-muted">You have reached the limit of 100 menus.</p> : null}
          <p className="text-caption text-ink-muted">{editor.menus.length} {editor.menus.length === 1 ? "menu" : "menus"} in this draft. Review changes includes every menu, not only the selected one.</p>
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList aria-label="Menu view">
              <TabsTab value="edit">Edit menu</TabsTab>
              <TabsTab value="preview" disabled={!valid}>Preview</TabsTab>
            </TabsList>
            <TabsPanel value="edit">
              <div className="grid min-w-0 gap-6 pt-2 lg:grid-cols-[12rem_minmax(0,1fr)]">
                <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:self-start" aria-label="Sections in this menu">
                  <div className="flex items-center justify-between gap-2"><h3 className="text-title font-semibold text-ink">Sections</h3><span className="text-caption text-ink-muted tabular-nums">{active.sections.length}</span></div>
                  {active.sections.length > 4 ? <Field><FieldLabel htmlFor={`${prefix}-find-section`} className="sr-only">Find a section or item</FieldLabel><div className="relative"><Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted" /><Input id={`${prefix}-find-section`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a section or item" className="pl-9" /></div></Field> : null}
                  <nav aria-label="Jump to menu section" className="flex max-h-48 flex-col gap-1 overflow-y-auto lg:max-h-[55dvh]">
                    {navigation.map((section, index) => <Button key={section.id} type="button" variant="ghost" className="h-auto min-h-11 justify-between gap-2 py-2 text-left" onClick={() => openSection(active.id, section.id)}><span className="min-w-0 truncate">{readLabel(section.data).displayName || `Section ${index + 1}`}</span><span className="shrink-0 text-caption text-ink-muted tabular-nums">{section.items.length}</span></Button>)}
                    {term && !navigation.length ? <p className="text-caption text-ink-muted">No matching sections or items.</p> : null}
                  </nav>
                  {!disabled ? <Button type="button" variant="secondary" size="sm" onClick={addSection}><Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />Add section</Button> : null}
                </aside>
                <div className="flex min-w-0 flex-col gap-5">
                  <section className="flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)" aria-labelledby={`${prefix}-details-heading`}>
                    <div className="flex flex-wrap items-center justify-between gap-2"><h3 id={`${prefix}-details-heading`} className="text-title font-semibold text-ink">Menu details</h3>{!disabled ? <Button type="button" variant="ghost" size="sm" aria-label={`Remove menu ${activeLabel.displayName || "Untitled menu"}`} onClick={() => askRemove({ kind: "menu", node: active, index: editor.menus.indexOf(active) })}><Trash2 aria-hidden strokeWidth={1.75} data-icon="inline-start" />Remove menu</Button> : null}</div>
                    <Field error={nameError}><FieldLabel htmlFor={`${prefix}-${active.id}-name`}>Menu name</FieldLabel><Input id={`${prefix}-${active.id}-name`} value={activeLabel.displayName} disabled={disabled} placeholder="For example, lunch menu" onChange={(event) => updateMenu({ ...active, data: withLabel(active.data, { displayName: event.target.value }) })} /><FieldError /></Field>
                    <Field><FieldLabel htmlFor={`${prefix}-${active.id}-description`}>Menu description <span className="font-normal text-ink-muted">(optional)</span></FieldLabel><Textarea id={`${prefix}-${active.id}-description`} rows={2} value={activeLabel.description} disabled={disabled} placeholder="A short introduction to this menu" onChange={(event) => updateMenu({ ...active, data: withLabel(active.data, { description: event.target.value }) })} /></Field>
                  </section>
                  {active.sections.map((section, index) => <MenuSectionEditor key={section.id} section={section} index={index} count={active.sections.length} idPrefix={prefix} collapsed={editor.collapsed.has(section.id)} disabled={disabled} issues={issues}
                    onToggle={() => setEditor((current) => { const collapsed = new Set(current.collapsed); if (collapsed.has(section.id)) collapsed.delete(section.id); else collapsed.add(section.id); return { ...current, collapsed } })}
                    onChange={updateSection}
                    onMove={(direction) => { updateMenu({ ...active, sections: moveBy(active.sections, index, direction) }); setAnnouncement(`${readLabel(section.data).displayName || "Section"} moved ${direction < 0 ? "up" : "down"}.`) }}
                    onRemove={() => askRemove({ kind: "section", node: section, index, menuId: active.id })}
                    onAddItem={() => addItem(section)}
                    onDuplicateItem={(item, itemIndex) => addItem(section, { item, index: itemIndex })}
                    onRemoveItem={(item, itemIndex) => askRemove({ kind: "item", node: item, index: itemIndex, menuId: active.id, sectionId: section.id })} />)}
                  {!active.sections.length ? <div className="rounded-(--np-radius-card) bg-surface p-6"><Empty icon={<UtensilsCrossed aria-hidden />} title="Start with a section" description="Group your menu into sections such as starters, mains, or drinks. Then add the items customers can order." /></div> : null}
                </div>
              </div>
            </TabsPanel>
            <TabsPanel value="preview">{valid ? <div className="pt-2"><MenuPreview menu={active} /></div> : <p className="py-4 text-body text-ink-muted">Fix the highlighted fields before previewing this draft.</p>}</TabsPanel>
          </Tabs>
        </>
      ) : (
        <div className="flex flex-col items-center gap-5 rounded-(--np-radius-card) bg-surface px-6 py-12">
          <Empty icon={<UtensilsCrossed aria-hidden />} title="Build your first menu" description="Create a menu, organise it into sections, and add your dishes or drinks. Nothing changes on Google until you review and publish." />
          {!disabled ? <Button type="button" onClick={addMenu}><Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />Create menu</Button> : null}
        </div>
      )}
      <AlertDialog open={editor.pending !== null} onOpenChange={(open) => { if (!open) setEditor((current) => ({ ...current, pending: null })) }}>
        <AlertDialogContent initialFocus={cancelRef} finalFocus={menuSelectRef}>
          <AlertDialogTitle>Remove {editor.pending ? nodeName(editor.pending) : "this entry"}?</AlertDialogTitle>
          <AlertDialogDescription>{affectedCount} {affectedCount === 1 ? "item will" : "items will"} be removed from this draft. You can undo the last removal. Google will not change until you review and publish.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button ref={cancelRef} type="button" variant="secondary" />}>Keep editing</AlertDialogClose>
            <Button type="button" variant="destructive" disabled={disabled} onClick={remove}>Remove {editor.pending?.kind ?? "entry"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
