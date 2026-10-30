/**
 * England and Wales bank holidays, computed rather than fetched, so the
 * completeness checks stay pure and never call out. Pubs set special hours
 * for the day itself, so Christmas Day, Boxing Day and New Year's Day are
 * listed on their calendar dates, with any substitute weekday alongside.
 * One-off holidays (a coronation, a jubilee) are not predictable and are
 * left out. Client-safe.
 */

export type BankHoliday = {
  /** YYYY-MM-DD. */
  date: string
  name: string
}

const DAY_MS = 86_400_000

function iso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

function weekday(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Easter Sunday by the anonymous Gregorian algorithm, as [month, day]. */
function easterSunday(year: number): [number, number] {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return [month, day]
}

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

function firstMonday(year: number, month: number): string {
  const offset = (8 - weekday(year, month, 1)) % 7
  return iso(year, month, 1 + offset)
}

function lastMonday(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const offset = (weekday(year, month, last) + 6) % 7
  return iso(year, month, last - offset)
}

/** England and Wales bank holidays for a year, ascending by date. */
export function englandBankHolidays(year: number): BankHoliday[] {
  const days: BankHoliday[] = []
  const substitute = (name: string) => `${name} (substitute day)`

  days.push({ date: iso(year, 1, 1), name: "New Year’s Day" })
  const newYear = weekday(year, 1, 1)
  if (newYear === 6 || newYear === 0)
    days.push({
      date: iso(year, 1, newYear === 6 ? 3 : 2),
      name: substitute("New Year’s Day"),
    })

  const [month, day] = easterSunday(year)
  const easter = iso(year, month, day)
  days.push({ date: shift(easter, -2), name: "Good Friday" })
  days.push({ date: shift(easter, 1), name: "Easter Monday" })
  days.push({ date: firstMonday(year, 5), name: "Early May bank holiday" })
  days.push({ date: lastMonday(year, 5), name: "Spring bank holiday" })
  days.push({ date: lastMonday(year, 8), name: "Summer bank holiday" })

  days.push({ date: iso(year, 12, 25), name: "Christmas Day" })
  days.push({ date: iso(year, 12, 26), name: "Boxing Day" })
  const christmas = weekday(year, 12, 25)
  if (christmas === 6) {
    days.push({ date: iso(year, 12, 27), name: substitute("Christmas Day") })
    days.push({ date: iso(year, 12, 28), name: substitute("Boxing Day") })
  } else if (christmas === 5) {
    days.push({ date: iso(year, 12, 28), name: substitute("Boxing Day") })
  } else if (christmas === 0) {
    days.push({ date: iso(year, 12, 27), name: substitute("Christmas Day") })
  }

  return days.sort((left, right) => left.date.localeCompare(right.date))
}

const LONDON = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/** Today's date in Europe/London as YYYY-MM-DD. */
export function londonDate(now: Date): string {
  return LONDON.format(now)
}

/**
 * The first bank holiday from today (in London) up to `withinDays` ahead,
 * inclusive; null when none falls in that window.
 */
export function nextBankHoliday(
  now: Date,
  withinDays: number
): BankHoliday | null {
  const today = londonDate(now)
  const last = shift(today, withinDays)
  const year = Number(today.slice(0, 4))
  const candidates = [
    ...englandBankHolidays(year),
    ...englandBankHolidays(year + 1),
  ]
  return (
    candidates.find(
      (holiday) => holiday.date >= today && holiday.date <= last
    ) ?? null
  )
}
