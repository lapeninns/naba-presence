/**
 * Bulk listing changes (WP6): the operation inputs and the per-location merge
 * that turns one requested change into the exact value sent to one listing.
 * Client-safe and pure. Everything the change does not name is copied from
 * that listing's current Google value unchanged.
 */
import { z } from "zod"

export const BULK_MAX_TARGETS = 100
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time such as 09:30.")
const day = z.number().int().min(0).max(6)
const period = z
  .strictObject({ opensAt: time, closesAt: time })
  .refine(
    (value) => value.opensAt !== value.closesAt,
    "Opening and closing times must differ."
  )
const isoDate = z.iso.date()

export const bulkOperationInputSchema = z.discriminatedUnion("operation", [
  z
    .strictObject({
      operation: z.literal("regular_hours"),
      days: z
        .array(
          z.strictObject({
            dayOfWeek: day,
            isClosed: z.boolean(),
            periods: z.array(period).max(3),
          })
        )
        .length(7),
    })
    .superRefine((value, context) => {
      if (new Set(value.days.map((entry) => entry.dayOfWeek)).size !== 7)
        context.addIssue({
          code: "custom",
          path: ["days"],
          message: "Give each day exactly once.",
        })
      value.days.forEach((entry, index) => {
        if (entry.isClosed !== (entry.periods.length === 0))
          context.addIssue({
            code: "custom",
            path: ["days", index],
            message: "A closed day has no periods; an open day needs one.",
          })
      })
    }),
  z
    .strictObject({
      operation: z.literal("special_hours"),
      dates: z
        .array(
          z.discriminatedUnion("action", [
            z.strictObject({ action: z.literal("closed"), date: isoDate }),
            z.strictObject({
              action: z.literal("open"),
              date: isoDate,
              opensAt: time,
              closesAt: time,
            }),
            z.strictObject({ action: z.literal("clear"), date: isoDate }),
          ])
        )
        .min(1)
        .max(31),
    })
    .refine(
      (value) =>
        new Set(value.dates.map((entry) => entry.date)).size ===
        value.dates.length,
      "Give each date once."
    ),
  z.strictObject({
    operation: z.literal("more_hours"),
    hoursTypeId: z.string().min(1).max(100),
    periods: z
      .array(z.strictObject({ dayOfWeek: day, opensAt: time, closesAt: time }))
      .max(21),
  }),
  z
    .strictObject({
      operation: z.literal("attributes"),
      changes: z
        .array(
          z.strictObject({
            name: z.string().regex(/^attributes\/[A-Za-z0-9_.:-]+$/),
            values: z
              .array(z.union([z.boolean(), z.string().max(200)]))
              .max(20),
          })
        )
        .min(1)
        .max(20),
    })
    .refine(
      (value) =>
        new Set(value.changes.map((change) => change.name)).size ===
        value.changes.length,
      "Change each attribute once."
    ),
  z.strictObject({
    operation: z.literal("place_action"),
    action: z.enum(["upsert", "delete"]),
    placeActionType: z.string().min(1).max(60),
    uri: z
      .url()
      .refine(
        (value) => /^https?:/.test(value),
        "Links must use http or https."
      ),
    isPreferred: z.boolean().default(false),
  }),
])
export type BulkOperationInput = z.infer<typeof bulkOperationInputSchema>
export type BulkOperation = BulkOperationInput["operation"]

const DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const
const toTime = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number)
  return { hours, minutes }
}
const toDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number)
  return { year, month, day }
}
type GoogleDate = { year?: number; month?: number; day?: number }
const dateKey = (value: GoogleDate | undefined) =>
  value?.year && value.month && value.day
    ? `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`
    : null

/** A period that closes at or before it opens runs past midnight and closes on the next day. */
export function googlePeriod(
  dayOfWeek: number,
  opensAt: string,
  closesAt: string
) {
  const overnight = closesAt <= opensAt
  return {
    openDay: DAYS[dayOfWeek],
    openTime: toTime(opensAt),
    closeDay: DAYS[overnight ? (dayOfWeek + 1) % 7 : dayOfWeek],
    closeTime: toTime(closesAt),
  }
}

