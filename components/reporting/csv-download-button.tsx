"use client"

import { DownloadIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { csvFilename, downloadCsv, type CsvCell } from "@/lib/reporting/csv"

/** "Download Search views as CSV" → "Search views" (the older prop's wording). */
function subjectFromLabel(accessibleLabel: string | undefined) {
  if (!accessibleLabel) return undefined
  const match = /^Download (.+?) as CSV$/i.exec(accessibleLabel.trim())
  return match ? match[1] : accessibleLabel
}

/**
 * Who and when an in-app export covers: the client, business or listing
 * (`name`) and the dates (`period`, "2026-09-30 2026-10-27" or "from
 * 2026-05"). Null outside `ReportExportScope`.
 */
type ExportScope = { name?: string; period?: string }

const ExportScopeContext = React.createContext<ExportScope | null>(null)

/**
 * Opts the CSV buttons inside it into the in-app export: file names that
 * carry the scope and the dates, and a word that the download started (or
 * could not be made). An inner scope adds to the outer one (the page names
 * the client, each tab its dates). The shared report has none, so its files
 * and buttons are as they were.
 */
export function ReportExportScope({
  value,
  children,
}: {
  value: ExportScope
  children: React.ReactNode
}) {
  const outer = React.useContext(ExportScopeContext)
  const merged = React.useMemo(
    () => ({
      name: value.name ?? outer?.name,
      period: value.period ?? outer?.period,
    }),
    [outer?.name, outer?.period, value.name, value.period]
  )
  return (
    <ExportScopeContext.Provider value={merged}>
      {children}
    </ExportScopeContext.Provider>
  )
}

/**
 * The file name with the scope in front and the dates after, unless the
 * stem already carries those dates (the Google totals name its own).
 */
function scopedFilename(filename: string, scope: ExportScope) {
  const stem = filename.replace(/\.csv$/i, "")
  const dates = scope.period ? csvFilename(scope.period).slice(0, -4) : ""
  return csvFilename(
    scope.name,
    stem,
    dates && !stem.includes(dates) ? scope.period : undefined
  )
}

/** How long "Downloading …" is held for a screen reader before it clears. */
const STATUS_MS = 4_000

/**
 * "Download CSV" for a report table or a chart's figures. The rows are read
 * when clicked, from what is on screen, so the file matches the page.
 *
 * When several buttons share a page, `subject` names what each exports. It
 * is added after the visible words for screen readers only ("Download CSV
 * of Search views"), so the accessible name always starts with what is on
 * screen (WCAG 2.5.3 label in name) rather than replacing it.
 *
 * Inside `ReportExportScope` the file is named for its scope and dates, the
 * start is announced ("Downloading …", never "Saved": the browser owns the
 * rest) and a file that could not be made says so beside the button.
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
  const scope = React.useContext(ExportScopeContext)
  const [status, setStatus] = React.useState<{
    kind: "started" | "failed"
    file: string
  } | null>(null)
  const clear = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(clear.current), [])

  function download() {
    if (!scope) {
      downloadCsv(filename, rows())
      return
    }
    const file = scopedFilename(filename, scope)
    clearTimeout(clear.current)
    try {
      downloadCsv(file, rows())
      setStatus({ kind: "started", file })
      clear.current = setTimeout(() => setStatus(null), STATUS_MS)
    } catch {
      setStatus({ kind: "failed", file })
    }
  }

  const button = (
    <Button variant="ghost" size="sm" onClick={download}>
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
  if (!scope) return button
  return (
    <>
      {button}
      {/* Present before it speaks, so the first download is announced. */}
      <span role="status" className="sr-only">
        {status?.kind === "started" ? `Downloading ${status.file}` : ""}
      </span>
      {status?.kind === "failed" ? (
        <span role="alert" className="text-caption text-danger-ink">
          We couldn’t make this file. Try again.
        </span>
      ) : null}
    </>
  )
}
