import type { NormalizedHours } from "@/lib/contracts/location-hours"
import { DAY_LABELS } from "@/lib/locations/forms/hours"

export type HoursChangeRow = {
  key: string
  field: string
  before: string
  after: string
  state: "changed" | "conflict"
}

/** Show an explicit ending weekday whenever it differs from the opening day. */
export function describeDay(day: NormalizedHours["regular"][number]): string {
  if (day.isClosed || day.periods.length === 0) return "Closed"
  return day.periods
    .map((period) => {
      const end = period.closeDayOfWeek ?? day.dayOfWeek
      return `${clockTime(period.opensAt)} – ${clockTime(period.closesAt)}${end !== day.dayOfWeek ? ` (${DAY_LABELS[end]})` : ""}`
    })
    .join(", ")
}

export function clockTime(value: string): string {
  if (value === "24:00") return "midnight (end of day)"
  const [rawHour, minute] = value.split(":")
  const hour = Number(rawHour)
  if (!Number.isInteger(hour)) return value
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? "am" : "pm"}`
}

export function describeSpecialEntry(
  entry: NormalizedHours["special"][number] | undefined
): string {
  if (!entry) return ""
  if (entry.isClosed) return "Closed"
  const end = entry.endDate ?? entry.effectiveDate
  return `${entry.opensAt ? clockTime(entry.opensAt) : "?"} – ${entry.closesAt ? clockTime(entry.closesAt) : "?"}${end !== entry.effectiveDate ? ` (${end})` : ""}`
}

function dayOf(hours: NormalizedHours, dayOfWeek: number) {
  return (
    hours.regular.find((day) => day.dayOfWeek === dayOfWeek) ?? {
      dayOfWeek,
      isClosed: true,
      periods: [],
    }
  )
}

export function serviceWeek(
  entry: NormalizedHours["moreHours"][number]
): NormalizedHours["regular"] {
  return DAY_LABELS.map((_, dayOfWeek) => {
    const periods = entry.periods
      .filter((period) => period.dayOfWeek === dayOfWeek)
      .map(({ opensAt, closesAt, closeDayOfWeek }) => ({
        opensAt,
        closesAt,
        ...(closeDayOfWeek === undefined ? {} : { closeDayOfWeek }),
      }))
    return { dayOfWeek, isClosed: periods.length === 0, periods }
  })
}

/** Exact outbound values. A saved copy alone cannot prove when Google changed. */
export function hoursChangeRows(input: {
  draft: NormalizedHours
  google: NormalizedHours
  canonical: NormalizedHours
  supportedHoursTypes?: ReadonlyArray<{
    hoursTypeId: string
    displayName: string
  }>
}): HoursChangeRow[] {
  const rows: HoursChangeRow[] = []
  function add(key: string, field: string, before: string, after: string) {
    if (before !== after)
      rows.push({ key, field, before, after, state: "changed" })
  }
  for (const [dayOfWeek, label] of DAY_LABELS.entries()) {
    add(
      `regular-${dayOfWeek}`,
      label,
      describeDay(dayOf(input.google, dayOfWeek)),
      describeDay(dayOf(input.draft, dayOfWeek))
    )
  }
  const dates = [
    ...new Set(
      [...input.google.special, ...input.draft.special].map(
        (entry) => entry.effectiveDate
      )
    ),
  ]
    .filter(Boolean)
    .sort()
  for (const date of dates) {
    const describe = (hours: NormalizedHours) =>
      hours.special
        .filter((entry) => entry.effectiveDate === date)
        .map(describeSpecialEntry)
        .join("; ")
    add(
      `special-${date}`,
      `Special hours · ${date}`,
      describe(input.google),
      describe(input.draft)
    )
  }
  const ids = [
    ...new Set(
      [...input.google.moreHours, ...input.draft.moreHours].map(
        (entry) => entry.hoursTypeId
      )
    ),
  ]
  for (const id of ids) {
    const before = input.google.moreHours.find(
      (entry) => entry.hoursTypeId === id
    )
    const after = input.draft.moreHours.find(
      (entry) => entry.hoursTypeId === id
    )
    const label =
      input.supportedHoursTypes?.find((type) => type.hoursTypeId === id)
        ?.displayName ?? id
    if (!before || !after) {
      const describe = (entry: typeof before) =>
        entry
          ? serviceWeek(entry)
              .filter((day) => !day.isClosed)
              .map((day) => `${DAY_LABELS[day.dayOfWeek]}: ${describeDay(day)}`)
              .join("; ") || "Closed all week"
          : "Schedule not listed"
      add(
        `service-${id}`,
        `${label} schedule`,
        describe(before),
        describe(after)
      )
      continue
    }
    const beforeWeek = serviceWeek(before)
    const afterWeek = serviceWeek(after)
    for (const [dayOfWeek, dayLabel] of DAY_LABELS.entries()) {
      add(
        `service-${id}-${dayOfWeek}`,
        `${label} · ${dayLabel}`,
        describeDay(beforeWeek[dayOfWeek]),
        describeDay(afterWeek[dayOfWeek])
      )
    }
  }
  return rows
}
