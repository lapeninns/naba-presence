// Client-safe vocabulary for the Google change watch: the protected fields,
// their labels, the value shapes and the pure normalisers that decide whether
// Google's copy of a field really differs from ours. No node:crypto: the
// value hash and the detection rule live in lib/domain/google-change-watch.ts,
// which re-exports everything here. See lib/domain/README.md.
//
// Idea (not code) from OpenGMB profile/watch.ts: compare normalised values,
// never raw provider payloads, so a representation change on Google's side is
// not reported as somebody editing the listing.
import {
  canonicalJson,
  type NormalizedHours,
} from "@/lib/domain/hours-vocabulary"

/** The listing fields the watch can protect, in the order they are shown. */
export const WATCHED_FIELDS = [
  "name",
  "description",
  "phone",
  "website",
  "primaryCategory",
  "regularHours",
  "specialHours",
] as const
export type WatchedField = (typeof WATCHED_FIELDS)[number]

/** Every field is protected until someone switches one off. */
export const DEFAULT_PROTECTED_FIELDS: readonly WatchedField[] = WATCHED_FIELDS

export const WATCHED_FIELD_LABELS: Record<WatchedField, string> = {
  name: "Business name",
  phone: "Phone",
  website: "Website",
  description: "Description",
  primaryCategory: "Primary category",
  regularHours: "Opening hours",
  specialHours: "Special hours",
}

/** The fields "Put ours back" sends as one reviewed business-information change. */
export const BUSINESS_INFO_WATCHED_FIELDS = [
  "name",
  "description",
  "phone",
  "website",
  "primaryCategory",
] as const satisfies readonly WatchedField[]

/** The fields "Put ours back" sends through the hours publish. */
export const HOURS_WATCHED_FIELDS = [
  "regularHours",
  "specialHours",
] as const satisfies readonly WatchedField[]

export function isHoursField(
  field: WatchedField
): field is (typeof HOURS_WATCHED_FIELDS)[number] {
  return field === "regularHours" || field === "specialHours"
}

/**
 * Where a detected change stands. `open`: waiting for someone to decide.
 * `reverting`: "Put ours back" made a change that is waiting for approval or
 * publishing. `accepted`: someone kept Google's value as ours. `resolved`:
 * Google holds ours again, or the field stopped being watched.
 * `superseded`: Google changed the field again; a newer row replaced it.
 */
export const GOOGLE_CHANGE_STATUSES = [
  "open",
  "reverting",
  "accepted",
  "resolved",
  "superseded",
] as const
export type GoogleChangeStatus = (typeof GOOGLE_CHANGE_STATUSES)[number]

/** Why a change stopped being live, so history says which ending it had. */
export const GOOGLE_CHANGE_RESOLUTIONS = [
  "google_restored",
  "published",
  "unwatched",
] as const
export type GoogleChangeResolution = (typeof GOOGLE_CHANGE_RESOLUTIONS)[number]

/** What each status reads as on screen. */
export const GOOGLE_CHANGE_STATUS_LABELS: Record<GoogleChangeStatus, string> = {
  open: "Changed on Google",
  reverting: "Putting ours back",
  accepted: "Kept Google’s",
  resolved: "Back to ours",
  superseded: "Google changed it again",
}

export const GOOGLE_CHANGE_RESOLUTION_LABELS: Record<
  GoogleChangeResolution,
  string
> = {
  google_restored: "Google shows ours again",
  published: "Ours was put back on Google",
  unwatched: "No longer watched",
}

export type WatchedCategory = { name: string; displayName: string | null }

/** One field's value, in the shape each side is compared in. */
export type WatchedValue =
  | {
      field: "name" | "phone" | "website" | "description"
      value: string | null
    }
  | { field: "primaryCategory"; value: WatchedCategory | null }
  | { field: "regularHours"; value: NormalizedHours["regular"] }
  | { field: "specialHours"; value: NormalizedHours["special"] }

// ---------------------------------------------------------------------------
// Normalisation: the comparable form of each field
// ---------------------------------------------------------------------------

/** Trimmed, single-spaced; empty and absent are the same (an omitted default). */
export function normaliseText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.trim().replace(/\s+/g, " ")
  return cleaned || null
}

