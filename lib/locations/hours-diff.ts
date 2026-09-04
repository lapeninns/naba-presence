import type { NormalizedHours } from "@/lib/contracts/location-hours"
import { DAY_LABELS } from "@/lib/locations/forms/hours"

export type HoursChangeRow = {
  field: string
  before: string
  after: string
  state?: "changed" | "conflict"
}

/** "9:00 am – 5:00 pm", or two ranges, or "Closed". */
export function describeDay(day: NormalizedHours["regular"][number]): string {
  if (day.isClosed || day.periods.length === 0) return "Closed"
  return day.periods
    .map((period) => `${clockTime(period.opensAt)} – ${clockTime(period.closesAt)}`)
    .join(", ")
}

/** 24h "17:30" as the operator reads it: "5:30 pm". */
export function clockTime(value: string): string {
  const [rawHour, minute] = value.split(":")
  const hour = Number(rawHour)
  if (!Number.isInteger(hour)) return value
  const suffix = hour < 12 ? "am" : "pm"
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${minute} ${suffix}`
}

function describeSpecial(hours: NormalizedHours): string {
  if (hours.special.length === 0) return "None"
  return hours.special.length === 1
    ? "1 dated exception"
    : `${hours.special.length} dated exceptions`
}

function describeMore(hours: NormalizedHours): string {
  if (hours.moreHours.length === 0) return "None"
  return hours.moreHours.map((entry) => entry.hoursTypeId).join(", ")
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

/**
 * What publishing this draft would do to Google, field by field.
 *
 * `canonical` is the last saved copy, and it is what separates a plain change
 * from a conflict: if Google's value already differs from what NabaPresence
 * last knew, someone edited that day inside Google and publishing overwrites
 * their work. The old dialog asked about that once for the whole schedule; the
 * rows say which days it actually applies to.
 */
export function hoursChangeRows(input: {
  draft: NormalizedHours
  google: NormalizedHours
  canonical: NormalizedHours
}): HoursChangeRow[] {
  const rows: HoursChangeRow[] = []

  for (const [dayOfWeek, label] of DAY_LABELS.entries()) {
    const draft = describeDay(dayOf(input.draft, dayOfWeek))
    const google = describeDay(dayOf(input.google, dayOfWeek))
    if (draft === google) continue
    const canonical = describeDay(dayOf(input.canonical, dayOfWeek))
    rows.push({
      field: label,
      before: google,
      after: draft,
      state: google === canonical ? "changed" : "conflict",
    })
  }

  const draftSpecial = describeSpecial(input.draft)
  const googleSpecial = describeSpecial(input.google)
  if (draftSpecial !== googleSpecial) {
    rows.push({
      field: "Special hours",
      before: googleSpecial,
      after: draftSpecial,
      state:
        googleSpecial === describeSpecial(input.canonical)
          ? "changed"
          : "conflict",
    })
  }

  const draftMore = describeMore(input.draft)
  const googleMore = describeMore(input.google)
  if (draftMore !== googleMore) {
    rows.push({
      field: "More hours",
      before: googleMore,
      after: draftMore,
      state:
        googleMore === describeMore(input.canonical) ? "changed" : "conflict",
    })
  }

  return rows
}
