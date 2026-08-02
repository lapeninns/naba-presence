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

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_th]:border-b [&_th]:border-border", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40", className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      data-slot="table-head"
      className={cn("h-10 px-3 text-left align-middle text-caption font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("px-3 py-2.5 align-middle", className)} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
