import type { NormalizedHours } from "@/lib/api/location-hours"
import { DAY_LABELS } from "@/lib/locations/forms/hours"
import { describeDay, clockTime } from "@/lib/locations/hours-diff"

/**
 * Presentation helpers for the opening-hours editor: display order, the
 * field ids the validation summary links to, the checks the editor runs
 * before a save or a review, and sensible defaults for a new period.
 *
 * Nothing here changes what is saved: the wire contract
 * (`hoursInputSchema`) stays the authority, and these checks only catch, in
 * words, the mistakes it would reject or that Google would show wrongly.
 */

type Day = NormalizedHours["regular"][number]
type Period = Day["periods"][number]
type Special = NormalizedHours["special"][number]

/** The UK week: Monday first. Values are `dayOfWeek` (0 = Sunday). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export const hoursFieldId = {
  dayOpen: (dayOfWeek: number) => `hours-${dayOfWeek}-open`,
  opens: (dayOfWeek: number, index: number) =>
    `hours-${dayOfWeek}-${index}-opens`,
  closes: (dayOfWeek: number, index: number) =>
    `hours-${dayOfWeek}-${index}-closes`,
  specialDate: (index: number) => `special-${index}-date`,
  specialOpens: (index: number) => `special-${index}-opens`,
  specialCloses: (index: number) => `special-${index}-closes`,
}

export function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number)
  return hours * 60 + mins
}

function hhmm(total: number): string {
  const clamped = Math.max(0, Math.min(total, 23 * 60 + 59))
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`
}

/** A period that closes at or before it opens runs past midnight. */
function span(period: Period): { start: number; end: number } {
  const start = minutes(period.opensAt)
  const close = minutes(period.closesAt)
  return { start, end: close <= start ? close + 24 * 60 : close }
}

/**
 * The periods after adding a split. A day with one long period is split in
 * two around its middle with an hour's break (the lunch/evening split this
 * control exists for); otherwise a two-hour period is added an hour after
 * the last one closes. Never an overlapping default.
 */
export function withSplitPeriod(periods: readonly Period[]): Period[] {
  if (periods.length === 0) return [{ opensAt: "09:00", closesAt: "17:00" }]
  const last = periods[periods.length - 1]
  if (!last.opensAt || !last.closesAt) return [...periods]
  const { start, end } = span(last)
  if (periods.length === 1 && end - start >= 4 * 60 && end <= 24 * 60) {
    const middle = Math.round((start + end) / 2 / 30) * 30
    return [
      { opensAt: last.opensAt, closesAt: hhmm(middle - 30) },
      { opensAt: hhmm(middle + 30), closesAt: last.closesAt },
    ]
  }
  const nextStart = end + 60
  if (nextStart + 60 <= 23 * 60 + 59) {
    return [
      ...periods,
      {
        opensAt: hhmm(nextStart),
        closesAt: hhmm(Math.min(nextStart + 120, 23 * 60 + 59)),
      },
    ]
  }
  // No room after the last period: split the longest one instead.
  const longest = periods.reduce(
    (best, period, index) => {
      const s = span(period)
      return s.end - s.start > best.length && s.end <= 24 * 60
        ? { index, length: s.end - s.start }
        : best
    },
    { index: -1, length: 0 }
  )
  if (longest.index === -1 || longest.length < 3 * 60) return [...periods]
  const target = periods[longest.index]
  const s = span(target)
  const middle = Math.round((s.start + s.end) / 2 / 30) * 30
  const next = [...periods]
  next.splice(
    longest.index,
    1,
    { opensAt: target.opensAt, closesAt: hhmm(middle - 30) },
    { opensAt: hhmm(middle + 30), closesAt: target.closesAt }
  )
  return next
}

/** Whether another period can be added without an overlapping default. */
export function canSplit(periods: readonly Period[]): boolean {
  if (periods.length >= 3) return false
  return JSON.stringify(withSplitPeriod(periods)) !== JSON.stringify(periods)
}

export function sameDay(left: Day | undefined, right: Day | undefined) {
  if (!left || !right) return left === right
  return describeDay(left) === describeDay(right)
}

export function dayOf(hours: NormalizedHours, dayOfWeek: number): Day {
  return (
    hours.regular.find((day) => day.dayOfWeek === dayOfWeek) ?? {
      dayOfWeek,
      isClosed: true,
      periods: [],
    }
  )
}

