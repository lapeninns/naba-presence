"use client"

import { ChevronDownIcon, ChevronUpIcon, Copy, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { currencySymbol, readLabel } from "@/lib/locations/forms/menu-editor"
import { cn } from "@/lib/utils"

type Json = Record<string, unknown>

/** A visible caption for a field that also carries a positional aria-label. */
export function FieldCaption({
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
 * remove controls that are always visible (never hover-only). The price
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
          "@[46rem]/section:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_8rem_auto]"
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
            rows={1}
            onChange={(event) => onDescription(event.target.value)}
            // Grows with its content where the browser can (`field-sizing`),
            // so a two-line description is read rather than half-shown.
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
          <FieldCaption htmlFor={ids.price}>Price ({currency})</FieldCaption>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 font-mono text-ui text-ink-muted"
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
            role="group"
            aria-label={`Actions for ${name}`}
            className={cn(
              "row-start-4 flex flex-wrap items-center gap-0.5 justify-self-end @[26rem]/section:col-start-2 @[26rem]/section:row-start-1 @[26rem]/section:self-end",
              "@[46rem]/section:col-start-4"
            )}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${name} up`}
              disabled={itemIndex === 0}
              onClick={() => onMove(-1)}
            >
              <ChevronUpIcon aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Move ${name} down`}
              disabled={itemIndex === count - 1}
              onClick={() => onMove(1)}
            >
              <ChevronDownIcon aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Duplicate ${name}`}
              onClick={onDuplicate}
            >
              <Copy aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-danger-ink hover:not-data-disabled:bg-danger-tint"
              aria-label={`Remove ${name}`}
              onClick={onRemove}
            >
              <Trash2Icon aria-hidden />
            </Button>
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
