"use client"

import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react"

import { MenuItemEditor } from "@/components/locations/menu/item-editor"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { moveBy, readLabel, withLabel, type EditorItem, type EditorSection, type MenuIssue } from "@/lib/locations/forms/menu-editor"
import { cn } from "@/lib/utils"

export function MenuSectionEditor({ section, index, count, idPrefix, collapsed, disabled, issues, onToggle, onChange, onMove, onRemove, onAddItem, onDuplicateItem, onRemoveItem }: {
  section: EditorSection
  index: number
  count: number
  idPrefix: string
  collapsed: boolean
  disabled: boolean
  issues: MenuIssue[]
  onToggle: () => void
  onChange: (section: EditorSection) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onAddItem: () => void
  onDuplicateItem: (item: EditorItem, index: number) => void
  onRemoveItem: (item: EditorItem, index: number) => void
}) {
  const label = readLabel(section.data)
  const name = label.displayName.trim() || `Section ${index + 1}`
  const id = `${idPrefix}-${section.id}`
  const sectionIssues = issues.filter((issue) => issue.sectionId === section.id)
  const nameError = sectionIssues.find((issue) => issue.nodeId === section.id)?.message

  return (
    <section id={id} className="min-w-0 scroll-mt-20 overflow-hidden rounded-(--np-radius-card) bg-surface" aria-labelledby={`${id}-heading`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-(--np-card-pad) py-3">
        <h3 id={`${id}-heading`} className="min-w-0 flex-1">
          <button id={`${id}-toggle`} type="button" aria-expanded={!collapsed} aria-controls={`${id}-panel`} onClick={onToggle} className="flex min-h-11 w-full items-center gap-2 rounded-(--np-radius-control) text-left focus-halo sm:min-h-8">
            <ChevronDown aria-hidden strokeWidth={1.75} className={cn("size-4 shrink-0 text-ink-muted", collapsed && "-rotate-90")} />
            <span className="min-w-0 break-words text-title font-semibold text-ink">{name}</span>
            <span className="shrink-0 text-caption font-normal text-ink-muted">{section.items.length} {section.items.length === 1 ? "item" : "items"}</span>
          </button>
        </h3>
        {sectionIssues.length ? <span className="text-caption text-danger-ink">{sectionIssues.length} to check</span> : null}
        {!disabled ? (
          <div className="flex items-center gap-1" role="group" aria-label={`Actions for section ${name}`}>
            <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" disabled={index === 0} aria-label={`Move section ${name} up`} title="Move section up" onClick={() => onMove(-1)}><ArrowUp aria-hidden strokeWidth={1.75} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" disabled={index === count - 1} aria-label={`Move section ${name} down`} title="Move section down" onClick={() => onMove(1)}><ArrowDown aria-hidden strokeWidth={1.75} /></Button>
            <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" aria-label={`Remove section ${name}`} title="Remove section" onClick={onRemove}><Trash2 aria-hidden strokeWidth={1.75} /></Button>
          </div>
        ) : null}
      </div>
      <div id={`${id}-panel`} hidden={collapsed}>
        {!collapsed ? (
          <>
            <div className="flex flex-col gap-4 border-b border-line-subtle bg-surface-sunken/40 p-(--np-card-pad)">
              <Field error={nameError}>
                <FieldLabel htmlFor={`${id}-name`}>Section name</FieldLabel>
                <Input id={`${id}-name`} value={label.displayName} disabled={disabled} placeholder="For example, starters" onChange={(event) => onChange({ ...section, data: withLabel(section.data, { displayName: event.target.value }) })} />
                <FieldError />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-description`}>Section description <span className="font-normal text-ink-muted">(optional)</span></FieldLabel>
                <Textarea id={`${id}-description`} rows={2} value={label.description} disabled={disabled} placeholder="A short introduction to this section" onChange={(event) => onChange({ ...section, data: withLabel(section.data, { description: event.target.value }) })} />
              </Field>
            </div>
            {section.items.length ? (
              <ol className="divide-y divide-line-subtle">
                {section.items.map((item, itemIndex) => (
                  <MenuItemEditor key={item.id} item={item} index={itemIndex} count={section.items.length} idPrefix={idPrefix} disabled={disabled} issues={sectionIssues}
                    onChange={(next) => onChange({ ...section, items: section.items.map((current) => current.id === item.id ? next : current) })}
                    onMove={(direction) => onChange({ ...section, items: moveBy(section.items, itemIndex, direction) })}
                    onDuplicate={() => onDuplicateItem(item, itemIndex)}
                    onRemove={() => onRemoveItem(item, itemIndex)} />
                ))}
              </ol>
            ) : <div className="px-(--np-card-pad) py-6"><Empty title="No items yet" description="Add the dishes or drinks that belong in this section." /></div>}
            {!disabled ? <div className="border-t border-line-subtle px-(--np-card-pad) py-3"><Button type="button" variant="secondary" size="sm" className="min-h-11 sm:min-h-8" onClick={onAddItem}><Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />Add item</Button></div> : null}
          </>
        ) : null}
      </div>
    </section>
  )
}
