import type { z } from "zod"

import {
  hoursInputSchema,
  type NormalizedHours,
} from "@/lib/contracts/location-hours"

/**
 * The client-side validation the hours editor runs before saving. It IS the
 * wire contract's request schema (the route parses the same `hoursInputSchema`),
 * so the form can never accept a schedule the server would reject, and there is
 * no second copy to keep in sync.
 */
export const hoursFormSchema = hoursInputSchema

export type HoursFormValues = z.infer<typeof hoursFormSchema>

export const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const

export function emptyHours(): NormalizedHours {
  return {
    regular: DAY_LABELS.map((_, dayOfWeek) => ({
      dayOfWeek,
      isClosed: true,
      periods: [],
    })),
    special: [],
    moreHours: [],
  }
}
