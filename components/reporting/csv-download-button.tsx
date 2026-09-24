"use client"

import { DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { downloadCsv, type CsvCell } from "@/lib/reporting/csv"

/**
 * "Download CSV" for a report table or a chart's figures. The rows are read
 * when clicked, from what is on screen, so the file matches the page.
 */
export function CsvDownloadButton({
  filename,
  rows,
  label = "Download CSV",
  accessibleLabel,
}: {
  filename: string
  rows: () => ReadonlyArray<ReadonlyArray<CsvCell>>
  label?: string
  /** Names what is exported when several buttons share a page. */
  accessibleLabel?: string
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={accessibleLabel}
      onClick={() => downloadCsv(filename, rows())}
    >
      <DownloadIcon aria-hidden strokeWidth={1.75} />
      {label}
    </Button>
  )
}
