/**
 * Bulk listing changes (WP6): the operation inputs and the per-location merge
 * that turns one requested change into the exact value sent to one listing.
 * Client-safe and pure. Everything the change does not name is copied from
 * that listing's current Google value unchanged.
 */
import { z } from "zod"

import { httpUrl } from "@/lib/contracts/http-url"
import type {
  HoursSelection,
  NormalizedHours,
} from "@/lib/domain/hours-vocabulary"

/** Plan P09: one batch covers at most 50 explicitly selected listings. */
export const BULK_MAX_TARGETS = 50
/** A preview can be approved for 15 minutes after it was read from Google. */
export const BULK_PREVIEW_TTL_MS = 15 * 60_000
/** An approved batch may dispatch for 24 hours after approval, child by child. */
export const BULK_DISPATCH_TTL_MS = 24 * 60 * 60_000
/** At most this many bulk children run at once per organisation (enforced in SQL). */
export const BULK_MAX_RUNNING_PER_ORGANISATION = 2
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
        .min(1)
        .max(7),
    })
    .superRefine((value, context) => {
      if (
        new Set(value.days.map((entry) => entry.dayOfWeek)).size !==
        value.days.length
      )
        context.addIssue({
          code: "custom",
          path: ["days"],
          message: "Give each day at most once.",
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
  /**
   * Action links are matched by type, never by URI: an upsert updates the
   * listing's one editable link of that type (by its Google link name) or
   * creates one, and a delete removes it. A listing with several editable
   * links of the type is skipped rather than guessed at.
   */
  z
    .strictObject({
      operation: z.literal("place_action"),
      action: z.enum(["upsert", "delete"]),
      placeActionType: z.string().min(1).max(60),
      uri: httpUrl("Links must use http or https.").optional(),
      isPreferred: z.boolean().default(false),
    })
    .refine((value) => value.action === "delete" || value.uri !== undefined, {
      path: ["uri"],
      message: "Give the link to add or update.",
    }),
])
export type BulkOperationInput = z.infer<typeof bulkOperationInputSchema>
export type BulkOperation = BulkOperationInput["operation"]

/**
 * The provider resource one bulk child writes. Two running children never
 * share a (location, resource key), across batches, and the runner takes the
 * per-location advisory lock of the same name the single-listing editors take
 * (`<org>:<location>:attributes` in lib/server/business-information.ts), so
 * bulk and editor writes to one resource are serialised. The three hours
 * families share one key: they patch fields of the same location resource.
 * The hours editor (lib/server/hours.ts `publishCanonicalHours`) takes the
 * same `hours` key, and bulk hours are published through that path.
 */
export type BulkResourceKey = "hours" | "attributes" | "place_actions"
export function bulkResourceKey(operation: BulkOperation): BulkResourceKey {
  if (operation === "attributes") return "attributes"
  if (operation === "place_action") return "place_actions"
  return "hours"
}

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

type HoursInput = Extract<
  BulkOperationInput,
  { operation: "regular_hours" | "special_hours" | "more_hours" }
>

/** The Google hours field each hours family writes. */
export function bulkHoursField(
  operation: HoursInput["operation"]
): "regularHours" | "specialHours" | "moreHours" {
  if (operation === "regular_hours") return "regularHours"
  if (operation === "special_hours") return "specialHours"
  return "moreHours"
}

/**
 * The parts of the schedule an hours family changes, in the selective-hours
 * vocabulary (lib/domain/hours-vocabulary.ts): the chosen weekdays (all
 * seven is a whole-week replacement), the named special dates, or the one
 * service type. Everything else on the listing is re-read and written back
 * as Google holds it.
 */
export function bulkHoursSelection(input: HoursInput): HoursSelection {
  if (input.operation === "regular_hours")
    return {
      regularDays: input.days
        .map((entry) => entry.dayOfWeek)
        .sort((a, b) => a - b),
    }
  if (input.operation === "special_hours")
    return { specialDates: input.dates.map((entry) => entry.date).sort() }
  return { moreHoursTypes: [input.hoursTypeId] }
}

const nextDay = (dayOfWeek: number, opensAt: string, closesAt: string) =>
  closesAt <= opensAt ? (dayOfWeek + 1) % 7 : dayOfWeek

/**
 * `hours` with the selected parts set to the change: the chosen weekdays
 * replaced, the named dates upserted (or removed, for `clear`), the service
 * type replaced (or removed, when it has no periods). Every boundary is
 * explicit (a period's closing day, a date's end date), so the result never
 * needs the hours editor's legacy-boundary reconciliation. Other parts are
 * copied unchanged.
 */
export function applyBulkHours(
  input: HoursInput,
  hours: NormalizedHours
): NormalizedHours {
  const next = structuredClone(hours)
  if (input.operation === "regular_hours") {
    const days = new Map(input.days.map((entry) => [entry.dayOfWeek, entry]))
    next.regular = next.regular.map((day) => {
      const change = days.get(day.dayOfWeek)
      if (!change) return day
      return {
        dayOfWeek: day.dayOfWeek,
        isClosed: change.isClosed,
        periods: change.periods
          .map((period) => ({
            opensAt: period.opensAt,
            closesAt: period.closesAt,
            closeDayOfWeek: nextDay(
              day.dayOfWeek,
              period.opensAt,
              period.closesAt
            ),
          }))
          .sort((a, b) => a.opensAt.localeCompare(b.opensAt)),
      }
    })
    return next
  }
  if (input.operation === "special_hours") {
    const named = new Set(input.dates.map((entry) => entry.date))
    next.special = [
      ...next.special.filter((entry) => !named.has(entry.effectiveDate)),
      ...input.dates.flatMap((entry) =>
        entry.action === "clear"
          ? []
          : [
              entry.action === "closed"
                ? {
                    effectiveDate: entry.date,
                    endDate: entry.date,
                    isClosed: true,
                    opensAt: null,
                    closesAt: null,
                  }
                : {
                    effectiveDate: entry.date,
                    endDate: entry.date,
                    isClosed: false,
                    opensAt: entry.opensAt,
                    closesAt: entry.closesAt,
                  },
            ]
      ),
    ].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    return next
  }
  next.moreHours = [
    ...next.moreHours.filter(
      (entry) => entry.hoursTypeId !== input.hoursTypeId
    ),
    ...(input.periods.length
      ? [
          {
            hoursTypeId: input.hoursTypeId,
            periods: input.periods.map((period) => ({
              dayOfWeek: period.dayOfWeek,
              opensAt: period.opensAt,
              closesAt: period.closesAt,
              closeDayOfWeek: nextDay(
                period.dayOfWeek,
                period.opensAt,
                period.closesAt
              ),
            })),
          },
        ]
      : []),
  ].sort((a, b) => a.hoursTypeId.localeCompare(b.hoursTypeId))
  return next
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
    // An attribute given no values is cleared: Google clears a masked name
    // the request leaves out. `[false]` is an answer, never a clear.
    proposed: input.changes
      .filter((change) => change.values.length > 0)
      .map((change) => ({ name: change.name, values: change.values }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  } as const
}
