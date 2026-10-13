"use client"

import { DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { downloadCsv, type CsvCell } from "@/lib/reporting/csv"

/** "Download Search views as CSV" → "Search views" (the older prop's wording). */
function subjectFromLabel(accessibleLabel: string | undefined) {
  if (!accessibleLabel) return undefined
  const match = /^Download (.+?) as CSV$/i.exec(accessibleLabel.trim())
  return match ? match[1] : accessibleLabel
}

/**
 * "Download CSV" for a report table or a chart's figures. The rows are read
 * when clicked, from what is on screen, so the file matches the page.
 *
 * When several buttons share a page, `subject` names what each exports. It
 * is added after the visible words for screen readers only ("Download CSV
 * of Search views"), so the accessible name always starts with what is on
 * screen (WCAG 2.5.3 label in name) rather than replacing it.
 */
export function CsvDownloadButton({
  filename,
  rows,
  label = "Download CSV",
  subject,
  accessibleLabel,
}: {
  filename: string
  rows: () => ReadonlyArray<ReadonlyArray<CsvCell>>
  label?: string
  /** What is exported, e.g. "reply performance by location". */
  subject?: string
  /**
   * @deprecated Use `subject`. "Download X as CSV" is read as subject X; it
   * no longer replaces the visible label.
   */
  accessibleLabel?: string
}) {
  const named = subject ?? subjectFromLabel(accessibleLabel)
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => downloadCsv(filename, rows())}
    >
      <DownloadIcon aria-hidden strokeWidth={1.75} />
      {label}
      {named ? (
        <>
          {" "}
          <span className="sr-only">of {named}</span>
        </>
      ) : null}
    </Button>
  )
}
