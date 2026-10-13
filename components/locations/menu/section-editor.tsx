"use client"

import { ChevronDownIcon, ChevronUpIcon, Plus } from "lucide-react"

import {
  FieldCaption,
  InlineError,
  RowActionsMenu,
} from "@/components/locations/menu/item-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readLabel } from "@/lib/locations/forms/menu-editor"

type Json = Record<string, unknown>

/**
 * One section as a group: a label row with the disclosure toggle, the
 * section name (the group's label, edited in place), its item count and the
 * order/remove menu; then, while expanded, the section description, its
 * item rows (`children`, each an `li`) and Add item. On a phone the group
 * has no card chrome, only the hairlines between rows; the desk keeps a
 * bordered card. A collapsed section unmounts its fields; the draft keeps
 * everything typed in them.
 */
export function MenuSectionEditor({
  section,
  sectionIndex,
  count,
  itemCount,
  panelId,
  ids,
  expanded,
  disabled,
  nameError,
  onToggle,
  onName,
  onDescription,
  onMove,
  onRemove,
  onAddItem,
  onActivate,
  onDeactivate,
  children,
}: {
  section: Json
  sectionIndex: number
  count: number
  itemCount: number
  panelId: string
  ids: { name: string; description: string }
  expanded: boolean
  disabled: boolean
  nameError?: string
  onToggle: () => void
  onName: (value: string) => void
  onDescription: (value: string) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onAddItem: () => void
  onActivate: () => void
  onDeactivate: () => void
  children: React.ReactNode
}) {
  const label = readLabel(section)
  const name = label.displayName || `Section ${sectionIndex + 1}`
  const toggleName = label.displayName || "this section"

  return (
    <section
      aria-label={name}
      className="@container/section flex scroll-mt-20 flex-col gap-2 desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:p-(--np-card-pad)"
    >
      <div data-slot="field" className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${toggleName}`}
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronUpIcon aria-hidden />
          ) : (
            <ChevronDownIcon aria-hidden />
          )}
        </Button>
        <Input
          id={ids.name}
          onFocus={onActivate}
          onBlur={onDeactivate}
          aria-label={`Section ${sectionIndex + 1} name`}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${ids.name}-error` : undefined}
          placeholder="Section name, e.g. Starters"
          value={label.displayName}
          disabled={disabled}
          onChange={(event) => onName(event.target.value)}
          className="min-w-0 grow basis-48 font-semibold"
        />
        <span className="text-caption text-ink-muted tabular-nums">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        {!disabled ? (
          <span className="ml-auto">
            <RowActionsMenu
              label={`Actions for section ${name}`}
              title={name}
              canMoveUp={sectionIndex > 0}
              canMoveDown={sectionIndex < count - 1}
              onMove={onMove}
              onRemove={onRemove}
              removeLabel="Remove section"
            />
          </span>
        ) : null}
        {nameError ? (
          <div className="basis-full">
            <InlineError id={`${ids.name}-error`} message={nameError} />
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div id={panelId} className="flex flex-col gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <FieldCaption htmlFor={ids.description}>
              Section description{" "}
              <span className="font-normal">(optional)</span>
            </FieldCaption>
            <Textarea
              id={ids.description}
              aria-label={`Section ${sectionIndex + 1} description`}
              placeholder="A short introduction to this section"
              value={label.description}
              disabled={disabled}
              // Two lines is the shortest start that clears the touch field
              // height without overriding the primitive's own minimum.
              autoSize
              minRows={2}
              maxRows={6}
              onChange={(event) => onDescription(event.target.value)}
            />
          </div>
          {itemCount === 0 ? (
            <p className="py-2 text-caption text-ink-muted">
              No items in this section yet.
            </p>
          ) : (
            <ul
              aria-label={`Items in ${name}`}
              className="flex flex-col divide-y divide-line-subtle border-y border-line-subtle"
            >
              {children}
            </ul>
          )}
          {!disabled ? (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={onAddItem}
            >
              <Plus aria-hidden />
              Add item
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
