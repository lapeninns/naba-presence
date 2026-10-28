import type {
  HoursState,
  NormalizedHours,
  PublishHoursInput,
} from "@/lib/api/location-hours"
import {
  hoursPartField,
  hoursSelectionFromKeys,
  hoursSelectionKeys,
  hoursSelectionMask,
} from "@/lib/domain/hours-vocabulary"
import { hoursFormSchema, DAY_LABELS } from "@/lib/locations/forms/hours"
import { formatShortDate } from "@/lib/format"
import {
  describeDay,
  clockTime,
  describeSpecialEntry,
  serviceWeek,
  type HoursChangeRow,
} from "@/lib/locations/hours-diff"

/**
 * Presentation helpers for the opening-hours editor: display order, the
 * field ids the validation summary links to, the checks the editor runs
 * before a save or a review, and sensible defaults for a new period.
 *
 * Nothing here changes what is saved: the wire contract
 * (`hoursInputSchema`) stays the authority, and these checks only catch, in
 * words, the mistakes it would reject or that Google would show wrongly.
 */

type Day = NormalizedHours["regular"][number]
type Period = Day["periods"][number]

/** The UK week: Monday first. Values are `dayOfWeek` (0 = Sunday). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export const hoursFieldId = {
  dayOpen: (dayOfWeek: number) => `hours-${dayOfWeek}-open`,
  opens: (dayOfWeek: number, index: number) =>
    `hours-${dayOfWeek}-${index}-opens`,
  closes: (dayOfWeek: number, index: number) =>
    `hours-${dayOfWeek}-${index}-closes`,
  specialDate: (index: number) => `special-${index}-date`,
  specialOpens: (index: number) => `special-${index}-opens`,
  specialCloses: (index: number) => `special-${index}-closes`,
  specialEnd: (index: number) => `special-${index}-end`,
  ends: (dayOfWeek: number, index: number) => `hours-${dayOfWeek}-${index}-end`,
}

export function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number)
  return hours * 60 + mins
}

function hhmm(total: number): string {
  const clamped = Math.max(0, Math.min(total, 23 * 60 + 59))
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`
}

/** A period that closes at or before it opens runs past midnight. */
function span(
  period: Period,
  dayOfWeek = period.closeDayOfWeek ?? 0
): { start: number; end: number } {
  const start = minutes(period.opensAt)
  const close = minutes(period.closesAt)
  return {
    start,
    end:
      close +
      (((period.closeDayOfWeek ?? dayOfWeek) - dayOfWeek + 7) % 7) * 24 * 60,
  }
}

/**
 * The periods after adding a split. A day with one long period is split in
 * two around its middle with an hour's break (the lunch/evening split this
 * control exists for); otherwise a two-hour period is added an hour after
 * the last one closes. Never an overlapping default.
 */
export function withSplitPeriod(
  periods: readonly Period[],
  dayOfWeek = periods[0]?.closeDayOfWeek ?? 0
): Period[] {
  if (periods.length === 0) return [{ opensAt: "09:00", closesAt: "17:00" }]
  const last = periods[periods.length - 1]
  if (!last.opensAt || !last.closesAt) return [...periods]
  const { start, end } = span(last, dayOfWeek)
  if (periods.length === 1 && end - start >= 4 * 60 && end <= 24 * 60) {
    const middle = Math.round((start + end) / 2 / 30) * 30
    return [
      {
        ...last,
        opensAt: last.opensAt,
        closesAt: hhmm(middle - 30),
        closeDayOfWeek: dayOfWeek,
      },
      { ...last, opensAt: hhmm(middle + 30), closesAt: last.closesAt },
    ]
  }
  const nextStart = end + 60
  if (nextStart + 60 <= 23 * 60 + 59) {
    return [
      ...periods,
      {
        closeDayOfWeek: dayOfWeek,
        opensAt: hhmm(nextStart),
        closesAt: hhmm(Math.min(nextStart + 120, 23 * 60 + 59)),
      },
    ]
  }
  // No room after the last period: split the longest one instead.
  const longest = periods.reduce(
    (best, period, index) => {
      const s = span(period, dayOfWeek)
      return s.end - s.start > best.length && s.end <= 24 * 60
        ? { index, length: s.end - s.start }
        : best
    },
    { index: -1, length: 0 }
  )
  if (longest.index === -1 || longest.length < 3 * 60) return [...periods]
  const target = periods[longest.index]
  const s = span(target, dayOfWeek)
  const middle = Math.round((s.start + s.end) / 2 / 30) * 30
  const next = [...periods]
  next.splice(
    longest.index,
    1,
    {
      ...target,
      opensAt: target.opensAt,
      closesAt: hhmm(middle - 30),
      closeDayOfWeek: dayOfWeek,
    },
    { ...target, opensAt: hhmm(middle + 30), closesAt: target.closesAt }
  )
  return next
}

