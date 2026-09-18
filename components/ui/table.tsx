import { cn } from "@/lib/utils"

/**
 * `surface` draws the table on the grouped background's white card: the
 * same `overflow-hidden rounded bg-surface` wrapper four screens were each
 * writing by hand around their own `<Table>`, which is also the ground
 * `DataTable surface` puts under its table. The scroll container and the
 * card are then one box, so a table that overflows scrolls *inside* its
 * card instead of out from under a separate one.
 *
 * `containerClassName` reaches that box, for the rare caller that needs to
 * bound the scroll port (a max height, a min width) without touching the
 * `<table>` itself.
 */
function Table({
  className,
  surface = false,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  surface?: boolean
  containerClassName?: string
}) {
  return (
    // `tabIndex={0}` (WCAG 2.1.1/2.1.3, axe `scrollable-region-focusable`):
    // this wrapper is the horizontal-scroll container on narrow viewports,
    // so it must be reachable by keyboard whenever its table content
    // overflows — whether that's true is a runtime layout fact this shared
    // primitive can't know ahead of time, so it's applied unconditionally
    // (a focusable non-scrolling wrapper on wider viewports is harmless).
    <div
      data-slot="table-container"
      className={cn(
        "w-full overflow-x-auto focus-halo",
        surface && "rounded-(--np-radius-card) bg-surface",
        containerClassName
      )}
      tabIndex={0}
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-collapse text-ui text-ink",
          className
        )}
        {...props}
      />
    </div>
  )
}

/**
 * `sticky` keeps the column labels visible while a long table scrolls, which
 * a directory of forty clients needs. It is opt-in because a sticky header
 * inside a page that scrolls as a whole would detach and float.
 *
 * A sticky header sits on the toolbar material so rows blur beneath it, the
 * one place a material is allowed near a table: it is chrome, not a row.
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
        "[&_th]:border-b [&_th]:border-line-subtle [&_tr:hover]:bg-transparent",
        sticky && "sticky top-0 z-10 [&_th]:material-toolbar",
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
 * when `onRowClick` is given): pointer cursor, a press state and a visible
 * focus treatment. The focus treatment is an outline rather than the halo
 * because a `tr` inside a collapsed-border table does not paint box-shadow
 * consistently across engines.
 */
function TableRow({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      data-interactive={interactive || undefined}
      className={cn(
        "border-b border-line-subtle transition-colors duration-(--np-duration-fast) ease-spring-snappy last:border-0 hover:bg-(--np-hover-bg)",
        // Selection is a background, not a border: a selected row that also
        // changes height would make a checkbox column jitter as rows toggle.
        "data-[selected=true]:bg-accent-tint",
        interactive &&
          "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--np-focus-ring) active:bg-fill-tertiary",
        className
      )}
      {...props}
    />
  )
}

/**
 * `numeric` right-aligns the column and sets tabular figures, so a column of
 * counts lines up on the decimal point. Set it on the head and every cell.
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
        "h-(--np-row-h) px-(--np-cell-px) text-left align-middle text-ui font-medium whitespace-nowrap text-ink-muted",
        numeric && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-(--np-cell-px) py-(--np-row-py) align-middle",
        numeric && "text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
