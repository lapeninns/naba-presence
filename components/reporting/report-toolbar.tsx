"use client"

import * as React from "react"

import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"

/**
 * The scope row above a report, from `md`: who the figures are for, which
 * locations and the period, as inline fields, with a caption beside them
 * (`meta`) and secondary links after them (`extras`).
 *
 * On a phone it draws nothing. The scope there is the app bar's scope chip
 * (the one place a client or location is chosen, on every page that has a
 * scope), and the period is the one-tap `ReportPeriodStrip` under the
 * tabs, so the first screen is figures rather than a second scope control
 * and a sheet of selects. `summary` is read by nobody on screen: it is the
 * printed or saved-PDF report's one line saying what it covers.
 *
 * The exception is `phone`: the app bar hides its chip when there is only
 * one client (or location) to switch between, and the report would then
 * have no way left to choose a client or narrow to a location. The caller
 * sets `phone` in that case and the fields stack full width on a phone. It
 * marks a field that stays desk-only (the period, which the strip already
 * covers) with `max-md:hidden`; the caption and `extras` are desk-only too.
 *
 * Layout is CSS only, so the server HTML is the same at every width.
 */
export function ReportToolbar({
  summary,
  fields,
  extras,
  meta,
  phone = false,
  label = "Report scope",
  className,
}: {
  /** Short phrases naming the scope, in order; printed as one line. */
  summary: ReadonlyArray<string>
  fields: () => React.ReactNode
  extras?: React.ReactNode
  /** A caption beside the inline fields (e.g. "12 locations"). */
  meta?: React.ReactNode
  /** Also draw the fields on a phone: the app bar has no scope chip to use. */
  phone?: boolean
  label?: string
  className?: string
}) {
  const parts = summary.filter(Boolean)
  return (
    <section
      aria-label={label}
      data-slot="report-toolbar"
      className={cn(phone ? "block" : "hidden md:block print:block", className)}
    >
      {/* What the scope is, for a printed or saved PDF report. */}
      <p className="hidden text-caption text-ink-muted print:block">
        {parts.join(" · ")}
      </p>
      <div className="flex min-w-0 flex-wrap items-end gap-3 print:hidden">
        {fields()}
        {meta ? (
          <p className="pb-2.5 text-caption text-ink-muted max-md:hidden">
            {meta}
          </p>
        ) : null}
        {extras ? <div className="contents max-md:hidden">{extras}</div> : null}
      </div>
    </section>
  )
}

/**
 * The period on a phone: every choice a chip, so changing it is one tap
 * (the old way was a scope pill, a sheet, a select and its own action
 * sheet). The row scrolls sideways rather than truncating a label, and the
 * chosen period is kept in view. From `md` the toolbar's Period field takes
 * over, so the chips are `md:hidden`; the note shows at every width.
 *
 * `note` says when the period shown is not the one chosen elsewhere
 * ("Keywords count whole months: showing the last 6 months."), so a tab
 * never changes the period without saying.
 */
export function ReportPeriodStrip({
  value,
  options,
  onChange,
  note,
  className,
}: {
  value: string
  options: ReadonlyArray<{ id: string; label: string }>
  onChange: (id: string) => void
  note?: string | null
  className?: string
}) {
  return (
    <div
      data-slot="report-period-strip"
      // With no note there is nothing to draw from `md` (the chips are
      // phone-only), and an empty row would still take the tabs' gap.
      className={cn(
        "flex flex-col gap-1.5 print:hidden",
        !note && "md:hidden",
        className
      )}
    >
      <FilterChipStrip role="group" aria-label="Period" className="md:hidden">
        {options.map((option) => (
          <FilterChip
            key={option.id}
            pressed={option.id === value}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </FilterChip>
        ))}
      </FilterChipStrip>
      {note ? (
        <p
          role="status"
          data-slot="report-period-note"
          className="text-caption text-ink-muted"
        >
          {note}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The period from `md`: the first control of the toolbar's filter row, one
 * press per period, the chosen one drawn as the segment's thumb. The phone
 * has `ReportPeriodStrip`'s chips instead, so this is `max-md:hidden`. The
 * dates are not here: each tab states them from its own figures, in the zone
 * they were counted in, so the page never shows two periods that disagree.
 */
export function ReportPeriodSegments({
  value,
  options,
  onChange,
  className,
}: {
  value: string
  options: ReadonlyArray<{ id: string; label: string }>
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <SegmentedControl
      semantics="radio"
      aria-label="Period"
      fill={false}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
      className={cn("max-md:hidden print:hidden", className)}
    >
      {options.map((option) => (
        <SegmentedControlItem key={option.id} value={option.id}>
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

/** Field and trigger classes for a field drawn in the toolbar. */
export function reportToolbarFieldProps() {
  return { className: "w-full md:w-56", triggerClassName: "w-full" }
}
