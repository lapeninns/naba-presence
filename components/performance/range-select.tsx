"use client"

import {
  ScopeSelect,
  scopeFieldInRowClassName,
} from "@/components/performance/scope-select"

/**
 * A report's period (the scope's `Period` field). Reply and Google
 * performance share their presets; Keywords counts in whole months (see
 * lib/reporting/ranges). `period` is the dates the choice resolves to, shown
 * under it, so "Last 28 days" is never a guess.
 */
export function RangeSelect<T extends string>({
  value,
  onChange,
  options,
  period,
  className = scopeFieldInRowClassName,
  triggerClassName = "sm:w-44",
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ id: T; label: string }>
  /** The resolved dates, e.g. "4 Aug – 31 Aug". */
  period?: string
  className?: string
  triggerClassName?: string
}) {
  return (
    <ScopeSelect
      label="Period"
      value={value}
      // No "all" option, so a choice is always one of `options`.
      onChange={(next) => {
        if (next) onChange(next)
      }}
      options={options}
      description={period || undefined}
      className={className}
      triggerClassName={triggerClassName}
    />
  )
}
