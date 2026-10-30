import type { DiffRow } from "@/components/ui/diff-view"
import type {
  GoogleChange,
  WireWatchedValue,
} from "@/lib/contracts/google-change-watch"
import { WATCHED_FIELD_LABELS } from "@/lib/domain/google-change-watch-vocabulary"

/**
 * The rows of one change's "Ours" against "On Google" table, in the words
 * on the listing: one row for a text field or the category, one per changed
 * day or date for hours (the unchanged ones would only bury the change).
 */

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const NOT_SET = "Not set"

type Regular = Extract<WireWatchedValue, { field: "regularHours" }>["value"]
type Special = Extract<WireWatchedValue, { field: "specialHours" }>["value"]

function range(opensAt: string, closesAt: string) {
  return `${opensAt}–${closesAt}`
}

function dayText(regular: Regular, dayOfWeek: number): string {
  const day = regular.find((entry) => entry.dayOfWeek === dayOfWeek)
  if (!day || day.isClosed || day.periods.length === 0) return "Closed"
  return [...day.periods]
    .sort((left, right) => left.opensAt.localeCompare(right.opensAt))
    .map((period) => range(period.opensAt, period.closesAt))
    .join(", ")
}

export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  if (!year || !month || !day) return date
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function dateText(special: Special, date: string): string {
  const entries = special.filter((entry) => entry.effectiveDate === date)
  if (entries.length === 0) return "Usual hours"
  // A date without both times is closed, as the comparison reads it.
  const closed = entries.find(
    (entry) => entry.isClosed || !entry.opensAt || !entry.closesAt
  )
  if (closed) {
    return closed.endDate && closed.endDate > date
      ? `Closed until ${formatDate(closed.endDate)}`
      : "Closed"
  }
  return entries
    .map((entry) => range(entry.opensAt ?? "", entry.closesAt ?? ""))
    .sort()
    .join(", ")
}

/** A moment in UK time, as "Thu 30 Oct 2026". */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(iso))
}

function textValue(value: WireWatchedValue): string {
  switch (value.field) {
    case "primaryCategory":
      return value.value?.displayName ?? value.value?.name ?? NOT_SET
    case "name":
    case "description":
    case "phone":
    case "website":
      return value.value ?? NOT_SET
    default:
      return NOT_SET
  }
}

export function changeRows(change: GoogleChange): DiffRow[] {
  const { ours, google } = change
  if (ours.field === "regularHours" && google.field === "regularHours") {
    return change.regularDays.map((day) => ({
      field: DAY_NAMES[day] ?? `Day ${day}`,
      before: dayText(ours.value, day),
      after: dayText(google.value, day),
      state: "changed" as const,
    }))
  }
  if (ours.field === "specialHours" && google.field === "specialHours") {
    return change.specialDates.map((date) => ({
      field: formatDate(date),
      before: dateText(ours.value, date),
      after: dateText(google.value, date),
      state: "changed" as const,
    }))
  }
  return [
    {
      field: WATCHED_FIELD_LABELS[change.field],
      before: textValue(ours),
      after: textValue(google),
      state: "changed",
    },
  ]
}

/** "Monday and Tuesday", "Thu 25 Dec 2026": what an hours change is about. */
export function changeScope(change: GoogleChange): string | null {
  const parts =
    change.field === "regularHours"
      ? change.regularDays.map((day) => DAY_NAMES[day] ?? `Day ${day}`)
      : change.field === "specialHours"
        ? change.specialDates.map(formatDate)
        : []
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  // Many dates make a title nobody reads on a phone; the table lists them.
  if (change.field === "specialHours" && parts.length > 2) {
    return `${parts.length} dates`
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
}
