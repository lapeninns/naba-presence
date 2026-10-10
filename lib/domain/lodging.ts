// Client-safe (zod only): the Lodging fields NabaPresence may write.
//
// The Google Lodging resource (mybusinesslodging v1 `locations/{l}/lodging`)
// groups its amenities under top-level fields; the editor sends whole groups
// (lib/locations/forms/industry.ts touchedMask). Only these groups are
// writable here. `name` and `metadata` are Google's, and anything Google adds
// later is refused until it is reviewed and listed.
import { z } from "zod"

export const LODGING_UPDATE_FIELDS = [
  "property",
  "services",
  "policies",
  "foodAndDrink",
  "pools",
  "wellness",
  "activities",
  "transportation",
  "families",
  "connectivity",
  "business",
  "accessibility",
  "pets",
  "parking",
  "housekeeping",
  "healthAndSafety",
  "sustainability",
  "allUnits",
  "someUnits",
  "guestUnits",
  "commonLivingArea",
] as const
export type LodgingUpdateField = (typeof LODGING_UPDATE_FIELDS)[number]

const LODGING_FIELD_SET: ReadonlySet<string> = new Set(LODGING_UPDATE_FIELDS)

export function isLodgingUpdateField(
  value: string
): value is LodgingUpdateField {
  return LODGING_FIELD_SET.has(value)
}

/**
 * The top-level group a mask entry writes. Google accepts sub-paths
 * (`policies.checkinTime`), so a dotted entry is allowed when its group is.
 */
export function lodgingMaskGroup(path: string): string {
  return path.split(".")[0] ?? path
}

const pathSegment = /^[A-Za-z][A-Za-z0-9]*$/u

export const lodgingUpdateMaskSchema = z
  .array(
    z
      .string()
      .trim()
      .refine(
        (path) =>
          path.split(".").every((part) => pathSegment.test(part)) &&
          isLodgingUpdateField(lodgingMaskGroup(path)),
        { message: "This lodging field cannot be published from here." }
      )
  )
  .min(1)
  .max(100)

const lodgingGroup = z.record(z.string(), z.unknown()).optional()

/**
 * Only allowlisted groups; any other key is a validation error. Every group
 * is an object except guestUnits, which is a list.
 */
export const lodgingUpdatePayloadSchema = z
  .object({
    ...(Object.fromEntries(
      LODGING_UPDATE_FIELDS.map((field) => [field, lodgingGroup])
    ) as Record<LodgingUpdateField, typeof lodgingGroup>),
    guestUnits: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .strict()

/**
 * Mask and payload name the same groups: every masked group is in the
 * payload (a group Google should clear is sent as `{}`), and the payload
 * carries nothing the mask does not write.
 */
export function lodgingMaskCoversPayload(
  updateMask: readonly string[],
  payload: Record<string, unknown>
): boolean {
  const groups = new Set(updateMask.map(lodgingMaskGroup))
  return (
    [...groups].every((group) =>
      Object.prototype.hasOwnProperty.call(payload, group)
    ) && Object.keys(payload).every((key) => groups.has(key))
  )
}
