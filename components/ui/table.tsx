"use client"

import * as React from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/**
 * Where a cell goes when a `responsive` table becomes record cards.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [select] primary ............ trailing  actions ›│  the title line
 *   │          secondary                            │  a subtitle
 *   │          meta · meta · meta                   │  one meta line
 *   │          detail          detail               │  labelled pairs
 *   └──────────────────────────────────────────────┘
 *
 * - `primary`: the record's headline (the name, or the sort column). Never
 *   labelled. A cell with no priority that comes first (after a selection
 *   checkbox) is the primary, so a table that sets no priorities still gets
 *   an unlabelled title.
 * - `secondary`: one muted subtitle under the title (an address, an email).
 * - `trailing`: the status or the figure, at the end of the title line (a
 *   `StatusPill`, a count). Keep it to one.
 * - `actions`: an overflow menu or one icon button, at the very end.
 * - `meta`: short facts joined into ONE muted line ("Owner · Joined 3 Oct").
 *   Each shows its `label` inline before the value; pass `label=""` for a
 *   value that explains itself.
 * - `detail`: a labelled value in an even two-column grid below. This is
 *   what a cell with no priority becomes, so an untouched table keeps every
 *   value, labelled, with columns that line up from card to card.
 * - `desk-only`: dropped from the card (it belongs on the detail screen).
 * - `select`: the row's checkbox, in a 44px leading slot. Set automatically
 *   when a cell holds only a `Checkbox`.
 */
type TableCellPriority =
  | "primary"
  | "secondary"
  | "trailing"
  | "actions"
  | "meta"
  | "detail"
  | "desk-only"
  | "select"

/**
 * The record-card layout, applied below 48rem of the TABLE's own width (a
 * container query, `@max-3xl/table`): layout lives in CSS, so the server
 * HTML is right for every width and nothing flashes on hydration.
 *
 * Each row becomes a wrapping flex line. `order` places the cells by
 * priority whatever their column order; a zero-height full-width `::before`
 * on the row (order 4) is the line break between the title line and the
 * lines under it; an interactive row draws a chevron with its `::after`
 * (mux-07: the whole row was a link with no tap affordance). Detail cells
 * are exactly half the width, so a label/value pair sits at the same x in
 * every card (prim-06) and a pill can never run under its neighbour's value
 * (mux-06).
 *
 * The selectors are written out in full because Tailwind only generates a
 * class it can read in the source.
 */
