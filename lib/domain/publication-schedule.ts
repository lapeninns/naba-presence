/**
 * Publication schedules for posts (WP7). Client-safe and pure.
 *
 * This is when NabaPresence publishes a post, which is separate from a
 * post's own Google event recurrence (`event.recurrenceInfo`). A rule is
 * stored in local terms with an IANA timezone; each occurrence is also
 * stored as the UTC instant it runs.
 *
 * Local-time rules, shown to the approver:
 * - A local time that does not exist (spring forward) runs at the first valid
 *   local time after it, the moment the clocks change.
 * - A local time that happens twice (autumn back) runs once, at the earlier
 *   of the two instants.
 * - A monthly day a month does not have (the 31st in April) is skipped.
 */
import { z } from "zod"

export const DEFAULT_SCHEDULE_TIMEZONE = "Europe/London"
export const MAX_SCHEDULE_OCCURRENCES = 366
/** How late a missed occurrence may still publish. Older ones are recorded as missed. */
export const MISSED_RUN_GRACE_MS = 24 * 60 * 60 * 1000

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    )
  }, "Enter a real date.")
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 09:30.")

export function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value })
    return true
  } catch {
    return false
  }
}

const end = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("date"), date: isoDate }),
  z.strictObject({
    type: z.literal("count"),
    count: z.number().int().min(1).max(MAX_SCHEDULE_OCCURRENCES),
  }),
])

/**
 * Explicit event dates relative to each occurrence's local date, for event
 * and offer posts that repeat. Shown in the preview and frozen by approval.
 */
export const eventOffsetsSchema = z
  .strictObject({
    startDays: z.number().int().min(0).max(365),
    endDays: z.number().int().min(0).max(365),
  })
  .refine(
    (value) => value.endDays >= value.startDays,
    "The event cannot end before it starts."
  )

export const scheduleRuleSchema = z
  .discriminatedUnion("frequency", [
    z.strictObject({
      frequency: z.literal("once"),
      startDate: isoDate,
      localTime,
    }),
    z.strictObject({
      frequency: z.literal("daily"),
      startDate: isoDate,
      localTime,
      end,
    }),
    z.strictObject({
      frequency: z.literal("weekly"),
      startDate: isoDate,
      localTime,
      end,
      /** ISO weekdays, Monday = 1. */
      weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    }),
    z.strictObject({
      frequency: z.literal("monthly"),
      startDate: isoDate,
      localTime,
      end,
      dayOfMonth: z.number().int().min(1).max(31),
    }),
  ])
  .superRefine((rule, context) => {
    if (
      rule.frequency !== "once" &&
      rule.end.type === "date" &&
      rule.end.date < rule.startDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["end", "date"],
        message: "The end date is before the start date.",
      })
    }
    if (
      rule.frequency === "weekly" &&
      new Set(rule.weekdays).size !== rule.weekdays.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["weekdays"],
        message: "Choose each day once.",
      })
    }
  })
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimezone, "Choose a valid timezone.")

type Wall = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function wallAt(instant: number, timeZone: string): Wall {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value])
  )
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}
const wallMs = (wall: Wall) =>
  Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
/** Minutes the zone is ahead of UTC at an instant. */
function offsetAt(instant: number, timeZone: string) {
  return (
    (wallMs(wallAt(instant, timeZone)) -
      Math.floor(instant / 60_000) * 60_000) /
    60_000
  )
}

export type LocalResolution = {
  instant: Date
  adjustment: "none" | "moved_forward" | "earlier_of_repeated"
}

/** The UTC instant for a local wall time under the rules above. */
export function resolveLocalTime(
  date: string,
  time: string,
  timeZone: string
): LocalResolution {
  const [year, month, day] = date.split("-").map(Number),
    [hour, minute] = time.split(":").map(Number)
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const offsets = new Set([
    offsetAt(target - 36 * 3_600_000, timeZone),
    offsetAt(target, timeZone),
    offsetAt(target + 36 * 3_600_000, timeZone),
  ])
  const matches = [...offsets]
    .map((offset) => target - offset * 60_000)
    .filter((instant) => wallMs(wallAt(instant, timeZone)) === target)
    .sort((a, b) => a - b)
  if (matches.length)
    return {
      instant: new Date(matches[0]),
      adjustment: matches.length > 1 ? "earlier_of_repeated" : "none",
    }
  // Inside a spring-forward gap: find the first instant whose local time is after the target.
  let low = target - Math.max(...offsets) * 60_000,
    high = target - Math.min(...offsets) * 60_000
  while (high - low > 60_000) {
    const middle = low + Math.floor((high - low) / 120_000) * 60_000
    if (wallMs(wallAt(middle, timeZone)) > target) high = middle
    else low = middle
  }
  return { instant: new Date(high), adjustment: "moved_forward" }
}

/**
 * What a clock change did to one occurrence, in the approver's words. The two
 * cases differ and must never share wording: a spring-forward time does not
 * exist, so the run is moved to the first valid time after it; an autumn-back
 * time happens twice, so nothing moves and it runs once, at the earlier of
 * the two instants.
 */
export function clockChangeNote(adjustment: string): string | null {
  if (adjustment === "moved_forward")
    return "Clocks go forward: this time doesn’t exist that day, so it runs at the first valid time after it"
  if (adjustment === "earlier_of_repeated")
    return "Clocks go back: this time happens twice that day, so it runs once, at the earlier of the two"
  return null
}

/**
 * How many occurrences a clock change affects, without claiming they all
 * moved: only spring-forward ones do. Null when none are affected.
 */
