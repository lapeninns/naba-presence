"use client"

import * as React from "react"

import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectAllLabel,
  type TableCellPriority,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type DataTableColumn<Row> = {
  id: string
  header: React.ReactNode
  cell: (row: Row) => React.ReactNode
  /** Applied to both the header cell and every body cell in the column. */
  className?: string
  /** Right-aligned with tabular figures: counts, ratings, money. */
  numeric?: boolean
  /**
   * The column name shown with each value in a responsive record card.
   * Defaults to `header` when that is a string. Pass `""` for none. The
   * primary column is never labelled, whatever this says.
   */
  label?: string
  /** Take the whole width of a record card's detail grid. */
  span?: boolean
  /**
   * Where the column goes in a responsive record card: `primary` (the
   * headline, usually the sort column), `secondary` (a subtitle),
   * `trailing` (the status or figure), `actions`, `meta` (joined into one
   * muted line), `detail` (a labelled pair; the default), `desk-only`
   * (dropped). Without any priorities the first column is the title and
   * the rest are details. See `TableCellPriority` in table.tsx.
   */
  priority?: Exclude<TableCellPriority, "select">
}

type DataTableProps<Row> = {
  /** Names the table for screen readers; rendered as a visually hidden caption. */
  caption: string
  columns: DataTableColumn<Row>[]
  rows: Row[]
  rowId: (row: Row) => string
  /** Omit to render a plain table with no selection column. */
  selection?: {
    selected: ReadonlySet<string>
    onChange: (selected: Set<string>) => void
    /** Names one row for its checkbox, e.g. "Select Old Crown Girton". */
    label: (row: Row) => string
  }
  onRowClick?: (row: Row) => void
  density?: "compact" | "comfortable"
  stickyHeader?: boolean
  empty?: React.ReactNode
  /**
   * Draws the table on its own white card — `Table`'s own `surface`, so a
   * DataTable and a hand-composed table land on exactly the same ground.
   * Leave off when the table already sits inside a panel or an inset group.
   */
  surface?: boolean
  /**
   * Become record cards below 48rem of the table's own width: a title line,
   * a subtitle, one meta line and labelled details, placed by each column's
   * `priority`. With `selection`, the checkbox moves to the card's leading
   * slot and the select-all checkbox stays above the cards as a bar with
   * the selected count. See `Table`.
   */
  responsive?: boolean
  className?: string
}

/**
 * A selectable table.
 *
 * Composition over `table.tsx` rather than a headless table library: the
 * product's tables are a directory, a people list and a location list, all of
 * which need selection and a caption and none of which need column resizing,
 * grouping or virtualised rows.
 *
 * On a phone (`responsive`), each row is a record card; the column
 * `priority` decides what leads it. A typical people list:
 *
 *   { id: "name", header: "Member", priority: "primary", cell: … }
 *   { id: "email", header: "Email", priority: "secondary", cell: … }
 *   { id: "role", header: "Role", priority: "meta", cell: … }
 *   { id: "status", header: "Publishing", priority: "trailing", cell: … }
 *   { id: "menu", header: "", priority: "actions", cell: … }
 *
 * The caption is mandatory and visually hidden. A page with three tables gives
 * a screen-reader user three identical "table" landmarks otherwise, and the
 * only way to tell them apart is to read into each one.
 */
function DataTable<Row>({
  caption,
  columns,
  rows,
  rowId,
  selection,
  onRowClick,
  density,
  stickyHeader = false,
  empty,
  surface = false,
  responsive = false,
  className,
}: DataTableProps<Row>) {
  const ids = rows.map(rowId)
  const selectedCount = ids.filter((id) => selection?.selected.has(id)).length
  const allSelected = ids.length > 0 && selectedCount === ids.length

  const toggleAll = () => {
    if (!selection) return
    // Toggling the header checkbox affects only the rows currently rendered,
    // never a filtered-out row the operator cannot see.
    const next = new Set(selection.selected)
    if (allSelected) for (const id of ids) next.delete(id)
    else for (const id of ids) next.add(id)
    selection.onChange(next)
  }

  const toggleRow = (id: string) => {
    if (!selection) return
    const next = new Set(selection.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selection.onChange(next)
  }

  if (rows.length === 0 && empty) {
    return <div data-density={density}>{empty}</div>
  }

  return (
    <div data-density={density} className={cn("min-w-0", className)}>
      {/* The card ground belongs to Table's scroll container, not to a box
          around it: a wide table then scrolls inside its own card instead of
          sliding out from under one. */}
      <Table surface={surface} responsive={responsive}>
        <caption className="sr-only">{caption}</caption>
        <TableHeader sticky={stickyHeader}>
          <TableRow>
            {selection ? (
              <TableHead className="w-11 pr-0">
                <Checkbox
                  checked={allSelected}
                  indeterminate={selectedCount > 0 && !allSelected}
                  onCheckedChange={toggleAll}
                  aria-label={
                    allSelected
                      ? "Clear the selection"
                      : `Select all ${rows.length} rows`
                  }
                />
                {/* Record cards hide the column names, so the bar the
                    checkbox becomes says what it does and how many are
                    chosen. */}
                <TableSelectAllLabel>
                  {selectedCount > 0
                    ? `${selectedCount} of ${rows.length} selected`
                    : `Select all ${rows.length}`}
                </TableSelectAllLabel>
              </TableHead>
            ) : null}
            {columns.map((column) => (
              <TableHead
                key={column.id}
                numeric={column.numeric}
                className={column.className}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const id = rowId(row)
            const isSelected = selection?.selected.has(id) ?? false
            return (
              <TableRow
                key={id}
                data-selected={isSelected || undefined}
                interactive={Boolean(onRowClick)}
                // A pointer convenience only. The row is not a tab stop: a
                // focusable <tr> has no name of its own, so a keyboard user
                // met an unnamed stop before the row's real link. Keyboard
                // and screen-reader users open the row through the named
                // link a clickable row must carry in one of its cells.
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selection ? (
                  <TableCell
                    priority="select"
                    className="w-11 pr-0"
                    // Stops a checkbox click from also triggering the row's
                    // own navigation.
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleRow(id)}
                      aria-label={selection.label(row)}
                    />
                  </TableCell>
                ) : null}
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    numeric={column.numeric}
                    label={
                      column.label ??
                      (typeof column.header === "string"
                        ? column.header
                        : undefined)
                    }
                    span={column.span}
                    priority={column.priority}
                    className={column.className}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export { DataTable }
