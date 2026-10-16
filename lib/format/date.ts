const LOCALE = "en-GB" // Locale policy: en-GB pinned (spec §7).

function yearIn(timeZone: string, date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" }).format(date)
  )
}

/**
 * The UK short months, as the en-GB data in Node and Chromium spell them.
 * Safari's en-GB data says "Sep", so a page rendered on the server and
 * hydrated in WebKit disagreed on the text ("18 Sept – 16 Oct" against "18
 * Sep – 16 Oct") and React rejected it (#418 on /reports). The month comes
 * from its number, so every engine writes the same words.
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
] as const

function numericParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? ""
  return {
    day: Number(part("day")),
    month: MONTHS[Number(part("month")) - 1] ?? part("month"),
    year: part("year"),
  }
}

function datePart(date: Date, timeZone: string): string {
  const withYear = yearIn(timeZone, date) !== yearIn(timeZone, new Date())
  const { day, month, year } = numericParts(date, timeZone)
  return `${day} ${month}${withYear ? ` ${year}` : ""}`
}

/** "5 Sept": the day and short month in `timeZone`, never with a year. */
export function formatDayMonth(date: Date, timeZone: string): string {
  const { day, month } = numericParts(date, timeZone)
  return `${day} ${month}`
}

/** "Sept 2026": the short month and year in `timeZone`. */
export function formatMonthYear(date: Date, timeZone: string): string {
  const { month, year } = numericParts(date, timeZone)
  return `${month} ${year}`
}

export function formatDate(iso: string, timeZone: string): string {
  return datePart(new Date(iso), timeZone)
}

export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
  return `${datePart(date, timeZone)}, ${time}`
}

/**
 * "4 min ago", "2 days ago", "Just now".
 *
 * Sync freshness is the one place a relative time is the right answer: an
 * operator checking whether a client is up to date cares about the gap, not
 * the clock time, and a timestamp would make them do the subtraction. `now` is
 * injected so tests are deterministic.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (!Number.isFinite(then.getTime())) return "Unknown"
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000)
  if (seconds < 0) return "Just now"
  if (seconds < 60) return "Just now"

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["month", 2592000],
    ["year", 31536000],
  ]
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]
  for (const unit of units) {
    if (seconds >= unit[1]) chosen = unit
  }
  const formatter = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" })
  return formatter.format(-Math.floor(seconds / chosen[1]), chosen[0])
}
