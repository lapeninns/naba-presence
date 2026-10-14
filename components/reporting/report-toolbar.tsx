"use client"

import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/** Where the toolbar is drawing its fields. */
export type ReportToolbarPlacement = "bar" | "sheet"

/**
 * The one row above a report: who the figures are for, which locations, and
 * the period, with the report's actions (Share report) at the end.
 *
 * On a phone the scope is a single summary button ("All clients · 12
 * locations · Last 28 days") that opens a bottom sheet holding the fields,
 * so the first screen is figures rather than controls. From `md` the same
 * fields sit inline in the row. Layout is CSS only: the inline fields are
 * always in the document and hidden below `md`; the sheet copy exists only
 * while it is open.
 *
 * `fields` is called once per placement so a field can fill the sheet and
 * keep its toolbar width in the bar. `extras` (secondary links) follow the
 * fields: inline from `md`, at the foot of the sheet on a phone. `actions`
 * stay in the row at every width.
 */
export function ReportToolbar({
  summary,
  fields,
  extras,
  actions,
  meta,
  label = "Report scope",
  sheetDescription = "Choose whose figures to show and for which period.",
  className,
}: {
  /** Short phrases naming the scope, in order; the last never truncates. */
  summary: ReadonlyArray<string>
  fields: (placement: ReportToolbarPlacement) => React.ReactNode
  extras?: React.ReactNode
  actions?: React.ReactNode
  /** A caption beside the inline fields (e.g. "12 locations"); `md` and up. */
  meta?: React.ReactNode
  label?: string
  sheetDescription?: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const parts = summary.filter(Boolean)
  const last = parts.length - 1

  return (
    <section
      aria-label={label}
      data-slot="report-toolbar"
      className={cn(
        "flex items-center gap-2 md:flex-wrap md:items-end md:gap-3",
        className
      )}
    >
      {/* Phone: the scope in one tappable line. The visible words are the
          start of the accessible name (WCAG 2.5.3); truncation is CSS only,
          so the full scope is still what a screen reader hears. Parts wrap
          to a second line before any one of them is cut short. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            // One quiet pill row (the scope switcher): the grey fill, not a
            // bordered control, so the figures stay the loudest thing.
            <Button
              variant="ghost"
              pill
              className="h-auto min-h-(--np-touch) min-w-0 flex-1 justify-start bg-fill-secondary py-2 font-normal md:hidden print:hidden"
            />
          }
        >
          <SlidersHorizontalIcon
            aria-hidden
            strokeWidth={1.75}
            className="text-ink-secondary"
          />
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1 text-left">
            {parts.map((part, index) => (
              <React.Fragment key={`${index}-${part}`}>
                {index > 0 ? (
                  <>
                    {" "}
                    <span aria-hidden className="shrink-0 text-ink-muted">
                      ·
                    </span>
                    <span className="sr-only">,</span>{" "}
                  </>
                ) : null}
                <span
                  className={cn(
                    index === last ? "whitespace-nowrap" : "max-w-full truncate"
                  )}
                >
                  {part}
                </span>
              </React.Fragment>
            ))}
          </span>
          <ChevronDownIcon
            aria-hidden
            strokeWidth={1.75}
            className="ml-auto text-ink-muted"
          />
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{label}</SheetTitle>
            <SheetDescription>{sheetDescription}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {fields("sheet")}
            {extras ? (
              <div className="flex flex-col gap-2 *:w-full">{extras}</div>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <SheetClose render={<Button block className="sm:w-auto" />}>
              Done
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* What the summary says, for a printed or saved PDF report. */}
      <p className="hidden text-caption text-ink-muted print:block">
        {parts.join(" · ")}
      </p>

      {/* From md: the fields themselves, inline. */}
      <div className="hidden min-w-0 flex-wrap items-end gap-3 md:flex">
        {fields("bar")}
        {meta ? (
          <p className="pb-2.5 text-caption text-ink-muted">{meta}</p>
        ) : null}
        {extras}
      </div>

      {actions ? (
        <div className="flex shrink-0 items-center gap-2 md:ml-auto">
          {actions}
        </div>
      ) : null}
    </section>
  )
}

/** Field and trigger classes for a field drawn in the toolbar. */
export function reportToolbarFieldProps(placement: ReportToolbarPlacement) {
  return placement === "sheet"
    ? { className: "w-full", triggerClassName: "w-full" }
    : { className: "w-56", triggerClassName: "w-full" }
}
