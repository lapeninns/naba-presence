import {
  localWallTime,
  resolveLocalTime,
  type ScheduleRule,
} from "@/lib/domain/publication-schedule"
import { formatShortDate } from "@/lib/format"

/**
 * Wall-date helpers for the schedule sheet's presets and the schedule rows.
 * Presentation only: every date here is a venue wall date (YYYY-MM-DD) and
 * every instant is resolved by the publication-schedule domain helpers, so
 * a clock change is handled exactly as the full form handles it.
 */

/** The hour a preset publishes at, in the venue's own time. */
export const PRESET_TIME = "09:00"

export type SchedulePreset = "tomorrow" | "monday"

function wallUtc(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** `2026-10-14` + 1 → `2026-10-15`, on the calendar (never on a clock). */
export function addWallDays(date: string, days: number) {
  const value = wallUtc(date)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** `2026-10-15` → "Thu 15 Oct". */
export function formatWallDay(date: string) {
  return formatShortDate(wallUtc(date), {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/**
 * The wall dates the presets stand for, from the moment the sheet opened,
 * read in the venue's zone: tomorrow there, and the next Monday there (a
 * week on when it is Monday already).
 */
export function presetDates(
  openedAt: number,
  zone: string
): Record<SchedulePreset, string> {
  const today = localWallTime(new Date(openedAt), zone).date
  const weekday = wallUtc(today).getUTCDay()
  return {
    tomorrow: addWallDays(today, 1),
    monday: addWallDays(today, (8 - weekday) % 7 || 7),
  }
}

/** "BST", "CEST", "GMT-4": the zone's short name at that wall time. */
export function zoneAbbreviation(
  date: string,
  time: string,
  zone: string,
  offsetMinutes: number | null = null
) {
  // A one-time slot on a repeated hour carries the offset it was booked
  // with, which says which of the two (BST or GMT) it is.
  const [hours, minutes] = time.split(":").map(Number)
  const instant =
    offsetMinutes === null
      ? resolveLocalTime(date, time, zone).instant
      : new Date(
          wallUtc(date).getTime() +
            (hours * 60 + minutes - offsetMinutes) * 60_000
        )
  return (
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? zone
  )
}

const FREQUENCY: Record<ScheduleRule["frequency"], string> = {
  once: "Once",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
}

/** A schedule row's first line: "Mon 20 Oct, 09:00 BST · Once". */
export function scheduleWhen(
  rule: ScheduleRule,
  zone: string,
  offsetMinutes: number | null = null
) {
  const at = `${formatWallDay(rule.startDate)}, ${rule.localTime} ${zoneAbbreviation(
    rule.startDate,
    rule.localTime,
    zone,
    rule.frequency === "once" ? offsetMinutes : null
  )}`
  return rule.frequency === "once"
    ? `${at} · Once`
    : `From ${at} · ${FREQUENCY[rule.frequency]}`
}
