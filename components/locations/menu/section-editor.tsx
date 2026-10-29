"use client"

import { ChevronDownIcon, ChevronUpIcon, Plus } from "lucide-react"

import {
  InlineError,
  RowActionsMenu,
} from "@/components/locations/menu/item-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row"
import { Textarea } from "@/components/ui/textarea"
import { readLabel } from "@/lib/locations/forms/menu-editor"

type Json = Record<string, unknown>

/**
 * One section as a settings group: its name is the group's label, with the
 * item count as the caption and the disclosure toggle and the order/remove
 * menu on the label's right. The section name field leads the group; while
 * expanded, the section description, its item rows (`children`, each an
 * `li`) and Add item follow. On a phone the group has no card chrome, only
 * the hairlines between rows; the desk keeps a bordered card. A collapsed
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
    <SettingsGroup
      label={name}
      headingAs="h3"
      caption={
        <span className="tabular-nums">
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
      }
      actions={
        <>
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
          {!disabled ? (
            <RowActionsMenu
              label={`Actions for section ${name}`}
              title={name}
              canMoveUp={sectionIndex > 0}
              canMoveDown={sectionIndex < count - 1}
              onMove={onMove}
              onRemove={onRemove}
              removeLabel="Remove section"
            />
          ) : null}
        </>
      }
      card
      bodyAs="div"
      className="@container/section mt-0 scroll-mt-20"
    >
      <SettingsRow
        label="Section name"
        controlId={ids.name}
        className="desk:px-3"
        control={
          <div data-slot="field" className="flex min-w-0 flex-col gap-1">
            <Input
              id={ids.name}
              onFocus={onActivate}
              onBlur={onDeactivate}
              aria-label={`Section name — section ${sectionIndex + 1}`}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${ids.name}-error` : undefined}
              placeholder="Section name, e.g. Starters"
              value={label.displayName}
              disabled={disabled}
              onChange={(event) => onName(event.target.value)}
              className="font-semibold"
            />
            <InlineError id={`${ids.name}-error`} message={nameError} />
          </div>
        }
      />

      {expanded ? (
        <div id={panelId} className="flex flex-col desk:px-3">
          <SettingsRow
            label={
              <>
                Section description{" "}
                <span className="font-normal text-ink-muted">(optional)</span>
              </>
            }
            controlId={ids.description}
            control={
              <Textarea
                id={ids.description}
                aria-label={`Section description (optional) — section ${sectionIndex + 1}`}
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
            }
          />
          {itemCount === 0 ? (
            <p className="py-2 text-caption text-ink-muted">
              No items in this section yet.
            </p>
          ) : (
            <ul
              aria-label={`Items in ${name}`}
              className="flex min-w-0 flex-col border-y border-line-subtle"
            >
              {children}
            </ul>
          )}
          {!disabled ? (
            <Button
              variant="ghost"
              size="sm"
              className="my-2 self-start"
              onClick={onAddItem}
            >
              <Plus aria-hidden />
              Add item
            </Button>
          ) : null}
        </div>
      ) : null}
    </SettingsGroup>
  )
}