/** Whether another period can be added without an overlapping default. */
export function canSplit(
  periods: readonly Period[],
  dayOfWeek?: number
): boolean {
  if (periods.length >= 3) return false
  return (
    JSON.stringify(withSplitPeriod(periods, dayOfWeek)) !==
    JSON.stringify(periods)
  )
}

export function sameDay(left: Day | undefined, right: Day | undefined) {
  if (!left || !right) return left === right
  return describeDay(left) === describeDay(right)
}

export function dayOf(hours: NormalizedHours, dayOfWeek: number): Day {
  return (
    hours.regular.find((day) => day.dayOfWeek === dayOfWeek) ?? {
      dayOfWeek,
      isClosed: true,
      periods: [],
    }
  )
}

export function formatSpecialDate(value: string): string {
  if (!value) return "No date"
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return formatShortDate(date, {
    weekday: "short",
    day: "numeric",
    year: "numeric",
  })
}

export { describeSpecialEntry }

export type HoursIssue = { fieldId: string; label: string; message: string }

/** The wording for a time the contract rejects (see `validateHours`). */
export const INVALID_TIME_MESSAGE =
  "Enter a 24-hour time such as 09:30 or 17:00. Use 24:00 for midnight at the end of the day."

/**
 * The closing-day choices for a period that opens on `dayOfWeek`: the same
 * day, the next day, then each following day, as `{ value, label }` with the
 * value a `dayOfWeek` string. Overnight hours need this said explicitly —
 * a closing time earlier than the opening time is never guessed.
 */
export function closingDayOptions(
  dayOfWeek: number
): { value: string; label: string }[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const end = (dayOfWeek + offset) % 7
    const label =
      offset === 0
        ? `Same day (${DAY_LABELS[end]})`
        : offset === 1
          ? `Next day (${DAY_LABELS[end]})`
          : `Following ${DAY_LABELS[end]}`
    return { value: String(end), label }
  })
}

/**
 * A special day as the summary names it: by its date, as its row and sheet
 * title do (rows are sorted by date, so a position would not match what the
 * operator sees), or "New special day" before it has one.
 */
function specialLabel(entry: NormalizedHours["special"][number] | undefined) {
  return entry?.effectiveDate
    ? `Special hours, ${formatSpecialDate(entry.effectiveDate)}`
    : "New special day"
}

/**
 * Every problem in the draft, in page order, each tied to a field. A
 * service schedule is named by Google's display name for it ("Kitchen")
 * when `supportedHoursTypes` has one, else by its type id.
 */
