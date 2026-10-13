"use client"

import {
  ChevronDownIcon,
  ChevronUpIcon,
  Copy,
  MoreHorizontal,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { currencySymbol, readLabel } from "@/lib/locations/forms/menu-editor"
import { cn } from "@/lib/utils"

type Json = Record<string, unknown>

/**
 * A visible caption for a field that also carries a positional aria-label:
 * the Field label, drawn at caption size so a long menu stays dense. The
 * editor owns the control ids (validation and "jump to" focus them), so the
 * label points at the id it is given.
 */
export function FieldCaption({
  htmlFor,
  children,
}: {
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <FieldLabel
      htmlFor={htmlFor}
      className="text-caption font-semibold text-ink-muted"
    >
      {children}
    </FieldLabel>
  )
}

/**
 * One overflow menu for a row's ordering, copying and removal (a floating
 * menu on the desk, an action sheet on a phone). Remove is last, after a
 * separator, and still asks before anything is removed.
 */
export function RowActionsMenu({
  label,
  title,
  canMoveUp,
  canMoveDown,
  onMove,
  onDuplicate,
  onRemove,
  removeLabel,
}: {
  /** The trigger's accessible name: "Actions for Soup". */
  label: string
  /** The phone action sheet's heading. */
  title: string
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  onDuplicate?: () => void
  onRemove: () => void
  removeLabel: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} />}
      >
        <MoreHorizontal aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent title={title}>
        <DropdownMenuItem disabled={!canMoveUp} onClick={() => onMove(-1)}>
          <ChevronUpIcon aria-hidden />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canMoveDown} onClick={() => onMove(1)}>
          <ChevronDownIcon aria-hidden />
          Move down
        </DropdownMenuItem>
        {onDuplicate ? (
          <DropdownMenuItem onClick={onDuplicate}>
            <Copy aria-hidden />
            Duplicate
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          <Trash2Icon aria-hidden />
          {removeLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function InlineError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="text-caption font-medium text-danger-ink">
      {message}
    </p>
  )
}

/**
 * One item row: name, description and price, with move, duplicate and
 * remove in one always-visible overflow menu (never hover-only). The price
 * field shows the text as typed; the parent keeps it in the draft so a
 * collapsed section or another selected menu never loses an unfinished
 * decimal.
 */
export function MenuItemEditor({
  item,
  sectionIndex,
  itemIndex,
  count,
  ids,
  currency,
  priceText,
  disabled,
  nameError,
  priceError,
  onName,
  onDescription,
  onPrice,
  onMove,
  onDuplicate,
  onRemove,
  onActivate,
  onDeactivate,
}: {
  item: Json
  sectionIndex: number
  itemIndex: number
  count: number
  ids: { name: string; price: string; description: string }
  currency: string
  priceText: string
  disabled: boolean
  nameError?: string
  priceError?: string
  onName: (value: string) => void
  onDescription: (value: string) => void
  onPrice: (value: string) => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
  onActivate: () => void
  onDeactivate: () => void
}) {
  const label = readLabel(item)
  const name = label.displayName || `item ${itemIndex + 1}`
  const position = `section ${sectionIndex + 1}, item ${itemIndex + 1}`
  const options = Array.isArray(item.options) ? item.options.length : 0

  return (
    <div
      onFocusCapture={onActivate}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onDeactivate()
      }}
      className="rounded-md border border-line bg-surface p-3"
    >
      <div
        className={cn(
          "grid grid-cols-1 items-start gap-x-3 gap-y-2.5 @[26rem]/section:grid-cols-[minmax(0,1fr)_auto]",
          "@[46rem]/section:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_--spacing(32)_auto]"
        )}
      >
        <div data-slot="field" className="flex min-w-0 flex-col gap-1">
          <FieldCaption htmlFor={ids.name}>Item name</FieldCaption>
          <Input
            id={ids.name}
            aria-label={`Item name — ${position}`}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${ids.name}-error` : undefined}
            placeholder="Item"
            value={label.displayName}
            disabled={disabled}
            onChange={(event) => onName(event.target.value)}
          />
          <InlineError id={`${ids.name}-error`} message={nameError} />
        </div>

        <div
          className={cn(
            "row-start-2 flex min-w-0 flex-col gap-1 @[26rem]/section:col-span-2",
            "@[46rem]/section:col-span-1 @[46rem]/section:col-start-2 @[46rem]/section:row-start-1"
          )}
        >
          <FieldCaption htmlFor={ids.description}>Description</FieldCaption>
          <Textarea
            id={ids.description}
            aria-label={`Description — ${position}`}
            placeholder="Description"
            value={label.description}
            disabled={disabled}
            // Grows with its content, so a two-line description is read
            // rather than half-shown; starts one field high.
            autoSize
            minRows={1}
            maxRows={6}
            // A one-line start is shorter than a field on touch; the field
            // height wins over the rows' inline minimum.
            className="min-h-(--np-field-h)!"
            onChange={(event) => onDescription(event.target.value)}
          />
        </div>

        <div
          data-slot="field"
          className={cn(
            "row-start-3 flex max-w-48 min-w-0 flex-col gap-1",
            "@[46rem]/section:col-start-3 @[46rem]/section:row-start-1 @[46rem]/section:max-w-none"
          )}
        >
          <FieldCaption htmlFor={ids.price}>Price ({currency})</FieldCaption>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-ui text-ink-muted"
            >
              {currencySymbol(currency)}
            </span>
            <Input
              id={ids.price}
              aria-label={`Price (${currency}) — ${position}`}
              aria-invalid={priceError ? true : undefined}
              aria-describedby={priceError ? `${ids.price}-error` : undefined}
              inputMode="decimal"
              placeholder="No price"
              value={priceText}
              disabled={disabled}
              onChange={(event) => onPrice(event.target.value)}
              className="pl-7 font-mono tabular-nums"
            />
          </div>
          <InlineError id={`${ids.price}-error`} message={priceError} />
        </div>

        {!disabled ? (
          <div
            className={cn(
              "row-start-4 justify-self-end @[26rem]/section:col-start-2 @[26rem]/section:row-start-1 @[26rem]/section:self-end",
              "@[46rem]/section:col-start-4"
            )}
          >
            <RowActionsMenu
              label={`Actions for ${name}`}
              title={name}
              canMoveUp={itemIndex > 0}
              canMoveDown={itemIndex < count - 1}
              onMove={onMove}
              onDuplicate={onDuplicate}
              onRemove={onRemove}
              removeLabel="Remove item"
            />
          </div>
        ) : null}
      </div>
      {options > 0 ? (
        <p className="mt-2 text-caption text-ink-muted">
          {options} {options === 1 ? "option" : "options"} from Google kept as
          they are.
        </p>
      ) : null}
    </div>
  )
}