export function formatSpecialDate(value: string): string {
  if (!value) return "No date"
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function describeSpecialEntry(entry: Special | undefined): string {
  if (!entry) return ""
  if (entry.isClosed) return "Closed"
  return `${entry.opensAt ? clockTime(entry.opensAt) : "?"} – ${entry.closesAt ? clockTime(entry.closesAt) : "?"}`
}

export type HoursIssue = { fieldId: string; label: string; message: string }

/** Every problem in the draft, in page order, each tied to a field. */
export function validateHours(hours: NormalizedHours): HoursIssue[] {
  const issues: HoursIssue[] = []
  for (const dayOfWeek of WEEK_ORDER) {
    const day = dayOf(hours, dayOfWeek)
    const label = DAY_LABELS[dayOfWeek]
    if (day.isClosed) continue
    if (day.periods.length === 0) {
      issues.push({
        fieldId: hoursFieldId.dayOpen(dayOfWeek),
        label,
        message: "Add opening times, or switch the day to Closed.",
      })
      continue
    }
    const spans: { start: number; end: number; text: string }[] = []
    day.periods.forEach((period, index) => {
      const fieldId = hoursFieldId.opens(dayOfWeek, index)
      if (!period.opensAt || !period.closesAt) {
        issues.push({
          fieldId,
          label,
          message: "Enter both an opening and a closing time.",
        })
        return
      }
      if (period.opensAt === period.closesAt) {
        issues.push({
          fieldId,
          label,
          message: "Opening and closing times are the same.",
        })
        return
      }
      const current = span(period)
      const hit = spans.find(
        (other) => current.start < other.end && current.end > other.start
      )
      if (hit) {
        issues.push({
          fieldId,
          label,
          message: `Overlaps ${hit.text}. Split periods can’t overlap.`,
        })
        return
      }
      spans.push({
        ...current,
        text: `${clockTime(period.opensAt)} – ${clockTime(period.closesAt)}`,
      })
    })
  }

  const seen = new Set<string>()
  hours.special.forEach((entry, index) => {
    const label = `Special date ${index + 1}`
    const fieldId = hoursFieldId.specialDate(index)
    if (!entry.effectiveDate) {
      issues.push({ fieldId, label, message: "Choose a date." })
      return
    }
    if (seen.has(entry.effectiveDate)) {
      issues.push({
        fieldId,
        label,
        message: `${formatSpecialDate(entry.effectiveDate)} is already listed. Remove one of them.`,
      })
      return
    }
    seen.add(entry.effectiveDate)
    if (!entry.isClosed) {
      if (!entry.opensAt || !entry.closesAt) {
        issues.push({
          fieldId: hoursFieldId.specialOpens(index),
          label,
          message: "Enter both times, or mark the day Closed.",
        })
      } else if (entry.opensAt === entry.closesAt) {
        issues.push({
          fieldId: hoursFieldId.specialOpens(index),
          label,
          message: "Opening and closing times are the same.",
        })
      }
    }
  })
  return issues
}

/**
 * The review rows for special hours, one per date, instead of a count: a
 * reviewer needs to see that 25 December becomes Closed, not that "2 dated
 * exceptions" became "3".
 */
export function specialChangeRows(input: {
  draft: NormalizedHours
  google: NormalizedHours
  canonical: NormalizedHours
}) {
  const dates = [
    ...new Set([
      ...input.google.special.map((entry) => entry.effectiveDate),
      ...input.draft.special.map((entry) => entry.effectiveDate),
    ]),
  ]
    .filter(Boolean)
    .sort()
  const rows: {
    key: string
    field: string
    before: string
    after: string
    state: "changed" | "conflict"
  }[] = []
  for (const date of dates) {
    const find = (hours: NormalizedHours) =>
      hours.special.find((entry) => entry.effectiveDate === date)
    const before = describeSpecialEntry(find(input.google))
    const after = describeSpecialEntry(find(input.draft))
    if (before === after) continue
    const canonical = describeSpecialEntry(find(input.canonical))
    rows.push({
      key: `special-${date}`,
      field: formatSpecialDate(date),
      before,
      after,
      state: before === canonical ? "changed" : "conflict",
    })
  }
  return rows
}
