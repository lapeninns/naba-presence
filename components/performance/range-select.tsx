"use client"

import { Field, FieldLabel } from "@/components/ui/field"
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
 * Each report keeps its own presets: the three endpoints take different
 * ranges, so one shared period would not fit all three.
 */
export function RangeSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ id: T; label: string }>
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
    </Field>
  )
}