export function validateHours(
  hours: NormalizedHours,
  supportedHoursTypes: ReadonlyArray<{
    hoursTypeId: string
    displayName: string
  }> = []
): HoursIssue[] {
  const serviceName = (hoursTypeId: string | undefined) =>
    (hoursTypeId &&
      supportedHoursTypes.find((type) => type.hoursTypeId === hoursTypeId)
        ?.displayName) ||
    hoursTypeId ||
    "Service"
  const issues: HoursIssue[] = []
  const parsed = hoursFormSchema.safeParse(hours)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [area, rawIndex, field, rawPeriodIndex, periodField] = issue.path
      const index = typeof rawIndex === "number" ? rawIndex : 0
      const periodIndex =
        typeof rawPeriodIndex === "number" ? rawPeriodIndex : 0
      let fieldId = hoursFieldId.dayOpen(1)
      let label = "Hours"
      if (area === "regular") {
        const day = hours.regular[index]?.dayOfWeek ?? 1
        label = DAY_LABELS[day]
        fieldId =
          field === "periods"
            ? periodField === "closeDayOfWeek"
              ? hoursFieldId.ends(day, periodIndex)
              : periodField === "closesAt"
                ? hoursFieldId.closes(day, periodIndex)
                : hoursFieldId.opens(day, periodIndex)
            : hoursFieldId.dayOpen(day)
      } else if (area === "special") {
        label = specialLabel(hours.special[index])
        fieldId =
          field === "endDate"
            ? hoursFieldId.specialEnd(index)
            : field === "effectiveDate"
              ? hoursFieldId.specialDate(index)
              : field === "closesAt"
                ? hoursFieldId.specialCloses(index)
                : hoursFieldId.specialOpens(index)
      } else if (area === "moreHours") {
        const entry = hours.moreHours[index]
        const day = entry?.periods[periodIndex]?.dayOfWeek ?? 1
        const dayIndex =
          entry?.periods
            .slice(0, periodIndex)
            .filter((period) => period.dayOfWeek === day).length ?? 0
        label = `${serviceName(entry?.hoursTypeId)} · ${DAY_LABELS[day]}`
        const id =
          periodField === "closeDayOfWeek"
            ? hoursFieldId.ends(day, dayIndex)
            : periodField === "closesAt"
              ? hoursFieldId.closes(day, dayIndex)
              : hoursFieldId.opens(day, dayIndex)
        fieldId = `service-${encodeURIComponent(entry?.hoursTypeId ?? "")}-${id}`
      }
      // The time fields tidy loose input on blur ("9" → 09:00, "930" →
      // 09:30), so what still fails the format is a time that does not
      // exist ("25:00") or one too ambiguous to guess ("9:5"): say what a
      // good one looks like rather than naming a pattern.
      const leaf = area === "special" ? field : periodField
      issues.push({
        fieldId,
        label,
        message:
          issue.code === "invalid_format"
            ? leaf === "effectiveDate" || leaf === "endDate"
              ? "Enter a valid date."
              : INVALID_TIME_MESSAGE
            : issue.message,
      })
    }
  }
  for (const dayOfWeek of WEEK_ORDER) {
    const day = dayOf(hours, dayOfWeek)
    const label = DAY_LABELS[dayOfWeek]
    if (day.isClosed) continue
    if (day.periods.length === 0) {
      issues.push({
        fieldId: hoursFieldId.dayOpen(dayOfWeek),
        label,
        message: "Add opening times, or switch the day to Closed.",
      })
      continue
    }
    const spans: { start: number; end: number; text: string }[] = []
    day.periods.forEach((period, index) => {
      const fieldId = hoursFieldId.opens(dayOfWeek, index)
      if (!period.opensAt || !period.closesAt) {
        issues.push({
          fieldId,
          label,
          message: "Enter both an opening and a closing time.",
        })
        return
      }
      if (
        period.opensAt === period.closesAt &&
        period.closeDayOfWeek === undefined
      ) {
        issues.push({
          fieldId,
          label,
          message: "Opening and closing times are the same.",
        })
        return
      }
      if (
        period.closeDayOfWeek === undefined &&
        period.closesAt < period.opensAt
      ) {
        issues.push({
          fieldId: hoursFieldId.ends(dayOfWeek, index),
          label,
          message: "Choose the closing day for this overnight period.",
        })
        return
      }
      const current = span(period, dayOfWeek)
      if (current.end < current.start) {
        issues.push({
          fieldId: hoursFieldId.ends(dayOfWeek, index),
          label,
          message:
            "The closing time is earlier than opening. Choose the next closing day.",
        })
        return
      }
      const hit = spans.find(
        (other) => current.start < other.end && current.end > other.start
      )
      if (hit) {
        issues.push({
          fieldId,
          label,
          message: `Overlaps ${hit.text}. Split periods can’t overlap.`,
        })
        return
      }
      spans.push({
        ...current,
        text: `${clockTime(period.opensAt)} – ${clockTime(period.closesAt)}`,
      })
    })
  }

  const specialSpans: Array<{ start: number; end: number }> = []
  hours.special.forEach((entry, index) => {
    const label = specialLabel(entry)
    const fieldId = hoursFieldId.specialDate(index)
    if (!entry.effectiveDate) {
      issues.push({ fieldId, label, message: "Choose a date." })
      return
    }
    if (!entry.isClosed) {
      if (!entry.opensAt || !entry.closesAt) {
        issues.push({
          fieldId: hoursFieldId.specialOpens(index),
          label,
          message: "Enter both times, or mark the day Closed.",
        })
      } else if (
        entry.opensAt === entry.closesAt &&
        (!entry.endDate || entry.endDate === entry.effectiveDate)
      ) {
        issues.push({
          fieldId: hoursFieldId.specialOpens(index),
          label,
          message: "Opening and closing times are the same.",
        })
      }
    }
    const startDate = Date.parse(`${entry.effectiveDate}T00:00:00Z`)
    const endDate = Date.parse(
      `${entry.endDate ?? entry.effectiveDate}T00:00:00Z`
    )
    const dayOffset = (endDate - startDate) / 86_400_000
    const start =
      startDate / 60_000 + (entry.isClosed ? 0 : minutes(entry.opensAt ?? ""))
    const end = entry.isClosed
      ? start + 1440
      : endDate / 60_000 + minutes(entry.closesAt ?? "")
    if (
      !entry.isClosed &&
      (dayOffset < 0 ||
        dayOffset > 1 ||
        end < start ||
        end - start >= 1440 ||
        (dayOffset === 1 && minutes(entry.closesAt ?? "") >= 720))
    ) {
      issues.push({
        fieldId: hoursFieldId.specialEnd(index),
        label,
        message:
          "Special hours must finish after opening, within 24 hours, and before noon on the following day.",
      })
    }
    if (specialSpans.some((other) => start < other.end && end > other.start)) {
      issues.push({
        fieldId,
        label,
        message: "This special period overlaps another period or a closed day.",
      })
    }
    specialSpans.push({ start, end })
  })
  for (const entry of hours.moreHours) {
    const serviceIssues = validateHours({
      regular: serviceWeek(entry),
      special: [],
      moreHours: [],
    })
    issues.push(
      ...serviceIssues.map((issue) => ({
        ...issue,
        fieldId: `service-${encodeURIComponent(entry.hoursTypeId)}-${issue.fieldId}`,
        label: `${serviceName(entry.hoursTypeId)} · ${issue.label}`,
      }))
    )
  }
  return issues
}