const RECORD_CLASS = cn(
  // The frame: block-level table and body, one flex card per row.
  "@max-3xl/table:block @max-3xl/table:[&_tbody]:block",
  "@max-3xl/table:[&_tbody>tr]:relative @max-3xl/table:[&_tbody>tr]:flex @max-3xl/table:[&_tbody>tr]:flex-wrap @max-3xl/table:[&_tbody>tr]:items-start @max-3xl/table:[&_tbody>tr]:gap-y-0.5 @max-3xl/table:[&_tbody>tr]:px-(--np-cell-px) @max-3xl/table:[&_tbody>tr]:py-3",
  "@max-3xl/table:[&_tbody>tr]:before:order-4 @max-3xl/table:[&_tbody>tr]:before:h-0 @max-3xl/table:[&_tbody>tr]:before:basis-full @max-3xl/table:[&_tbody>tr]:before:content-['']",
  "@max-3xl/table:[&_tbody>tr>td]:block @max-3xl/table:[&_tbody>tr>td]:min-w-0 @max-3xl/table:[&_tbody>tr>td]:p-0 @max-3xl/table:[&_tbody>tr>td]:text-left",

  // The header hides; a select-all checkbox in it survives as a bar above
  // the cards (prim-05), every other header cell goes.
  "@max-3xl/table:[&_thead]:hidden @max-3xl/table:[&_thead:has([data-slot=checkbox])]:block",
  "@max-3xl/table:[&_thead_th]:hidden @max-3xl/table:[&_thead_tr]:flex",
  "@max-3xl/table:[&_thead_th:has([data-slot=checkbox])]:flex @max-3xl/table:[&_thead_th:has([data-slot=checkbox])]:h-auto @max-3xl/table:[&_thead_th:has([data-slot=checkbox])]:min-h-(--np-control-h) @max-3xl/table:[&_thead_th:has([data-slot=checkbox])]:w-full @max-3xl/table:[&_thead_th:has([data-slot=checkbox])]:items-center @max-3xl/table:[&_thead_th:has([data-slot=checkbox])]:gap-3 @max-3xl/table:[&_thead_th:has([data-slot=checkbox])]:ps-4",

  // select: a 48px leading column, out of flow so every line below the
  // title is indented past it; the checkbox's own touch extension gives
  // the 44px hit area.
  "@max-3xl/table:[&_tbody>tr:has(>td[data-priority=select])]:ps-12",
  "@max-3xl/table:[&_tbody>tr>td[data-priority=select]]:absolute @max-3xl/table:[&_tbody>tr>td[data-priority=select]]:start-0 @max-3xl/table:[&_tbody>tr>td[data-priority=select]]:top-0 @max-3xl/table:[&_tbody>tr>td[data-priority=select]]:flex @max-3xl/table:[&_tbody>tr>td[data-priority=select]]:h-full @max-3xl/table:[&_tbody>tr>td[data-priority=select]]:w-12 @max-3xl/table:[&_tbody>tr>td[data-priority=select]]:justify-center @max-3xl/table:[&_tbody>tr>td[data-priority=select]]:pt-3.5",

  // primary: the title. Explicit, or the first cell (after a checkbox)
  // when the table sets no priorities. It grows to fill the title line from
  // a 1px basis, not 0: with a zero basis it and the full-width line break
  // fit on one flex line together, and the title collapsed to nothing.
  "@max-3xl/table:[&_tbody>tr>:is(td[data-priority=primary],td:first-child:not([data-priority]),td[data-priority=select]+td:not([data-priority]))]:order-1 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=primary],td:first-child:not([data-priority]),td[data-priority=select]+td:not([data-priority]))]:flex-1 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=primary],td:first-child:not([data-priority]),td[data-priority=select]+td:not([data-priority]))]:basis-px @max-3xl/table:[&_tbody>tr>:is(td[data-priority=primary],td:first-child:not([data-priority]),td[data-priority=select]+td:not([data-priority]))]:text-body",

  // trailing and actions share the title line. Actions are forced back into
  // the flow: older tables pinned them with `absolute`, which would now sit
  // on top of the title.
  "@max-3xl/table:[&_tbody>tr>td[data-priority=trailing]]:order-2 @max-3xl/table:[&_tbody>tr>td[data-priority=trailing]]:ms-3 @max-3xl/table:[&_tbody>tr>td[data-priority=trailing]]:max-w-1/2 @max-3xl/table:[&_tbody>tr>td[data-priority=trailing]]:shrink-0 @max-3xl/table:[&_tbody>tr>td[data-priority=trailing]]:text-end",
  "@max-3xl/table:[&_tbody>tr>:is(td[data-priority=actions],td[data-actions])]:order-3 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=actions],td[data-actions])]:-my-1 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=actions],td[data-actions])]:ms-1 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=actions],td[data-actions])]:-me-1.5 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=actions],td[data-actions])]:shrink-0 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=actions],td[data-actions])]:static!",
  "@max-3xl/table:[&_tbody>tr[data-interactive]]:after:order-3 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:ms-3 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:mt-2 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:size-2 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:shrink-0 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:rotate-45 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:border-e-2 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:border-t-2 @max-3xl/table:[&_tbody>tr[data-interactive]]:after:border-ink-faint @max-3xl/table:[&_tbody>tr[data-interactive]]:after:content-['']",

  // secondary: a full-width muted subtitle.
  "@max-3xl/table:[&_tbody>tr>td[data-priority=secondary]]:order-5 @max-3xl/table:[&_tbody>tr>td[data-priority=secondary]]:basis-full @max-3xl/table:[&_tbody>tr>td[data-priority=secondary]]:text-caption @max-3xl/table:[&_tbody>tr>td[data-priority=secondary]]:text-ink-muted",

  // meta: inline facts on one muted line, "Label value · Label value". Each
  // cell stays a block (a flex item) with INLINE content: an inline-flex
  // cell made every child its own flex item and collapsed the spaces
  // between them ("No.1by impressions").
  "@max-3xl/table:[&_tbody>tr>td[data-priority=meta]]:order-6 @max-3xl/table:[&_tbody>tr>td[data-priority=meta]]:text-caption @max-3xl/table:[&_tbody>tr>td[data-priority=meta]]:text-ink-muted",
  "@max-3xl/table:[&_tbody>tr>td[data-priority=meta][data-label]]:before:me-1 @max-3xl/table:[&_tbody>tr>td[data-priority=meta][data-label]]:before:content-[attr(data-label)]",
  "@max-3xl/table:[&_tbody>tr>td[data-priority=meta]:has(~td[data-priority=meta])]:after:mx-1.5 @max-3xl/table:[&_tbody>tr>td[data-priority=meta]:has(~td[data-priority=meta])]:after:content-['·']",

  // detail: labelled values in an even two-column grid; `span` takes the
  // whole width. Every cell without a priority (other than the title and
  // actions) lands here.
  "@max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))]:order-7 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))]:basis-1/2 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))]:pe-3 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))]:pt-2 @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))]:[overflow-wrap:anywhere]",
  "@max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))[data-span]]:basis-full",
  "@max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))[data-label]]:before:block @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))[data-label]]:before:text-caption @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))[data-label]]:before:font-medium @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))[data-label]]:before:text-ink-muted @max-3xl/table:[&_tbody>tr>:is(td[data-priority=detail],td:not([data-priority]):not([data-actions]):not(:first-child):not([data-priority=select]+td))[data-label]]:before:content-[attr(data-label)]",

  // desk-only: not on the card.
  "@max-3xl/table:[&_tbody>tr>td[data-priority=desk-only]]:hidden",

  // A group-header row stays one full-width band.
  "@max-3xl/table:[&_tbody>tr[data-group]]:block @max-3xl/table:[&_tbody>tr[data-group]]:bg-surface-alt @max-3xl/table:[&_tbody>tr[data-group]]:py-2 @max-3xl/table:[&_tbody>tr[data-group]]:before:hidden"
)