type Location = {
  regularHours?: { periods?: unknown[] }
  specialHours?: {
    specialHourPeriods?: Array<
      Record<string, unknown> & { startDate?: GoogleDate }
    >
  }
  moreHours?: Array<Record<string, unknown> & { hoursTypeId?: string }>
  categories?: {
    primaryCategory?: { moreHoursTypes?: Array<{ hoursTypeId?: string }> }
    additionalCategories?: Array<{
      moreHoursTypes?: Array<{ hoursTypeId?: string }>
    }>
  }
}
export type HoursMerge =
  | {
      updateMask: "regularHours" | "specialHours" | "moreHours"
      current: unknown
      proposed: unknown
    }
  | { skip: string }

/** The one hours field a bulk operation changes, merged into this listing's current value. */
export function mergeHours(
  input: Extract<
    BulkOperationInput,
    { operation: "regular_hours" | "special_hours" | "more_hours" }
  >,
  location: Location
): HoursMerge {
  if (input.operation === "regular_hours") {
    return {
      updateMask: "regularHours",
      current: location.regularHours ?? {},
      proposed: {
        periods: input.days.flatMap((entry) =>
          entry.periods.map((p) =>
            googlePeriod(entry.dayOfWeek, p.opensAt, p.closesAt)
          )
        ),
      },
    }
  }
  if (input.operation === "special_hours") {
    const named = new Set(input.dates.map((entry) => entry.date))
    const kept = (location.specialHours?.specialHourPeriods ?? []).filter(
      (period) => !named.has(dateKey(period.startDate) ?? "")
    )
    const added = input.dates.flatMap((entry) =>
      entry.action === "clear"
        ? []
        : entry.action === "closed"
          ? [
              {
                startDate: toDate(entry.date),
                endDate: toDate(entry.date),
                closed: true,
              },
            ]
          : [
              {
                startDate: toDate(entry.date),
                endDate: toDate(entry.date),
                openTime: toTime(entry.opensAt),
                closeTime: toTime(entry.closesAt),
                closed: false,
              },
            ]
    )
    const all = [...kept, ...added].sort((a, b) =>
      (dateKey(a.startDate as GoogleDate) ?? "").localeCompare(
        dateKey(b.startDate as GoogleDate) ?? ""
      )
    )
    return {
      updateMask: "specialHours",
      current: location.specialHours ?? {},
      proposed: { specialHourPeriods: all },
    }
  }
  const supported = [
    location.categories?.primaryCategory,
    ...(location.categories?.additionalCategories ?? []),
  ]
    .flatMap((category) => category?.moreHoursTypes ?? [])
    .some((type) => type.hoursTypeId === input.hoursTypeId)
  const present = (location.moreHours ?? []).some(
    (entry) => entry.hoursTypeId === input.hoursTypeId
  )
  if (!supported && !present) return { skip: "hours_type_not_supported" }
  const others = (location.moreHours ?? []).filter(
    (entry) => entry.hoursTypeId !== input.hoursTypeId
  )
  const replacement = input.periods.length
    ? [
        {
          hoursTypeId: input.hoursTypeId,
          periods: input.periods.map((p) =>
            googlePeriod(p.dayOfWeek, p.opensAt, p.closesAt)
          ),
        },
      ]
    : []
  return {
    updateMask: "moreHours",
    current: location.moreHours ?? [],
    proposed: [...others, ...replacement],
  }
}

export type AttributeValue = {
  name: string
  values?: unknown[]
  valueType?: string
  uriValues?: unknown[]
}
/** Only the named attributes; each must be offered by the listing's attribute metadata. */
export function mergeAttributes(
  input: Extract<BulkOperationInput, { operation: "attributes" }>,
  current: readonly AttributeValue[],
  offered: ReadonlySet<string>
) {
  const missing = input.changes.filter((change) => !offered.has(change.name))
  if (missing.length)
    return {
      skip: "attribute_not_offered",
      names: missing.map((change) => change.name),
    } as const
  const names = new Set(input.changes.map((change) => change.name))
  return {
    attributeMask: [...names].sort(),
    current: current
      .filter((attribute) => names.has(attribute.name))
      .sort((a, b) => a.name.localeCompare(b.name)),
    proposed: input.changes
      .map((change) => ({ name: change.name, values: change.values }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  } as const
}
