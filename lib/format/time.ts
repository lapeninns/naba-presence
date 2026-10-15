const LOCALE = "en-GB" // Locale policy: en-GB pinned (spec §7).

/** A time of day as the hours model stores it, or as a picker hands it back. */
export type TimeOfDay = string | { hours: number; minutes: number }

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

/**
 * A time of day as 24-hour "HH:mm": "17:00", "09:30", "00:00".
 *
 * The hours fields take 24-hour times, so every confirmation, diff and copy
 * sheet must echo them the same way ("17:00", never "5:00 pm"). Accepts
 * "HH:mm", "H:mm", "HH:mm:ss" and `{ hours, minutes }`. "24:00" (a period
 * closing at the end of the day) stays "24:00", the form Google stores.
 * Anything unreadable is returned as given, so a bad value is visible rather
 * than silently reshaped.
 */
export function formatTimeOfDay(value: TimeOfDay): string {
  let hours: number
  let minutes: number
  if (typeof value === "string") {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim())
    if (!match) return value
    hours = Number(match[1])
    minutes = Number(match[2])
  } else {
    hours = value.hours
    minutes = value.minutes
  }
  const valid =
    Number.isInteger(hours) &&
    Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= 59 &&
    hours >= 0 &&
    (hours <= 23 || (hours === 24 && minutes === 0))
  if (!valid) return typeof value === "string" ? value : ""
  return `${pad(hours)}:${pad(minutes)}`
}

/** What `longGeneric` gives en-GB for Europe/London is too formal for copy. */
const NAMED_ZONES: Record<string, string> = {
  "Europe/London": "UK time",
}

function sameZone(a: string, b: string): boolean {
  if (a === b) return true
  try {
    return (
      new Intl.DateTimeFormat(LOCALE, { timeZone: a }).resolvedOptions()
        .timeZone ===
      new Intl.DateTimeFormat(LOCALE, { timeZone: b }).resolvedOptions()
        .timeZone
    )
  } catch {
    return false
  }
}

/**
 * A friendly name for an IANA zone: "UK time", "New Zealand Time", "Eastern
 * Time", never "Europe/London".
 *
 * Returns null when the zone is the viewer's own (a label that says nothing
 * new is noise) or when it cannot be named, so callers render it only when it
 * is there: `label && <span>{label}</span>`. Pass no `viewerZone` to always
 * get the name.
 */
export function formatTimeZoneLabel(
  timeZone: string,
  viewerZone?: string | null
): string | null {
  if (!timeZone) return null
  if (viewerZone && sameZone(timeZone, viewerZone)) return null
  const named = NAMED_ZONES[timeZone]
  if (named) return named
  try {
    const part = new Intl.DateTimeFormat(LOCALE, {
      timeZone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")
    return part?.value || null
  } catch {
    return null
  }
}
