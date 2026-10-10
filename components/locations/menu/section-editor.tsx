"use client"

import { ChevronDownIcon, ChevronUpIcon, Plus, Trash2Icon } from "lucide-react"

import {
  FieldCaption,
  InlineError,
} from "@/components/locations/menu/item-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { readLabel } from "@/lib/locations/forms/menu-editor"

type Json = Record<string, unknown>

/**
 * One section card: a sunken head with the disclosure toggle, the section
 * name, its item count and order/remove controls; then, while expanded, the
 * section description, its items (`children`) and Add item. A collapsed
 * section unmounts its fields; the draft keeps everything typed in them.
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
      className="@container/section scroll-mt-20 rounded-lg border border-line bg-surface"
    >
      <div
        data-slot="field"
        className="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-line bg-surface-alt px-4 py-3"
      >
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
          className="min-w-0 flex-[1_1_12rem] font-semibold"
        />
        <span className="font-mono text-caption text-ink-muted tabular-nums">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        {!disabled ? (
          <span
            role="group"
            aria-label={`Actions for section ${name}`}
            className="ml-auto flex items-center gap-0.5"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${toggleName} up`}
              disabled={sectionIndex === 0}
              onClick={() => onMove(-1)}
            >
              <ChevronUpIcon aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${toggleName} down`}
              disabled={sectionIndex === count - 1}
              onClick={() => onMove(1)}
            >
              <ChevronDownIcon aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove section ${name}`}
              className="text-danger-ink hover:not-data-disabled:bg-danger-tint"
              onClick={onRemove}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </span>
        ) : null}
        {nameError ? (
          <div className="basis-full">
            <InlineError id={`${ids.name}-error`} message={nameError} />
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div id={panelId} className="flex flex-col gap-2.5 p-4">
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
              rows={1}
              onChange={(event) => onDescription(event.target.value)}
              className="field-sizing-content min-h-(--np-field-h)"
            />
          </div>
          {itemCount === 0 ? (
            <p className="text-caption text-ink-muted">
              No items in this section yet.
            </p>
          ) : null}
          {children}
          {!disabled ? (
            <Button
              variant="secondary"
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
