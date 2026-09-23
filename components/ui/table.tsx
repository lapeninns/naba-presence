import { cn } from "@/lib/utils"

/**
 * Tables (reference `.table-wrap` / `.table`).
 *
 * `surface` draws the table on its own white card with a hairline edge; the
 * scroll container and the card are one box, so a wide table scrolls inside
 * its card. The container is also a size container (`@container/table`).
 *
 * `responsive` turns the table into LABELLED ROWS when its own container is
 * narrower than 720px (reference `.table.responsive`): the header row hides,
 * each row becomes a two-column grid, and every cell shows its column name
 * above its value. Give each `TableCell` a `label` (DataTable does this from
 * the column header). The first cell and any cell with `span` take the full
 * row; numeric cells turn left-aligned.
 *
 * `containerClassName` reaches the scroll box, for bounding the scroll port.
 */
const RESPONSIVE_CLASS = cn(
  "@max-[720px]/table:block",
  "@max-[720px]/table:[&_thead]:hidden",
  "@max-[720px]/table:[&_tbody]:block",
  "@max-[720px]/table:[&_tbody>tr]:grid @max-[720px]/table:[&_tbody>tr]:grid-cols-[minmax(0,1fr)_auto] @max-[720px]/table:[&_tbody>tr]:gap-x-3 @max-[720px]/table:[&_tbody>tr]:gap-y-1.5 @max-[720px]/table:[&_tbody>tr]:px-3.5 @max-[720px]/table:[&_tbody>tr]:py-3",
  "@max-[720px]/table:[&_tbody>tr>td]:block @max-[720px]/table:[&_tbody>tr>td]:p-0 @max-[720px]/table:[&_tbody>tr>td]:text-left",
  "@max-[720px]/table:[&_tbody>tr>td[data-label]]:before:block @max-[720px]/table:[&_tbody>tr>td[data-label]]:before:font-sans @max-[720px]/table:[&_tbody>tr>td[data-label]]:before:text-[11.5px] @max-[720px]/table:[&_tbody>tr>td[data-label]]:before:font-medium @max-[720px]/table:[&_tbody>tr>td[data-label]]:before:text-ink-muted @max-[720px]/table:[&_tbody>tr>td[data-label]]:before:content-[attr(data-label)]",
  "@max-[720px]/table:[&_tbody>tr>td:first-child]:col-span-full @max-[720px]/table:[&_tbody>tr>td[data-span]]:col-span-full",
  "@max-[720px]/table:[&_tbody>tr>td[data-actions]]:col-span-full",
  "@max-[720px]/table:[&_tbody>tr[data-group]]:block @max-[720px]/table:[&_tbody>tr[data-group]]:bg-surface-alt @max-[720px]/table:[&_tbody>tr[data-group]]:py-2"
)

function Table({
  className,
  surface = false,
  responsive = false,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  surface?: boolean
  /** Labelled rows below 720px of container width. */
  responsive?: boolean
  containerClassName?: string
}) {
  return (
    // `tabIndex={0}` (axe `scrollable-region-focusable`): this wrapper is the
    // horizontal-scroll container on narrow viewports, so it must be
    // reachable by keyboard whenever its table overflows.
    <div
      data-slot="table-container"
      className={cn(
        "@container/table w-full min-w-0 overflow-x-auto focus-halo",
        surface && "rounded-(--np-radius-card) border border-line bg-surface",
        containerClassName
      )}
      tabIndex={0}
    >
      <table
        data-slot="table"
        data-responsive={responsive || undefined}
        className={cn(
          "w-full caption-bottom border-collapse text-ui text-ink",
          responsive && RESPONSIVE_CLASS,
          className
        )}
        {...props}
      />
    </div>
  )
}

/**
 * The header row sits on the sunken surface (reference `thead th`): 12px
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
        sticky && "[&_th]:sticky [&_th]:top-0 [&_th]:z-10",
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
 * when `onRowClick` is given): pointer cursor and a visible focus outline
 * (an outline, because a `tr` in a collapsed-border table does not paint
 * box-shadow consistently). Selection (`data-selected`) is the accent tint.
 * `group` draws a group-header row (reference `tr.group-row`).
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
        "border-b border-line transition-colors duration-(--np-duration-fast) ease-spring-snappy last:border-0 hover:bg-surface-alt",
        "aria-selected:bg-accent-tint data-[selected=true]:bg-accent-tint",
        group &&
          "bg-surface-alt text-caption font-semibold text-ink-secondary hover:bg-surface-alt [&>td]:py-2",
        interactive &&
          "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--np-focus-ring)",
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

function TableCell({
  className,
  numeric = false,
  label,
  span = false,
  ...props
}: React.ComponentProps<"td"> & {
  numeric?: boolean
  /** The column name shown above the value in responsive labelled rows. */
  label?: string
  /** Take the whole row in responsive labelled rows. */
  span?: boolean
}) {
  return (
    <td
      data-slot="table-cell"
      data-label={label || undefined}
      data-span={span || undefined}
      className={cn(
        "px-(--np-cell-px) py-(--np-row-py) align-middle",
        numeric && "text-right font-mono whitespace-nowrap tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
