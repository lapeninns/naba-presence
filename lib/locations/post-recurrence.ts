/**
 * Repeating event and offer posts: Google's `event.recurrenceInfo` read
 * into words and into the composer's fields, and the composer's fields
 * written back in Google's shape.
 *
 * Google repeats a post daily, weekly (on chosen weekdays, or the start
 * date's weekday when none are chosen) or monthly (on a day of the month, or
 * on the nth weekday, the weekday being the start date's). The first run is
 * the event's own schedule, so a repeat always needs a start date.
 */
import {
  DAYS_OF_WEEK,
  type DayOfWeek,
  type DayOfWeekOccurrence,
} from "@/lib/contracts/location-posts"

export type PostRepeat = "none" | "daily" | "weekly" | "monthly"
/** Monthly on the start's day of the month, its nth weekday, or its last. */
export type MonthlyRepeat = "date" | "nth" | "last"

export type RecurrenceFields = {
  repeat: PostRepeat
  weekdays: DayOfWeek[]
  monthly: MonthlyRepeat
  /** `2026-12-31`, or "" for a series that runs until the post is removed. */
  seriesEnd: string
}

export const NO_RECURRENCE: RecurrenceFields = {
  repeat: "none",
  weekdays: [],
  monthly: "date",
  seriesEnd: "",
}

export const WEEKDAY_SHORT: Record<DayOfWeek, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
}

const WEEKDAY_LONG: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
}

