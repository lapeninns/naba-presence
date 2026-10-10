import { z } from "zod"

// Client-safe leaves for the fields the industry editor actually touches. The
// server payload is a freeform record (z.record) so these mirror only the leaves
// the UI writes — everything else on the Google resource is preserved (D8).
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

/** The lodging leaves the editor writes, in the words its switches use. */
const LODGING_LABELS: Record<string, string> = {
  "policies.checkinTime": "Check-in time",
  "policies.checkoutTime": "Check-out time",
  "pets.petsAllowed": "Pets allowed",
  "pets.petsAllowedFree": "Pets allowed free of charge",
  "parking.parkingAvailable": "Parking available",
  "parking.freeParking": "Free parking",
  "parking.valetParkingAvailable": "Valet parking",
  "accessibility.mobilityAccessibleEntrance": "Step-free / accessible entrance",
  "accessibility.mobilityAccessibleParking": "Accessible parking",
  "connectivity.wifiAvailable": "Wi‑Fi available",
  "connectivity.freeWifi": "Free Wi‑Fi",
  "connectivity.publicAreaWifiAvailable": "Public-area Wi‑Fi",
  "foodAndDrink.breakfastAvailable": "Breakfast available",
  "foodAndDrink.freeBreakfast": "Free breakfast",
  "foodAndDrink.restaurant": "On-site restaurant",
  "wellness.fitnessCenter": "Fitness centre",
  "pools.pool": "Pool",
  "housekeeping.housekeepingAvailable": "Housekeeping available",
  "housekeeping.dailyHousekeeping": "Daily housekeeping",
}

export type LodgingChange = {
  path: string
  field: string
  before: string
  after: string
}

function isTimeOfDay(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ("hours" in (value as object) || "minutes" in (value as object))
  )
}

function leaves(value: unknown, prefix: string, out: Map<string, unknown>) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !isTimeOfDay(value)
  ) {
    for (const [key, child] of Object.entries(value))
      leaves(child, prefix ? `${prefix}.${key}` : key, out)
    return
  }
  out.set(prefix, value)
}

function lodgingValue(value: unknown): string {
  if (value === undefined || value === null) return "Not set"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (isTimeOfDay(value)) return timeOfDayToInput(value) || "Not set"
  if (typeof value === "string" || typeof value === "number")
    return String(value)
  return JSON.stringify(value)
}

function humanisePath(path: string): string {
  return path
    .split(".")
    .map((part) =>
      part
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .toLowerCase()
    )
    .join(": ")
    .replace(/^./, (first) => first.toUpperCase())
}

/**
 * Leaf-level before and after for the touched lodging sections, for the
 * review sheet in front of a lodging publish. Known leaves use the editor's
 * own labels; anything else a Google suggestion changed is named from its
 * path rather than left out of the diff.
 */
export function lodgingChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): LodgingChange[] {
  const changes: LodgingChange[] = []
  for (const key of touchedMask(before, after)) {
    const was = new Map<string, unknown>()
    const now = new Map<string, unknown>()
    leaves(before[key], key, was)
    leaves(after[key], key, now)
    for (const path of new Set([...was.keys(), ...now.keys()])) {
      if (JSON.stringify(was.get(path)) === JSON.stringify(now.get(path)))
        continue
      changes.push({
        path,
        field: LODGING_LABELS[path] ?? humanisePath(path),
        before: lodgingValue(was.get(path)),
        after: lodgingValue(now.get(path)),
      })
    }
  }
  return changes
}

// The route mutation envelope lives in the wire contract; re-exported here so
// existing form-side imports keep resolving.
export {
  industryMutationSchema,
  industryOperationSchema,
  type IndustryMutation,
  type IndustryOperation,
} from "@/lib/contracts/location-industry"
