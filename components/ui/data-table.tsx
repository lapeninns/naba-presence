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
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type DataTableColumn<Row> = {
  id: string
  header: React.ReactNode
  cell: (row: Row) => React.ReactNode
  /** Applied to both the header cell and every body cell in the column. */
  className?: string
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
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader sticky={stickyHeader}>
          <TableRow>
            {selection ? (
              <TableHead className="w-10">
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
              </TableHead>
            ) : null}
            {columns.map((column) => (
              <TableHead key={column.id} className={column.className}>
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
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {selection ? (
                  <TableCell
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
                  <TableCell key={column.id} className={column.className}>
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