/**
 * Whether a box scrolls sideways right now. Behaviour, not layout: it only
 * decides whether the box is a tab stop, and it starts `false` on the server
 * and the client alike, so there is no hydration mismatch.
 */
function useScrollsHorizontally(ref: React.RefObject<HTMLElement | null>) {
  const [scrolls, setScrolls] = React.useState(false)
  React.useEffect(() => {
    const box = ref.current
    if (!box) return
    const update = () => setScrolls(box.scrollWidth - box.clientWidth > 1)
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(box)
    // The table inside grows with its content, not the box.
    if (box.firstElementChild) observer.observe(box.firstElementChild)
    return () => observer.disconnect()
  }, [ref])
  return scrolls
}

/**
 * Tables (reference `.table-wrap` / `.table`).
 *
 * `surface` draws the table on its own white card with a hairline edge; the
 * scroll container and the card are one box, so a wide table scrolls inside
 * its card. The container is also a size container (`@container/table`).
 *
 * `responsive` turns each row into a RECORD CARD when the table's own
 * container is narrower than 48rem: a title line (the primary cell, a
 * trailing status or figure, the actions, a chevron on a clickable row), an
 * optional subtitle, one meta line and labelled details. Give cells a
 * `priority` to choose where each goes (see `TableCellPriority`); a table
 * that sets none still gets an unlabelled title and an even two-column grid
 * of labelled values. Give each `TableCell` a `label` (DataTable does this
 * from the column header).
 *
 * The scroll container is a tab stop (axe `scrollable-region-focusable`)
 * only while it actually scrolls sideways; a card list that fits is not an
 * empty stop before the first record (listing-admin-profile-23).
 *
 * `containerClassName` reaches the scroll box, for bounding the scroll port.
 */
