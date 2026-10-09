/**
 * CSV for the report tables and chart series, built in the browser from the
 * figures already on screen. Nothing is fetched again, so an export is
 * exactly what the person is looking at.
 */

export type CsvCell = string | number | null | undefined

/**
 * One cell. Text is always quoted, with a leading `=`, `+`, `-`, `@`, tab or
 * carriage return defused by an apostrophe, because a spreadsheet would
 * otherwise run a location or search term named "=HYPERLINK(…)" as a
 * formula. Numbers are written bare so they stay numbers; a missing figure
 * is an empty cell, never 0.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : ""
  }
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${guarded.replaceAll('"', '""')}"`
}

/** Rows to CSV text, CRLF line endings as RFC 4180 has them. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n")
}

/**
 * A file name from a report's title and period: lower case, hyphenated,
 * nothing a file system could object to.
 */
export function csvFilename(...parts: Array<string | null | undefined>) {
  const stem = parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${stem || "report"}.csv`
}

/**
 * Saves the rows as a file. The byte order mark makes Excel read the file
 * as UTF-8, so "Café" and "–" survive the round trip.
 */
export function downloadCsv(
  filename: string,
  rows: ReadonlyArray<ReadonlyArray<CsvCell>>
) {
  const blob = new Blob([`﻿${toCsv(rows)}`], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked on the next task: some browsers start the download after the
  // click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