/**
 * Google returns a number as it was entered, and Google or a suggested edit
 * often rewrites a UK number into international form. Only what dials is
 * compared, in one form: +44 for a UK number however it was written
 * (01223 …, +44 1223 …, +44 (0)1223 …, 0044 1223 …). Other countries keep
 * their own + prefix.
 */
export function normalisePhone(value: unknown): string | null {
  const text = normaliseText(value)
  if (!text) return null
  const plus = text.startsWith("+")
  let digits = text.replace(/\D/g, "")
  if (!digits) return null
  if (!plus && digits.startsWith("00")) {
    digits = digits.slice(2)
  } else if (!plus && digits.startsWith("0")) {
    digits = `44${digits.slice(1)}`
  } else if (!plus) {
    return digits
  }
  if (digits.startsWith("440")) digits = `44${digits.slice(3)}`
  return `+${digits}`
}

/**
 * A website differs only when it leads somewhere else: a missing scheme,
 * http against https, a leading www. and the host's case are not changes,
 * and neither is a bare trailing slash. The path, query and fragment are.
 */
export function normaliseWebsite(value: unknown): string | null {
  const text = normaliseText(value)
  if (!text) return null
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text)
    ? text
    : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== "http:" && url.protocol !== "https:") return text
    const host = url.host.toLowerCase().replace(/^www\./, "")
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")
    return `${host}${path}${url.search}${url.hash}`
  } catch {
    return text
  }
}

/** A category is the same category when its resource name matches. */
export function normaliseCategory(
  value: WatchedCategory | null | undefined
): string | null {
  return normaliseText(value?.name)
}

const NEXT_DAY = (day: number) => (day + 1) % 7

type ComparablePeriod = {
  opensAt: string
  closesAt: string
  closeDayOfWeek: number
}

/**
 * A period in its one comparable form. Midnight is written two ways: 24:00 on
 * the opening day, or 00:00 on the next. Both become 00:00 on the next day.
 * A close at or before the opening time without a close day runs past
 * midnight; a close day equal to the open day is the default.
 */
function comparablePeriod(
  dayOfWeek: number,
  period: { opensAt: string; closesAt: string; closeDayOfWeek?: number }
): ComparablePeriod {
  if (period.closesAt === "24:00") {
    return {
      opensAt: period.opensAt,
      closesAt: "00:00",
      // 24:00 on the close day is 00:00 the day after it.
      closeDayOfWeek: NEXT_DAY(period.closeDayOfWeek ?? dayOfWeek),
    }
  }
  const overnight = period.closesAt <= period.opensAt
  const closeDayOfWeek =
    period.closeDayOfWeek === undefined ||
    (period.closeDayOfWeek === dayOfWeek && overnight)
      ? overnight
        ? NEXT_DAY(dayOfWeek)
        : dayOfWeek
      : period.closeDayOfWeek
  return { opensAt: period.opensAt, closesAt: period.closesAt, closeDayOfWeek }
}

function comparePeriods(left: ComparablePeriod, right: ComparablePeriod) {
  return (
    left.opensAt.localeCompare(right.opensAt) ||
    left.closesAt.localeCompare(right.closesAt) ||
    left.closeDayOfWeek - right.closeDayOfWeek
  )
}

export type ComparableDay = {
  dayOfWeek: number
  periods: ComparablePeriod[]
}

/**
 * Seven days, Sunday first. A day with no periods is closed whatever its
 * flag says, and a missing day is a closed day (Google omits closed days).
 */
export function normaliseRegularHours(
  regular: NormalizedHours["regular"] | null | undefined
): ComparableDay[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => {
    const day = (regular ?? []).find((entry) => entry.dayOfWeek === dayOfWeek)
    const periods = (day?.isClosed ? [] : (day?.periods ?? []))
      .map((period) => comparablePeriod(dayOfWeek, period))
      .sort(comparePeriods)
    return { dayOfWeek, periods }
  })
}

export type ComparableSpecial = {
  date: string
  /** The date the period closes (or, closed, the last closed date). */
  endDate: string
  closed: boolean
  opensAt: string | null
  closesAt: string | null
}

/** The next calendar date of a YYYY-MM-DD date. */
export function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

