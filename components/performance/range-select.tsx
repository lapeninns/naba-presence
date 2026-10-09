"use client"

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * A report's period (reference `Period` field): a visible label over the
 * select, which also names it (only one tab's panel is mounted at a time).
 * Reply and Google performance share their presets; Keywords counts in
 * whole months (see lib/reporting/ranges). `period` is the dates the choice
 * resolves to, shown under it, so "Last 28 days" is never a guess.
 */
export function RangeSelect<T extends string>({
  value,
  onChange,
  options,
  period,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ id: T; label: string }>
  /** The resolved dates, e.g. "4 Aug – 31 Aug". */
  period?: string
}) {
  return (
    <Field className="min-w-40 flex-1 sm:flex-none">
      <FieldLabel>Period</FieldLabel>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger className="w-full sm:w-44">
          <SelectValue>
            {(selected: T | null) =>
              options.find((option) => option.id === selected)?.label ?? ""
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {period ? (
        <FieldDescription className="font-mono tabular-nums">
          {period}
        </FieldDescription>
      ) : null}
    </Field>
  )
}