// ---------------------------------------------------------------------------
// Selective publication
// ---------------------------------------------------------------------------

export type HoursPublishPart = {
  /** `hoursPartKey`: one weekday, one special start date, or one service. */
  key: string
  label: string
  /** Rows of the review this part covers. */
  rowCount: number
}

/** The publishable parts a review touches, in row order, for a checklist. */
export function hoursPublishParts(
  rows: ReadonlyArray<Pick<HoursChangeRow, "part">>,
  supportedHoursTypes?: ReadonlyArray<{
    hoursTypeId: string
    displayName: string
  }>
): HoursPublishPart[] {
  const parts = new Map<string, HoursPublishPart>()
  for (const row of rows) {
    const existing = parts.get(row.part)
    if (existing) {
      existing.rowCount += 1
      continue
    }
    const field = hoursPartField(row.part)
    const id = row.part.slice(row.part.indexOf(":") + 1)
    const label =
      field === "regularHours"
        ? DAY_LABELS[Number(id)]
        : field === "specialHours"
          ? `Special hours · ${formatSpecialDate(id)}`
          : `${supportedHoursTypes?.find((type) => type.hoursTypeId === id)?.displayName ?? id} schedule`
    parts.set(row.part, {
      key: row.part,
      label: label ?? row.part,
      rowCount: 1,
    })
  }
  return [...parts.values()]
}

/**
 * Marks the rows that would overwrite a Google change. With per-part drift
 * only the parts Google changed since their baseline are conflicts; without
 * it, the whole schedule's status decides for every row.
 */
export function markHoursConflicts<T extends Pick<HoursChangeRow, "part">>(
  rows: T[],
  hours: Pick<HoursState, "status" | "partStatus">
): Array<T & { state: "changed" | "conflict" }> {
  const overwrite = (status: string | undefined) =>
    status === "google_dirty" || status === "conflict"
  return rows.map((row) => ({
    ...row,
    state: (
      hours.partStatus
        ? overwrite(hours.partStatus[row.part])
        : overwrite(hours.status)
    )
      ? ("conflict" as const)
      : ("changed" as const),
  }))
}

/**
 * The publish fields for the chosen parts, each pinned to the Google part
 * hash this state was read with. Null when the state carries no part hashes
 * (then only the whole-schedule publish is possible) or nothing is chosen.
 */
export function hoursSelectionRequest(
  hours: Pick<HoursState, "googlePartHashes">,
  keys: Iterable<string>
): Pick<PublishHoursInput, "approvedUpdateMask" | "selection"> | null {
  const hashes = hours.googlePartHashes
  if (!hashes) return null
  const selection = hoursSelectionFromKeys(keys)
  const selected = hoursSelectionKeys(selection)
  if (selected.length === 0) return null
  return {
    approvedUpdateMask: hoursSelectionMask(selection),
    selection: {
      ...selection,
      expectedGoogleParts: Object.fromEntries(
        selected.map((key) => [key, hashes[key] ?? null])
      ),
    },
  }
}