function compareSpecial(left: ComparableSpecial, right: ComparableSpecial) {
  return (
    left.date.localeCompare(right.date) ||
    Number(right.closed) - Number(left.closed) ||
    (left.opensAt ?? "").localeCompare(right.opensAt ?? "") ||
    (left.closesAt ?? "").localeCompare(right.closesAt ?? "") ||
    left.endDate.localeCompare(right.endDate)
  )
}

/**
 * Special hours in one order whatever order Google lists them in (two
 * periods on one date keep the provider's order in the editor's form). A
 * closed date has no times and an omitted end date is the start date. An
 * open period's end date is the date it closes: the start date, or the day
 * after when it runs past midnight. Midnight is 24:00 on the start date or
 * 00:00 on the next (with its end date), and both read as 00:00 the next day.
 */
export function normaliseSpecialHours(
  special: NormalizedHours["special"] | null | undefined
): ComparableSpecial[] {
  return (special ?? [])
    .map((entry): ComparableSpecial => {
      if (entry.isClosed || !entry.opensAt || !entry.closesAt) {
        return {
          date: entry.effectiveDate,
          endDate: entry.endDate ?? entry.effectiveDate,
          closed: true,
          opensAt: null,
          closesAt: null,
        }
      }
      const midnight = entry.closesAt === "24:00"
      const closesAt = midnight ? "00:00" : entry.closesAt
      const overnight = midnight || closesAt <= entry.opensAt
      return {
        date: entry.effectiveDate,
        endDate: overnight
          ? nextDate(entry.effectiveDate)
          : entry.effectiveDate,
        closed: false,
        opensAt: entry.opensAt,
        closesAt,
      }
    })
    .sort(compareSpecial)
}

/**
 * Special hours that have not ended by `today` (YYYY-MM-DD, the listing's
 * own date). Google drops dates once they pass; a past date is never a
 * change worth putting back.
 */
export function upcomingSpecialHours(
  special: NormalizedHours["special"],
  today: string
): NormalizedHours["special"] {
  return special.filter(
    (entry) =>
      (entry.endDate ?? entry.effectiveDate) >= today ||
      entry.effectiveDate >= today
  )
}

/** The comparable form of one field's value. */
export function comparableValue(input: WatchedValue): unknown {
  switch (input.field) {
    case "name":
    case "description":
      return normaliseText(input.value)
    case "phone":
      return normalisePhone(input.value)
    case "website":
      return normaliseWebsite(input.value)
    case "primaryCategory":
      return normaliseCategory(input.value)
    case "regularHours":
      return normaliseRegularHours(input.value)
    case "specialHours":
      return normaliseSpecialHours(input.value)
  }
}

/** Sorted-key JSON of the comparable form: equal strings, equal values. */
export function comparableSignature(input: WatchedValue): string {
  return canonicalJson(comparableValue(input))
}

export function sameWatchedValue(left: WatchedValue, right: WatchedValue) {
  return comparableSignature(left) === comparableSignature(right)
}

/**
 * Which days (0 = Sunday) or dates differ between ours and Google's, so the
 * diff can show only them and "Put ours back" can send only them. Empty for
 * the text fields.
 */
export function changedHoursKeys(ours: WatchedValue, google: WatchedValue) {
  if (ours.field === "regularHours" && google.field === "regularHours") {
    const left = normaliseRegularHours(ours.value)
    const right = normaliseRegularHours(google.value)
    return {
      regularDays: left
        .filter(
          (day, index) => canonicalJson(day) !== canonicalJson(right[index])
        )
        .map((day) => day.dayOfWeek),
      specialDates: [] as string[],
    }
  }
  if (ours.field === "specialHours" && google.field === "specialHours") {
    const byDate = (entries: ComparableSpecial[]) => {
      const map = new Map<string, string>()
      for (const entry of entries) {
        map.set(
          entry.date,
          `${map.get(entry.date) ?? ""}${canonicalJson(entry)}`
        )
      }
      return map
    }
    const left = byDate(normaliseSpecialHours(ours.value))
    const right = byDate(normaliseSpecialHours(google.value))
    return {
      regularDays: [] as number[],
      specialDates: [...new Set([...left.keys(), ...right.keys()])]
        .filter((date) => left.get(date) !== right.get(date))
        .sort(),
    }
  }
  return { regularDays: [] as number[], specialDates: [] as string[] }
}
