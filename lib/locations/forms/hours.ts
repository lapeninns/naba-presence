import { z } from "zod"

import type { NormalizedHours } from "@/lib/api/location-hours"

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

// Verbatim mirror of hoursSchema in app/api/locations/[id]/hours/route.ts — keep in sync.
export const hoursFormSchema = z
  .object({
    regular: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          isClosed: z.boolean(),
          periods: z.array(z.object({ opensAt: timeSchema, closesAt: timeSchema })).max(3),
        })
      )
      .length(7),
    special: z
      .array(
        z.object({
          effectiveDate: z.iso.date(),
          isClosed: z.boolean(),
          opensAt: timeSchema.nullable(),
          closesAt: timeSchema.nullable(),
        })
      )
      .max(366),
    moreHours: z
      .array(
        z.object({
          hoursTypeId: z.string().min(1).max(100),
          periods: z
            .array(z.object({ dayOfWeek: z.number().int().min(0).max(6), opensAt: timeSchema, closesAt: timeSchema }))
            .max(21),
        })
      )
      .max(20),
  })
  .superRefine((hours, context) => {
    if (new Set(hours.regular.map((day) => day.dayOfWeek)).size !== 7) {
      context.addIssue({ code: "custom", message: "Regular hours must contain each day exactly once." })
    }
    for (const [index, day] of hours.regular.entries()) {
      if (day.isClosed !== (day.periods.length === 0)) {
        context.addIssue({
          code: "custom",
          path: ["regular", index],
          message: "Closed days cannot contain periods and open days require a period.",
        })
      }
    }
    for (const [index, period] of hours.special.entries()) {
      if (!period.isClosed && (!period.opensAt || !period.closesAt)) {
        context.addIssue({
          code: "custom",
          path: ["special", index],
          message: "Open special hours require opening and closing times.",
        })
      }
    }
  })

export type HoursFormValues = z.infer<typeof hoursFormSchema>

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const

export function emptyHours(): NormalizedHours {
  return {
    regular: DAY_LABELS.map((_, dayOfWeek) => ({ dayOfWeek, isClosed: true, periods: [] })),
    special: [],
    moreHours: [],
  }
}
