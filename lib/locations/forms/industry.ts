import { z } from "zod"

// Client-safe leaves for the fields the industry editor actually touches. The
// server payload is a freeform record (z.record) so these mirror only the leaves
// the UI writes — everything else on the Google resource is preserved (D8).
export const businessCallsLeafSchema = z.object({
  callsState: z.enum(["ENABLED", "DISABLED"]),
})
export const lodgingLeafSchema = z.object({
  policies: z
    .object({
      checkinTime: z.unknown().optional(),
      checkoutTime: z.unknown().optional(),
    })
    .partial()
    .optional(),
  pets: z
    .object({
      petsAllowed: z.boolean().optional(),
      petsAllowedFree: z.boolean().optional(),
    })
    .partial()
    .optional(),
  parking: z
    .object({
      freeParking: z.boolean().optional(),
      parkingAvailable: z.boolean().optional(),
      valetParkingAvailable: z.boolean().optional(),
    })
    .partial()
    .optional(),
  accessibility: z
    .object({
      mobilityAccessibleEntrance: z.boolean().optional(),
      mobilityAccessibleParking: z.boolean().optional(),
    })
    .partial()
    .optional(),
  connectivity: z
    .object({
      wifiAvailable: z.boolean().optional(),
      freeWifi: z.boolean().optional(),
      publicAreaWifiAvailable: z.boolean().optional(),
    })
    .partial()
    .optional(),
  foodAndDrink: z
    .object({
      breakfastAvailable: z.boolean().optional(),
      freeBreakfast: z.boolean().optional(),
      restaurant: z.boolean().optional(),
    })
    .partial()
    .optional(),
  housekeeping: z
    .object({
      housekeepingAvailable: z.boolean().optional(),
      dailyHousekeeping: z.boolean().optional(),
    })
    .partial()
    .optional(),
  wellness: z
    .object({
      fitnessCenter: z.boolean().optional(),
      freeFitnessCenter: z.boolean().optional(),
    })
    .partial()
    .optional(),
  pools: z
    .object({
      pool: z.boolean().optional(),
      indoorPool: z.boolean().optional(),
      outdoorPool: z.boolean().optional(),
    })
    .partial()
    .optional(),
})

/** Google TimeOfDay leaf → `HH:MM` for `<input type="time">`. */
export function timeOfDayToInput(value: unknown): string {
  if (typeof value === "string") {
    const match = value.match(/^(\d{1,2}):(\d{2})/)
    if (!match) return ""
    return `${match[1]!.padStart(2, "0")}:${match[2]}`
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return ""
  const record = value as Record<string, unknown>
  const hours = Number(record.hours ?? 0)
  const minutes = Number(record.minutes ?? 0)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return ""
  return `${String(Math.max(0, Math.min(23, Math.trunc(hours)))).padStart(2, "0")}:${String(Math.max(0, Math.min(59, Math.trunc(minutes)))).padStart(2, "0")}`
}

/** `HH:MM` → Google TimeOfDay object for lodging policies. */
export function inputToTimeOfDay(value: string): {
  hours: number
  minutes: number
  seconds: number
  nanos: number
} {
  const [hoursRaw, minutesRaw] = value.split(":")
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)
  return {
    hours: Number.isFinite(hours) ? Math.trunc(hours) : 0,
    minutes: Number.isFinite(minutes) ? Math.trunc(minutes) : 0,
    seconds: 0,
    nanos: 0,
  }
}

/** Paths Google reported as changed on getGoogleUpdated lodging. */
export function lodgingUpdatedPaths(data: Record<string, unknown>): string[] {
  const mask = data.diffMask
  if (typeof mask === "string" && mask.trim()) {
    return mask
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
  }
  if (mask && typeof mask === "object" && !Array.isArray(mask)) {
    const paths = (mask as { paths?: unknown }).paths
    if (Array.isArray(paths)) {
      return paths.filter((path): path is string => typeof path === "string")
    }
  }
  // Fall back to top-level amenity sections present on the suggested resource.
  const skip = new Set(["name", "metadata", "diffMask"])
  return Object.keys(data).filter((key) => !skip.has(key))
}

// Top-level keys whose value changed between the loaded resource and the draft.
export function touchedMask(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
  )
}

/** Server route mutation envelope (Slice 0). */
export const industryOperationSchema = z.enum([
  "update_lodging",
  "update_business_calls",
  "update_healthcare_services",
  "update_healthcare_provider_attributes",
])
export type IndustryOperation = z.infer<typeof industryOperationSchema>

export const industryMutationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("update_lodging"),
    confirmation: z.literal("publish_industry_data_to_google"),
    updateMask: z.array(z.string().trim().min(1)).min(1),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    operation: z.literal("update_business_calls"),
    confirmation: z.literal("publish_industry_data_to_google"),
    updateMask: z.array(z.literal("callsState")).min(1).max(1),
    payload: businessCallsLeafSchema,
  }),
  z.object({
    operation: z.literal("update_healthcare_services"),
    confirmation: z.literal("publish_industry_data_to_google"),
    updateMask: z.array(z.string().trim().min(1)).min(1),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    operation: z.literal("update_healthcare_provider_attributes"),
    confirmation: z.literal("publish_industry_data_to_google"),
    updateMask: z.array(z.string().trim().min(1)).min(1),
    payload: z.record(z.string(), z.unknown()),
  }),
])
export type IndustryMutation = z.infer<typeof industryMutationSchema>
