/**
 * Date arithmetic for the publication calendar.
 *
 * Every calendar day is a plain `YYYY-MM-DD` string: an occurrence's
 * `localDate` is already the listing's own local date, so the grid never
 * converts instants to days itself. Arithmetic on those strings goes through
 * UTC midnight, where every day is exactly 24 hours long.
 */

export type CalendarView = "month" | "week" | "agenda"

export const CALENDAR_VIEWS: readonly CalendarView[] = [
  "month",
  "week",
  "agenda",
]
export const DEFAULT_VIEW: CalendarView = "month"

export const DAY = 86_400_000

export const iso = (date: Date) => date.toISOString().slice(0, 10)
export const utcDay = (value: string) => new Date(`${value}T00:00:00Z`)

export function isCalendarView(value: string | null): value is CalendarView {
  return CALENDAR_VIEWS.includes(value as CalendarView)
}

/** A real `YYYY-MM-DD` date (not 2026-02-31), or null. */
export function parseDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = utcDay(value)
  return Number.isNaN(date.getTime()) || iso(date) !== value ? null : value
}

/**
 * Today's date in `timeZone` (the organisation's), or in the browser's zone
 * when none is known. Never `toISOString()`, which is the UTC date: for a
 * New Zealand workspace that is still yesterday until 13:00.
 */
export function todayIn(timeZone: string | undefined, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value ?? ""
    return `${part("year")}-${part("month")}-${part("day")}`
  } catch {
    // An unknown zone name: fall back to the browser's own.
    return timeZone ? todayIn(undefined, now) : iso(now)
  }
}

export function startOfWeek(date: Date) {
  const day = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - day * DAY)
}

/** Month cells run Monday to Sunday and cover whole weeks. */
export function windowFor(view: CalendarView, anchor: Date) {
  if (view === "week") {
    const from = startOfWeek(anchor)
    return { from, to: new Date(from.getTime() + 7 * DAY) }
  }
  if (view === "agenda")
    return { from: anchor, to: new Date(anchor.getTime() + 31 * DAY) }
  const first = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)
  )
  const from = startOfWeek(first)
  const last = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)
  )
  return { from, to: new Date(startOfWeek(last).getTime() + 7 * DAY) }
}

/** The anchor one period earlier or later. */
export function stepAnchor(
  view: CalendarView,
  anchor: Date,
  direction: 1 | -1
): Date {
  if (view === "month")
    return new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1)
    )
  return new Date(
    anchor.getTime() + direction * (view === "week" ? 7 : 31) * DAY
  )
}

/** Thin and narrow no-break spaces, which ICU versions use differently. */
const ICU_SPACES = /[\u2009\u202f]/g

/**
 * "October 2026" for a month; "12 – 18 Oct 2026" (or "28 Sept – 4 Oct 2026")
 * for a week or the agenda's 31 days, never two ISO dates.
 *
 * The range is spaced with plain spaces whatever the ICU data says: newer ICU
 * (Node's) puts thin spaces (U+2009) around the dash where browsers put plain
 * ones, and that one-character difference made the server's heading differ
 * from the browser's, so the calendar failed to hydrate (React #418).
 */
export function periodHeading(
  view: CalendarView,
  anchor: Date,
  range: { from: Date; to: Date }
): string {
  if (view === "month")
    return new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(anchor)
  const last = new Date(range.to.getTime() - DAY)
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .formatRange(range.from, last)
    .replace(ICU_SPACES, " ")
}

/** "Tuesday 14 October". */
export const longDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(utcDay(day))
