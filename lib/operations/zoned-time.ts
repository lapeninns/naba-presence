import { formatDateTime, formatRelativeTime } from "@/lib/format"

/** Whether the runtime knows this IANA zone (a stored value can be stale). */
function knownZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * A time as the organisation's default time zone writes it, with the zone
 * named: "15 Oct, 14:03 (Pacific/Auckland)". With no zone to hand (settings
 * not loaded, or a value the runtime refuses) it says the same relative
 * phrase the page shows, never a clock time in a zone nobody chose.
 */
export function formatZonedTime(
  iso: string,
  timeZone: string | null | undefined,
  now: Date = new Date()
): string {
  return knownZone(timeZone)
    ? `${formatDateTime(iso, timeZone)} (${timeZone})`
    : formatRelativeTime(iso, now)
}

/** The zone to hand `RelativeTime`, or undefined to keep its own default. */
export function usableZone(
  timeZone: string | null | undefined
): string | undefined {
  return knownZone(timeZone) ? timeZone : undefined
}
