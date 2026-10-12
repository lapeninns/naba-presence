/**
 * The one CSV cell encoder. The report exports (lib/reporting/csv.ts, in the
 * browser) and the audit-log export (app/api/audit-log/route.ts, on the
 * server) both go through it, so the formula guard cannot drift between them.
 */

export type CsvCell = string | number | null | undefined

/**
 * A cell a spreadsheet would run as a formula: one starting with `=`, `+`,
 * `-` or `@` (also after leading whitespace, which Excel and Sheets skip), or
 * with a tab, carriage return or line feed.
 */
const formulaLead = /^(?:[\t\r\n]|\s*[=+\-@])/

/**
 * One cell. Text is always quoted, with a formula lead defused by an
 * apostrophe, because a spreadsheet would otherwise run a location or search
 * term named "=HYPERLINK(…)" as a formula. Numbers are written bare so they
 * stay numbers; a missing figure is an empty cell, never 0. Dates become ISO
 * strings and any other value its JSON, guarded like text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : ""
  }
  const text =
    typeof value === "string"
      ? value
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value)
  const guarded = formulaLead.test(text) ? `'${text}` : text
  return `"${guarded.replaceAll('"', '""')}"`
}

/** Rows to CSV text, CRLF line endings as RFC 4180 has them. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n")
}
