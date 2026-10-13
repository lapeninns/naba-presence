/**
 * CSV for the report tables and chart series, built in the browser from the
 * figures already on screen. Nothing is fetched again, so an export is
 * exactly what the person is looking at.
 */

import { toCsv, type CsvCell } from "@/lib/domain/csv"

export { csvCell, toCsv, type CsvCell } from "@/lib/domain/csv"

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
  keepUntilFetched(url)
}

/**
 * How long a download's object URL outlives the click. iOS Safari reads the
 * blob asynchronously, well after the click handler (it may first show its
 * own download prompt), so revoking on the next task can leave it with an
 * empty or failed file. A minute covers that; the page leaving frees any
 * still held.
 */
export const CSV_URL_LIFETIME_MS = 60_000

const heldUrls = new Map<string, ReturnType<typeof setTimeout>>()

function revokeHeld(url: string) {
  const timer = heldUrls.get(url)
  if (timer !== undefined) clearTimeout(timer)
  heldUrls.delete(url)
  URL.revokeObjectURL(url)
  if (heldUrls.size === 0 && typeof window !== "undefined") {
    window.removeEventListener("pagehide", revokeAllHeld)
  }
}

function revokeAllHeld() {
  for (const url of [...heldUrls.keys()]) revokeHeld(url)
}

function keepUntilFetched(url: string) {
  if (heldUrls.size === 0 && typeof window !== "undefined") {
    window.addEventListener("pagehide", revokeAllHeld)
  }
  heldUrls.set(
    url,
    setTimeout(() => revokeHeld(url), CSV_URL_LIFETIME_MS)
  )
}
