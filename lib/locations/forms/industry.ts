export { lodgingSchema as lodgingLeafSchema } from "@/lib/contracts/google-lodging"

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

// The route mutation envelope lives in the wire contract; re-exported here so
// existing form-side imports keep resolving.
export {
  businessCallsLeafSchema,
  industryMutationSchema,
  industryOperationSchema,
  type IndustryMutation,
  type IndustryOperation,
} from "@/lib/contracts/location-industry"
