/**
 * What an approver reads before approving a listing change request (plan
 * P02-S2b, lib/server/listing-changes.ts): every value the frozen request
 * will send, and -- for a change about one photo -- what that item holds
 * now. The rows are derived from the stored body alone, the
 * same body the request's payload hash covers, so what is shown is what the
 * approval sends.
 *
 * Pure: no I/O, so it is shared by the server (which renders the rows into
 * the wire shape) and the unit tests.
 */
import type {
  ListingChangeDetail,
  ListingChangeKind,
} from "@/lib/contracts/listing-changes"

/** Rows kept per request; the rest are counted in a last row. */
export const MAX_LISTING_CHANGE_DETAILS = 60
/** Characters kept per value; longer values are cut with an ellipsis. */
export const MAX_LISTING_CHANGE_DETAIL_CHARS = 1_000

/**
 * Body fields that are bookkeeping rather than content: the confirmation
 * literal, the baseline hashes (checked at dispatch) and the field masks
 * (shown separately as `fieldMask`).
 */
function isBookkeeping(key: string): boolean {
  return (
    key === "confirmation" ||
    key === "selectedFields" ||
    /^expected.*Hash$/.test(key) ||
    /Mask$/.test(key)
  )
}

/** Wrappers whose children read better at the top level. */
const FLATTENED = new Set(["payload"])

const LABELS: Record<string, string> = {
  expectedCanonicalRevision: "Saved version",
  confirmOverwriteGoogleChanges: "Overwrite changes made on Google",
  confirmOverwriteCanonicalChanges: "Overwrite saved changes",
  confirmFullReplacement: "Replace everything on Google",
  sourceUrl: "Source web address",
}

function humanise(key: string): string {
  const known = LABELS[key]
  if (known) return known
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "(empty)"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "string") return value === "" ? "(empty)" : value
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value)
  }
  return JSON.stringify(value)
}

function clip(value: string): string {
  return value.length > MAX_LISTING_CHANGE_DETAIL_CHARS
    ? `${value.slice(0, MAX_LISTING_CHANGE_DETAIL_CHARS - 1)}…`
    : value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function flatten(
  value: unknown,
  path: string[],
  rows: ListingChangeDetail[]
): void {
  if (Array.isArray(value)) {
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
      rows.push({
        label: path.join(" › ") || "Value",
        value: value.length === 0 ? "(none)" : value.map(scalar).join(", "),
      })
      return
    }
    value.forEach((item, index) =>
      flatten(
        item,
        [...path.slice(0, -1), `${path.at(-1) ?? "Item"} ${index + 1}`],
        rows
      )
    )
    return
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([key]) => !isBookkeeping(key))
    if (entries.length === 0 && path.length > 0) {
      rows.push({ label: path.join(" › "), value: "(none)" })
    }
    for (const [key, child] of entries) {
      const lift =
        FLATTENED.has(key) && path.length === 0 && isPlainObject(child)
      flatten(child, lift ? [] : [...path, humanise(key)], rows)
    }
    return
  }
  rows.push({ label: path.join(" › ") || "Value", value: scalar(value) })
}

/** What the change's target (a photo) holds now. */
export type ListingChangeTargetNow = Record<string, unknown> | null

/**
 * Kinds whose body names a saved revision rather than carrying the content:
 * what they publish is the editor's saved copy, which a local save
 * invalidates the request for (invalidatePendingListingChanges).
 */
const PUBLISHES_SAVED_COPY = new Set<ListingChangeKind>([
  "hours_publish",
  "profile_publish",
  "food_menus_publish",
])

const TARGET_LABEL: Partial<Record<ListingChangeKind, string>> = {
  media_update: "Photo",
  media_delete: "Photo",
}

/**
 * The rows an approver reads: the target and what it holds now (when the
 * change names one), then every content value of the frozen body.
 */
export function describeListingChange(input: {
  kind: ListingChangeKind
  target: string | null
  body: unknown
  targetNow?: ListingChangeTargetNow
}): ListingChangeDetail[] {
  const rows: ListingChangeDetail[] = []
  if (PUBLISHES_SAVED_COPY.has(input.kind)) {
    rows.push({
      label: "Publishes",
      value:
        "The saved copy shown in this editor. Saving a change to it cancels this request.",
    })
  }
  const targetLabel = TARGET_LABEL[input.kind]
  if (targetLabel && input.target) {
    rows.push({ label: targetLabel, value: input.target })
    if (input.targetNow) {
      for (const [key, value] of Object.entries(input.targetNow)) {
        if (value === null || value === undefined || value === "") continue
        rows.push({
          label: `Now: ${humanise(key).toLowerCase()}`,
          value: scalar(value),
        })
      }
    } else {
      rows.push({
        label: `Now: ${targetLabel.toLowerCase()}`,
        value: "Not found in the saved copy of Google",
      })
    }
  }
  flatten(input.body, [], rows)
  const kept = rows.slice(0, MAX_LISTING_CHANGE_DETAILS).map((row) => ({
    label: clip(row.label),
    value: clip(row.value),
  }))
  if (rows.length > MAX_LISTING_CHANGE_DETAILS) {
    kept.push({
      label: "More",
      value: `${rows.length - MAX_LISTING_CHANGE_DETAILS} more values`,
    })
  }
  return kept
}