const OCCURRENCES = ["FIRST", "SECOND", "THIRD", "FOURTH"] as const
const OCCURRENCE_WORD: Record<DayOfWeekOccurrence, string> = {
  FIRST: "first",
  SECOND: "second",
  THIRD: "third",
  FOURTH: "fourth",
  LAST: "last",
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** `2026-10-02` → its local calendar date, or null. */
function parseDate(value: string): Date | null {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

/** Google's `{ year, month, day }` → `2026-10-02`, or "". */
function isoDate(value: unknown): string {
  const date = record(value)
  if (!date || !date.year || !date.month || !date.day) return ""
  const pad = (part: unknown) => String(part).padStart(2, "0")
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

/** The start date's weekday in Google's vocabulary. */
export function weekdayOf(date: string): DayOfWeek | null {
  const parsed = parseDate(date)
  if (!parsed) return null
  // getDay() counts from Sunday; DAYS_OF_WEEK starts on Monday.
  return DAYS_OF_WEEK[(parsed.getDay() + 6) % 7]
}

/** Which of its month's weekdays the date is: the second Friday → SECOND. */
export function nthWeekdayOf(date: string): DayOfWeekOccurrence | null {
  const parsed = parseDate(date)
  if (!parsed) return null
  return OCCURRENCES[Math.floor((parsed.getDate() - 1) / 7)] ?? "LAST"
}

/** Whether the date is its weekday's last in the month. */
export function isLastWeekdayOf(date: string): boolean {
  const parsed = parseDate(date)
  if (!parsed) return false
  const next = new Date(parsed)
  next.setDate(parsed.getDate() + 7)
  return next.getMonth() !== parsed.getMonth()
}

/** The composer's choices for a monthly repeat, given the start date. */
export function monthlyOptions(
  startDate: string
): Array<{ value: MonthlyRepeat; label: string }> {
  const parsed = parseDate(startDate)
  const weekday = weekdayOf(startDate)
  const nth = nthWeekdayOf(startDate)
  if (!parsed || !weekday || !nth) {
    return [{ value: "date", label: "On the same day each month" }]
  }
  const options: Array<{ value: MonthlyRepeat; label: string }> = [
    { value: "date", label: `On day ${parsed.getDate()}` },
  ]
  // A fifth weekday exists only in some months, so it repeats as "last".
  if (nth !== "LAST") {
    options.push({
      value: "nth",
      label: `On the ${OCCURRENCE_WORD[nth]} ${WEEKDAY_LONG[weekday]}`,
    })
  }
  if (isLastWeekdayOf(startDate)) {
    options.push({
      value: "last",
      label: `On the last ${WEEKDAY_LONG[weekday]}`,
    })
  }
  return options
}

/** A saved post's `event.recurrenceInfo` back into the composer's fields. */
export function recurrenceFields(event: unknown): RecurrenceFields {
  const info = record(record(event)?.recurrenceInfo)
  if (!info) return NO_RECURRENCE
  const seriesEnd =
    typeof info.seriesEndTime === "string"
      ? info.seriesEndTime.slice(0, 10)
      : ""
  if (record(info.dailyPattern)) {
    return { ...NO_RECURRENCE, repeat: "daily", seriesEnd }
  }
  const weekly = record(info.weeklyPattern)
  if (weekly) {
    const days = Array.isArray(weekly.daysOfWeek) ? weekly.daysOfWeek : []
    return {
      ...NO_RECURRENCE,
      repeat: "weekly",
      weekdays: DAYS_OF_WEEK.filter((day) => days.includes(day)),
      seriesEnd,
    }
  }
  const monthly = record(info.monthlyPattern)
  if (monthly) {
    const occurrence = monthly.dayOfWeekOccurrence
    return {
      ...NO_RECURRENCE,
      repeat: "monthly",
      monthly:
        occurrence === "LAST"
          ? "last"
          : typeof occurrence === "string"
            ? "nth"
            : "date",
      seriesEnd,
    }
  }
  return NO_RECURRENCE
}

/**
 * The composer's fields → Google's `recurrenceInfo`, or null when the post
 * does not repeat. The monthly weekday is recomputed from the start date,
 * because Google implies the weekday from it too.
 */
export function googleRecurrence(
  fields: RecurrenceFields,
  startDate: string
): Record<string, unknown> | null {
  if (fields.repeat === "none") return null
  const info: Record<string, unknown> = {}
  if (fields.repeat === "daily") info.dailyPattern = {}
  if (fields.repeat === "weekly") {
    info.weeklyPattern = {
      daysOfWeek: DAYS_OF_WEEK.filter((day) => fields.weekdays.includes(day)),
    }
  }
  if (fields.repeat === "monthly") {
    const start = parseDate(startDate)
    if (fields.monthly === "date" || !start) {
      info.monthlyPattern = { dayOfMonth: start?.getDate() ?? 1 }
    } else {
      info.monthlyPattern = {
        dayOfWeekOccurrence:
          fields.monthly === "last" ? "LAST" : nthWeekdayOf(startDate),
      }
    }
  }
  // The series ends at the close of its last day; Google takes a UTC
  // timestamp, and the listings are UK venues.
  if (fields.seriesEnd) info.seriesEndTime = `${fields.seriesEnd}T23:59:59Z`
  return info
}

function formatDay(date: string): string {
  const parsed = parseDate(date)
  if (!parsed) return ""
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed)
}

/** "Repeats weekly on Fri, Sat until 31 Dec 2026", or "" for a one-off. */
export function describeRecurrence(
  fields: RecurrenceFields,
  startDate: string
): string {
  if (fields.repeat === "none") return ""
  const weekday = weekdayOf(startDate)
  let text = ""
  switch (fields.repeat) {
    case "daily":
      text = "Repeats daily"
      break
    case "weekly": {
      const days = fields.weekdays.length
        ? fields.weekdays
        : weekday
          ? [weekday]
          : []
      text = days.length
        ? `Repeats weekly on ${days.map((day) => WEEKDAY_SHORT[day]).join(", ")}`
        : "Repeats weekly"
      break
    }
    case "monthly": {
      const option = monthlyOptions(startDate).find(
        (entry) => entry.value === fields.monthly
      )
      text = option
        ? `Repeats monthly ${option.label.charAt(0).toLowerCase()}${option.label.slice(1)}`
        : "Repeats monthly"
      break
    }
  }
  const until = fields.seriesEnd ? formatDay(fields.seriesEnd) : ""
  return until ? `${text} until ${until}` : text
}

/** A saved post's repeat in words, for the list. */
export function postRecurrence(event: unknown): string {
  const schedule = record(record(event)?.schedule)
  return describeRecurrence(
    recurrenceFields(event),
    isoDate(schedule?.startDate)
  )
}
