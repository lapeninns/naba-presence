import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    // `tabIndex={0}` (WCAG 2.1.1/2.1.3, axe `scrollable-region-focusable`):
    // this wrapper is the horizontal-scroll container on narrow viewports,
    // so it must be reachable by keyboard whenever its table content
    // overflows — whether that's true is a runtime layout fact this shared
    // primitive can't know ahead of time, so it's applied unconditionally
    // (a focusable non-scrolling wrapper on wider viewports is harmless).
    <div className="w-full overflow-x-auto" tabIndex={0}>
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-ui", className)}
        {...props}
      />
    </div>
  )
}

/**
 * `sticky` keeps the column labels visible while a long table scrolls, which
 * a directory of forty clients needs. It is opt-in because a sticky header
 * inside a page that scrolls as a whole would detach and float.
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
        "[&_th]:border-b [&_th]:border-border",
        sticky && "sticky top-0 z-10 [&_th]:bg-[var(--np-table-header-bg)]",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-line-subtle transition-colors duration-(--np-duration-fast) last:border-0 hover:bg-[var(--np-hover-bg)]",
        // Selection is a background, not a border: a selected row that also
        // changes height would make a checkbox column jitter as rows toggle.
        "data-[selected=true]:bg-accent-tint",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      data-slot="table-head"
      className={cn(
        "h-(--np-row-h) px-(--np-cell-px) text-left align-middle text-caption font-medium text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-(--np-cell-px) py-(--np-row-py) align-middle", className)}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
