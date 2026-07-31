const LOCALE = "en-GB" // Locale policy: en-GB pinned (spec §7).

function yearIn(timeZone: string, date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" }).format(date)
  )
}

function datePart(date: Date, timeZone: string): string {
  const withYear = yearIn(timeZone, date) !== yearIn(timeZone, new Date())
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(date)
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
