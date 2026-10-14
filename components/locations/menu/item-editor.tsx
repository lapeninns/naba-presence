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
import { ListRow } from "@/components/ui/list-row"
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { currencySymbol, readLabel } from "@/lib/locations/forms/menu-editor"

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

/** The words an item's price reads as in its row: what is typed, or none. */
function priceWords(currency: string, priceText: string): string {
  return priceText ? `${currencySymbol(currency)}${priceText}` : "No price"
}

/**
 * One item of a section's list: a list row with the name, the description
 * as a one-line preview and the price trailing in tabular figures, as typed.
 * The row opens the item's sheet, where its fields are edited. Move,
 * duplicate and remove stay in an always-visible overflow menu beside the
 * row (never hover-only). A problem with the item is said on the row in
 * words, so an error is never hidden behind the closed sheet; the summary's
 * link opens the sheet on the field.
 */
export function MenuItemRow({
  item,
  itemIndex,
  count,
  rowId,
  currency,
  priceText,
  disabled,
  errors,
  onOpen,
  onMove,
  onDuplicate,
  onRemove,
}: {
  item: Json
  itemIndex: number
  count: number
  /** The row's id, for focus to come back to it. */
  rowId: string
  currency: string
  priceText: string
  disabled: boolean
  /** The item's problems, once a review has been attempted. */
  errors: string[]
  onOpen: () => void
  onMove: (direction: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const label = readLabel(item)
  const name = label.displayName || `item ${itemIndex + 1}`
  const options = Array.isArray(item.options) ? item.options.length : 0
  const describedBy = [
    `${rowId}-price`,
    label.description ? `${rowId}-description` : null,
    errors.length > 0 ? `${rowId}-errors` : null,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <li
      data-slot="menu-item-row"
      className="flex min-w-0 items-start gap-1 border-b border-line-subtle last:border-b-0"
    >
      <ListRow
        as="div"
        flush
        wrap
        emphasis="neutral"
        id={rowId}
        aria-label={`Edit ${label.displayName || `untitled item ${itemIndex + 1}`}`}
        aria-describedby={describedBy}
        wrapperClassName="min-w-0 flex-1 after:hidden"
        onClick={onOpen}
        title={
          label.displayName || (
            <span className="text-ink-muted">Untitled item</span>
          )
        }
        meta={
          <span id={`${rowId}-price`}>{priceWords(currency, priceText)}</span>
        }
        preview={
          label.description ? (
            <span id={`${rowId}-description`}>{label.description}</span>
          ) : undefined
        }
        footerLayout="stack"
        footer={
          errors.length > 0 || options > 0 ? (
            <>
              {errors.length > 0 ? (
                <div id={`${rowId}-errors`} className="flex flex-col gap-0.5">
                  {errors.map((message) => (
                    <p
                      key={message}
                      className="text-caption font-medium text-danger-ink"
                    >
                      {message}
                    </p>
                  ))}
                </div>
              ) : null}
              {options > 0 ? (
                <p className="text-caption text-ink-muted">
                  {options} {options === 1 ? "option" : "options"} from Google
                  kept as they are.
                </p>
              ) : null}
            </>
          ) : undefined
        }
      />
      {!disabled ? (
        <div className="shrink-0 pt-(--np-row-mail-py)">
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
    </li>
  )
}

/**
 * The item sheet: the item's name, description and price, edited straight
 * into the draft (as the inline fields were), so closing it never loses
 * anything and needs no discard guard. A bottom sheet on a phone, a panel
 * from the right on the desk. It opens on the field it was asked for (a new
 * item's name, a summary link's field) and hands focus back to the item's
 * row when it closes.
 *
 * The price field shows the text as typed; the parent keeps it in the draft
 * so a closed sheet, a collapsed section or another selected menu never
 * loses an unfinished decimal.
 */
export function MenuItemSheet({
  open,
  onClose,
  focusId,
  rowId,
  item,
  sectionName,
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
}: {
  open: boolean
  onClose: () => void
  /** The field to focus when the sheet opens; else the sheet's default. */
  focusId?: string
  rowId: string
  item: Json
  sectionName: string
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
}) {
  const label = readLabel(item)
  const position = `section ${sectionIndex + 1}, item ${itemIndex + 1}`
  const options = Array.isArray(item.options) ? item.options.length : 0

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent
        data-slot="menu-item-sheet"
        initialFocus={() =>
          (focusId ? document.getElementById(focusId) : null) ?? true
        }
        finalFocus={() => document.getElementById(rowId) ?? true}
      >
        <SheetHeader>
          <SheetTitle className="break-words">
            {label.displayName || "Untitled item"}
          </SheetTitle>
          <SheetDescription>
            {sectionName} · item {itemIndex + 1} of {count}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
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
              className="font-medium"
            />
            <InlineError id={`${ids.name}-error`} message={nameError} />
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <FieldCaption htmlFor={ids.description}>Description</FieldCaption>
            <Textarea
              id={ids.description}
              aria-label={`Description — ${position}`}
              placeholder="Description"
              value={label.description}
              disabled={disabled}
              // Grows with its content, so a long description is read rather
              // than half-shown. Two lines is the shortest start that clears
              // the touch field height without overriding the primitive.
              autoSize
              minRows={2}
              maxRows={6}
              className="text-ink-secondary"
              onChange={(event) => onDescription(event.target.value)}
            />
          </div>

          <div
            data-slot="field"
            className="flex w-full min-w-0 flex-col gap-1 sm:max-w-48"
          >
            <FieldCaption htmlFor={ids.price}>Price ({currency})</FieldCaption>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ui text-ink-muted"
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
                className="pl-7 tabular-nums"
              />
            </div>
            <InlineError id={`${ids.price}-error`} message={priceError} />
          </div>

          {options > 0 ? (
            <p className="text-caption text-ink-muted">
              {options} {options === 1 ? "option" : "options"} from Google kept
              as they are.
            </p>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <SheetClose render={<Button>Done</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
