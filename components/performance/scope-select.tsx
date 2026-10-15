"use client"

import type * as React from "react"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** The value the "all" option carries; it is never an id. */
export const SCOPE_ALL = "__all__"

export type ScopeOption<T extends string = string> = {
  id: T
  label: string
}

/**
 * One field for every report filter (Client, Location, Period): a visible
 * label over a select, which also names it; an optional "all" first option
 * standing for no filter (`undefined`); and an optional line under it, such
 * as the dates a period resolves to.
 *
 * Width is the caller's: by default the field fills its row (a bottom sheet,
 * a stacked form) and settles to `triggerWidth` from `sm` in a toolbar.
 */
export function ScopeSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  allLabel,
  description,
  className,
  triggerClassName,
}: {
  label: string
  value: T | undefined
  onChange: (next: T | undefined) => void
  options: ReadonlyArray<ScopeOption<T>>
  /** The "no filter" option's words, e.g. "All clients". Omit for a required choice. */
  allLabel?: string
  /** A line under the field, e.g. "4 Aug – 31 Aug". */
  description?: React.ReactNode
  className?: string
  triggerClassName?: string
}) {
  const selected = value ?? (allLabel ? SCOPE_ALL : undefined)
  const labelFor = (id: string | null) =>
    id && id !== SCOPE_ALL
      ? (options.find((option) => option.id === id)?.label ?? allLabel ?? "")
      : (allLabel ?? "")

  return (
    <Field className={cn("min-w-0", className)}>
      <FieldLabel>{label}</FieldLabel>
      <Select
        value={selected ?? null}
        onValueChange={(next: string | null) =>
          onChange(next && next !== SCOPE_ALL ? (next as T) : undefined)
        }
      >
        <SelectTrigger className={cn("w-full", triggerClassName)}>
          <SelectValue>{(id: string | null) => labelFor(id)}</SelectValue>
        </SelectTrigger>
        <SelectContent title={label}>
          {allLabel ? (
            <SelectItem value={SCOPE_ALL}>{allLabel}</SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description ? (
        <FieldDescription className="tabular-nums">
          {description}
        </FieldDescription>
      ) : null}
    </Field>
  )
}

/**
 * How a filter sits in a wrapping row of controls (the calendar's toolbar):
 * sharing the row on a phone, its own width from `sm`.
 */
export const scopeFieldInRowClassName = "basis-44 flex-1 sm:flex-none"
export const scopeTriggerInRowClassName = "sm:w-56"