export function clockChangeCountNote(adjusted: number): string | null {
  if (adjusted <= 0) return null
  return `${adjusted} ${adjusted === 1 ? "falls" : "fall"} on a clock change (see each time below)`
}

export type PlannedOccurrence = {
  intendedAt: string
  localDate: string
  localTime: string
  adjustment: LocalResolution["adjustment"]
}
export type ScheduleExpansion = {
  occurrences: PlannedOccurrence[]
  skippedDates: string[]
  truncated: boolean
}

const pad = (value: number) => String(value).padStart(2, "0")
const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const isoWeekday = (date: string) =>
  ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1

/** Every occurrence of a bounded rule, in order, with skipped month days listed. */
export function expandSchedule(
  rule: ScheduleRule,
  timeZone: string
): ScheduleExpansion {
  const occurrences: PlannedOccurrence[] = [],
    skippedDates: string[] = []
  const limit =
    rule.frequency === "once"
      ? 1
      : rule.end.type === "count"
        ? rule.end.count
        : MAX_SCHEDULE_OCCURRENCES
  const lastDate =
    rule.frequency !== "once" && rule.end.type === "date" ? rule.end.date : null
  const push = (date: string) => {
    const resolved = resolveLocalTime(date, rule.localTime, timeZone)
    const wall = wallAt(resolved.instant.getTime(), timeZone)
    occurrences.push({
      intendedAt: resolved.instant.toISOString(),
      localDate: date,
      localTime: `${pad(wall.hour)}:${pad(wall.minute)}`,
      adjustment: resolved.adjustment,
    })
  }
  if (rule.frequency === "once") {
    push(rule.startDate)
    return { occurrences, skippedDates, truncated: false }
  }
  if (rule.frequency === "monthly") {
    const [startYear, startMonth] = rule.startDate.split("-").map(Number)
    for (
      let index = 0;
      occurrences.length < limit && index < 12 * 31;
      index += 1
    ) {
      const year = startYear + Math.floor((startMonth - 1 + index) / 12),
        month = ((startMonth - 1 + index) % 12) + 1
      const date = `${year}-${pad(month)}-${pad(rule.dayOfMonth)}`
      const exists =
        new Date(Date.UTC(year, month - 1, rule.dayOfMonth)).getUTCMonth() ===
        month - 1
      if (lastDate && `${year}-${pad(month)}-01` > lastDate) break
      if (!exists) {
        skippedDates.push(`${year}-${pad(month)}`)
        continue
      }
      if (date < rule.startDate || (lastDate && date > lastDate)) continue
      push(date)
    }
  } else {
    for (
      let date = rule.startDate, guard = 0;
      occurrences.length < limit && guard < 3_000;
      date = addDays(date, 1), guard += 1
    ) {
      if (lastDate && date > lastDate) break
      if (
        rule.frequency === "weekly" &&
        !rule.weekdays.includes(isoWeekday(date))
      )
        continue
      push(date)
    }
  }
  const truncated =
    lastDate !== null && occurrences.length >= MAX_SCHEDULE_OCCURRENCES
  return { occurrences, skippedDates, truncated }
}

/**
 * Which due occurrences publish now. Only the most recent one inside the
 * grace period runs; every other due occurrence is recorded as missed.
 */
export function selectDueOccurrences<T extends { intendedAt: string }>(
  due: readonly T[],
  now: Date
) {
  const ordered = [...due].sort((a, b) =>
    a.intendedAt.localeCompare(b.intendedAt)
  )
  const latest = ordered.at(-1)
  const run =
    latest &&
    now.getTime() - Date.parse(latest.intendedAt) <= MISSED_RUN_GRACE_MS
      ? latest
      : null
  return { run, missed: ordered.filter((occurrence) => occurrence !== run) }
}

/** Event dates for an occurrence, from its local date and the frozen offsets. */
export function occurrenceEventDates(
  localDate: string,
  offsets: z.infer<typeof eventOffsetsSchema>
) {
  return {
    startDate: addDays(localDate, offsets.startDays),
    endDate: addDays(localDate, offsets.endDays),
  }
}

/** An event or offer that has ended by the run time is not published late. */
export function contentExpired(
  eventEndDate: string | null,
  now: Date,
  timeZone: string
) {
  if (!eventEndDate) return false
  const today = (() => {
    const wall = wallAt(now.getTime(), timeZone)
    return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`
  })()
  return eventEndDate < today
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]
const ordinal = (value: number) =>
  `${value}${value % 10 === 1 && value !== 11 ? "st" : value % 10 === 2 && value !== 12 ? "nd" : value % 10 === 3 && value !== 13 ? "rd" : "th"}`

/** "Every Monday and Wednesday at 09:30 (Europe/London), 4 times" and similar. */
export function describeScheduleRule(rule: ScheduleRule, timeZone: string) {
  const at = `at ${rule.localTime} (${timeZone})`
  const ending =
    rule.frequency === "once"
      ? ""
      : rule.end.type === "count"
        ? `, ${rule.end.count} ${rule.end.count === 1 ? "time" : "times"}`
        : `, until ${rule.end.date}`
  switch (rule.frequency) {
    case "once":
      return `Once on ${rule.startDate} ${at}`
    case "daily":
      return `Every day from ${rule.startDate} ${at}${ending}`
    case "weekly":
      return `Every ${[...rule.weekdays]
        .sort()
        .map((day) => WEEKDAY_NAMES[day - 1])
        .join(", ")} from ${rule.startDate} ${at}${ending}`
    case "monthly":
      return `On the ${ordinal(rule.dayOfMonth)} of each month from ${rule.startDate} ${at}${ending}; months without that day are skipped`
  }
}