function Table({
  className,
  surface = false,
  responsive = false,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  surface?: boolean
  /** Record cards below 48rem of container width. */
  responsive?: boolean
  containerClassName?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const scrolls = useScrollsHorizontally(ref)
  return (
    <div
      ref={ref}
      data-slot="table-container"
      data-scrolls={scrolls || undefined}
      className={cn(
        "@container/table w-full min-w-0 overflow-x-auto focus-halo",
        surface && "rounded-(--np-radius-card) border border-line bg-surface",
        containerClassName
      )}
      tabIndex={scrolls ? 0 : undefined}
    >
      <table
        data-slot="table"
        data-responsive={responsive || undefined}
        className={cn(
          "w-full caption-bottom border-collapse text-ui text-ink",
          responsive && RECORD_CLASS,
          className
        )}
        {...props}
      />
    </div>
  )
}

/**
 * The header row sits on the sunken surface (reference `thead th`): caption
 * semibold muted labels. `sticky` pins it while a long table scrolls inside
 * its own scroll port.
 */
function TableHeader({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"thead"> & { sticky?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "[&_th]:border-b [&_th]:border-line [&_th]:bg-(--np-table-header-bg) [&_tr:hover]:bg-transparent",
        sticky && "[&_th]:sticky [&_th]:top-0 [&_th]:z-sticky",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

/**
 * `interactive` marks a row the whole of which is a target (DataTable sets it
 * when `onRowClick` is given): pointer cursor, a pressed tint, a visible
 * focus outline (an outline, because a `tr` in a collapsed-border table does
 * not paint box-shadow consistently) and, as a record card, a chevron.
 * Selection (`data-selected`) is the accent tint. `group` draws a
 * group-header row (reference `tr.group-row`).
 */
function TableRow({
  className,
  interactive = false,
  group = false,
  ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean; group?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      data-interactive={interactive || undefined}
      data-group={group || undefined}
      className={cn(
        "border-b border-line transition-colors duration-(--np-duration-fast) ease-spring-snappy last:border-0 hover-fine:hover:bg-surface-alt",
        "aria-selected:bg-accent-tint data-[selected=true]:bg-accent-tint",
        group &&
          "bg-surface-alt text-caption font-semibold text-ink-secondary hover-fine:hover:bg-surface-alt [&>td]:py-2",
        interactive &&
          "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--np-focus-ring) active:bg-surface-alt",
        className
      )}
      {...props}
    />
  )
}

/**
 * `numeric` right-aligns the column in mono tabular figures, so a column of
 * counts lines up. Set it on the head and every cell.
 */
function TableHead({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      data-slot="table-head"
      className={cn(
        "h-10 px-(--np-cell-px) py-2 text-left align-middle text-caption font-semibold whitespace-nowrap text-ink-muted",
        numeric && "text-right",
        className
      )}
      {...props}
    />
  )
}

/**
 * The visible words beside a select-all checkbox in the header, shown only
 * while the table is record cards (the header row is otherwise the column
 * names, and the checkbox's own `aria-label` already names it, so these
 * words are hidden from assistive tech).
 */
function TableSelectAllLabel({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="table-select-all-label"
      className={cn(
        "hidden text-ui font-medium text-ink-secondary @max-3xl/table:inline",
        className
      )}
      {...props}
    />
  )
}

/** True when a cell's only child is a `Checkbox`: the row's selection. */
function isLoneCheckbox(children: React.ReactNode) {
  return React.isValidElement(children) && children.type === Checkbox
}

function TableCell({
  className,
  numeric = false,
  label,
  span = false,
  priority,
  actions = false,
  children,
  ...props
}: React.ComponentProps<"td"> & {
  numeric?: boolean
  /** The column name shown with the value in a record card. */
  label?: string
  /** Take the whole width in a record card's detail grid. */
  span?: boolean
  /** Where the cell goes in a record card; see `TableCellPriority`. */
  priority?: TableCellPriority
  /** The row's actions (an overflow menu): end of the record's title line. */
  actions?: boolean
}) {
  const resolved =
    priority ??
    (actions ? "actions" : isLoneCheckbox(children) ? "select" : undefined)
  return (
    <td
      data-slot="table-cell"
      data-label={label || undefined}
      data-span={span || undefined}
      data-priority={resolved}
      className={cn(
        "px-(--np-cell-px) py-(--np-row-py) align-middle",
        numeric && "text-right font-mono whitespace-nowrap tabular-nums",
        className
      )}
      {...props}
    >
      {children}
    </td>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableSelectAllLabel,
  type TableCellPriority,
}
