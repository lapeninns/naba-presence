"use client"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

// A preview of exactly what a Google-direct publish will change: the field, its
// current Google value, and the value about to replace it. Distinct from the M5
// CanonicalDiff (which shows a 4-status canonical/Google reconciliation).
export function GoogleDiff({ rows }: { rows: Array<{ key: string; label: string; currentValue: string | null; nextValue: string | null }> }) {
  if (rows.length === 0) return null
  return (
    <Table className="min-w-[480px]">
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>Currently on Google</TableHead>
          <TableHead>Will change to</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-muted-foreground">{row.currentValue ?? "—"}</TableCell>
            <TableCell>{row.nextValue ?? "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
