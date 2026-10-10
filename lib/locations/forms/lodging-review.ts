import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { lodgingCataloguePath, lodgingEditorCoverage, lodgingFieldLabel } from "./lodging-catalogue"

const coverage = lodgingEditorCoverage()

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {}
}

function atPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => record(current)[key], value)
}

/** Matches the editor: "Services · Languages spoken 2 · Language code" (1-based items). */
export function lodgingReviewLabel(path: string) {
  if (path === "metadata.updateTime") return "Data confirmed accurate at"
  return path.split(".").reduce<string[]>((parts, part) => {
    if (/^\d+$/.test(part) && parts.length) parts[parts.length - 1] = `${parts[parts.length - 1]} ${Number(part) + 1}`
    else parts.push(lodgingFieldLabel(part))
    return parts
  }, []).join(" · ")
}

const isTime = (path: string) => coverage.get(lodgingCataloguePath(path))?.kind === "time"
const pad = (value: number) => String(value).padStart(2, "0")

function display(value: unknown, clearing = false, time = false): string {
  if (value === undefined) return clearing ? "Clear value" : "Not set"
  if (value === null) return "Not set"
  if (time && typeof value === "object" && !Array.isArray(value)) {
    const parts = record(value), hours = parts.hours ?? 0, minutes = parts.minutes ?? 0
    if (typeof hours === "number" && typeof minutes === "number") return `${pad(hours)}:${pad(minutes)}`
  }
  if (value === true) return "Yes"
  if (value === false) return "No"
  if (Array.isArray(value)) return "No items"
  if (typeof value === "object") return "No values"
  return String(value).replace(/_/g, " ")
}

export function lodgingReviewRows(change: Pick<GbpChangeSet, "baseline" | "payload" | "updateMask">) {
  const rows: Array<{ key: string; field: string; before: string; after: string }> = []
  const seen = new Set<string>()
  function visit(path: string, before: unknown, after: unknown) {
    if (isTime(path)) {
      if (JSON.stringify(before) === JSON.stringify(after) || seen.has(path)) return
      seen.add(path)
      rows.push({ key: path, field: lodgingReviewLabel(path), before: display(before, false, true), after: display(after, true, true) })
      return
    }
    if (before !== null && typeof before === "object" || after !== null && typeof after === "object") {
      const left = record(before)
      const right = record(after)
      const keys = new Set([...Object.keys(left), ...Object.keys(right)])
      if (keys.size > 0) {
        for (const key of keys) visit(`${path}.${key}`, left[key], right[key])
        return
      }
      if (JSON.stringify(before) === JSON.stringify(after)) return
    }
    if (before === after || seen.has(path)) return
    seen.add(path)
    rows.push({ key: path, field: lodgingReviewLabel(path), before: display(before), after: display(after, true) })
  }
  for (const path of change.updateMask) visit(path, atPath(change.baseline, path), atPath(change.payload, path))
  return rows
}
