import {
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Separator,
} from "NabaReview"
import {
  Building2,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Info,
} from "lucide-react"

const PRESETS = [
  { label: "Last 7 days", hint: "12 reviews", on: false },
  { label: "Last 30 days", hint: "39 reviews", on: true },
  { label: "Last 90 days", hint: "128 reviews", on: false },
  { label: "Year to date", hint: "241 reviews", on: false },
]

/**
 * The range control above the review queue. `align="start"` pins the popup to
 * the trigger's leading edge so the list reads as an extension of the button.
 */
export function DateRangePicker() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" />}>
        <CalendarDays />
        Last 30 days
        <ChevronsUpDown />
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Date range</PopoverTitle>
          <PopoverDescription>
            Applies to the queue and the response-rate chart.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex flex-col gap-1">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              className={
                p.on
                  ? "h-auto w-full justify-between rounded-xl bg-muted px-3 py-2 text-left"
                  : "h-auto w-full justify-between rounded-xl px-3 py-2 text-left font-normal"
              }
            >
              <span className="flex items-center gap-2">
                {p.on ? (
                  <Check className="size-4 text-primary" />
                ) : (
                  <span className="size-4" />
                )}
                <span className={p.on ? "font-medium" : undefined}>{p.label}</span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {p.hint}
              </span>
            </Button>
          ))}
        </div>
        <Separator />
        <span className="font-mono text-xs text-muted-foreground">
          16 Apr — 15 May 2024
        </span>
      </PopoverContent>
    </Popover>
  )
}

const LOCATIONS = [
  { name: "Lapen Inn — Central", meta: "64 reviews · 4.7", on: true },
  { name: "Lapen Inn — Riverside", meta: "39 reviews · 4.4", on: false },
  { name: "Lapen Inn — Airport", meta: "25 reviews · 4.8", on: false },
]

/**
 * A switcher with enough metadata per row that a plain menu would feel cramped.
 * Popover is the right primitive once rows carry two lines and a badge.
 */
export function LocationSwitcher() {
  return (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline" />}>
        <Building2 />
        Lapen Inn — Central
        <ChevronsUpDown />
      </PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Switch location</PopoverTitle>
        </PopoverHeader>
        <div className="flex flex-col gap-1">
          {LOCATIONS.map((l) => (
            <Button
              key={l.name}
              variant="ghost"
              className={
                l.on
                  ? "h-auto w-full justify-between rounded-xl bg-muted px-3 py-2 text-left"
                  : "h-auto w-full justify-between rounded-xl px-3 py-2 text-left font-normal"
              }
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={l.on ? "truncate font-medium" : "truncate"}>
                  {l.name}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {l.meta}
                </span>
              </span>
              {l.on ? <Check className="size-4 shrink-0 text-primary" /> : null}
            </Button>
          ))}
        </div>
        <Separator />
        <span className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">All locations</span>
          <Badge variant="secondary">128</Badge>
        </span>
      </PopoverContent>
    </Popover>
  )
}

/**
 * `side="right"` for an explainer hung off an icon button, where a popup below
 * would cover the number it is explaining. `sideOffset` is measured from the
 * trigger, so raise it to clear the padding of the card the trigger sits in.
 */
export function MetricExplainer() {
  return (
    <div className="flex w-fit items-center gap-2 rounded-2xl border border-border p-3">
      <span className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Median time to reply</span>
        <span className="font-mono text-2xl">6h 41m</span>
      </span>
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <Info />
          <span className="sr-only">How this is measured</span>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" sideOffset={20}>
          <PopoverHeader>
            <PopoverTitle>How this is measured</PopoverTitle>
            <PopoverDescription>
              Median hours between a review appearing on Google and your reply being
              published. Escalated reviews are included.
            </PopoverDescription>
          </PopoverHeader>
          <Separator />
          <span className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Target</span>
            <span className="font-mono text-xs text-success">under 8h</span>
          </span>
        </PopoverContent>
      </Popover>
    </div>
  )
}
