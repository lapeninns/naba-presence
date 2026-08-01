"use client"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type DiffStatus = "in_sync" | "core_dirty" | "google_dirty" | "conflict"

const STATUS: Record<DiffStatus, { label: string; variant: "secondary" | "warning" | "info" }> = {
  in_sync: { label: "In sync", variant: "secondary" },
  core_dirty: { label: "Edited here", variant: "info" },
  google_dirty: { label: "Changed on Google", variant: "warning" },
  conflict: { label: "Conflict", variant: "warning" },
}

export function statusBadge(status: DiffStatus) {
  const entry = STATUS[status]
  return <Badge variant={entry.variant}>{entry.label}</Badge>
}

export function CanonicalDiff({
  rows,
}: {
  rows: Array<{ key: string; label: string; canonicalValue: string | null; googleValue: string | null; status: DiffStatus }>
}) {
  return (
    <Table className="min-w-[560px]">
      <TableHeader>
        <TableRow>
          <TableHead>Field</TableHead>
          <TableHead>NabaPresence</TableHead>
          <TableHead>Google</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell className="text-muted-foreground">{row.canonicalValue ?? "—"}</TableCell>
            <TableCell className="text-muted-foreground">{row.googleValue ?? "—"}</TableCell>
            <TableCell>{statusBadge(row.status)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
