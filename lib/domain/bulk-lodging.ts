/**
 * Bulk lodging (the industry family, P09-R5): a typed field-mask patch of a
 * listing's lodging resource. Client-safe and pure.
 *
 * Paths come from the typed lodging allowlist (`GOOGLE_LODGING_UPDATE_PATHS`,
 * built from Google's discovery schema, which leaves out read-only and
 * identity fields), values from the typed lodging schema. Two paths are
 * never offered in bulk: `metadata` (the server stamps
 * `metadata.updateTime` when it sends) and `guestUnits` (each property's
 * own room types). Healthcare stays out of bulk pending decision D-24.
 */
import { z } from "zod"

import { lodgingSchema } from "@/lib/contracts/google-lodging"
import { GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"
import {
  containsExpected,
  isEmptyValue,
  isRecord,
  isTimeOfDay,
  valueAtPath,
} from "@/lib/domain/readback/compare"

const NOT_IN_BULK = ["metadata", "guestUnits"] as const

/** A lodging path a batch may change. */
export function bulkLodgingPathAllowed(path: string): boolean {
  return (
    GOOGLE_LODGING_UPDATE_PATHS.has(path) &&
    !NOT_IN_BULK.some((root) => path === root || path.startsWith(`${root}.`))
  )
}

const lodgingPath = z
  .string()
  .refine(bulkLodgingPathAllowed, "Select a supported writable lodging field.")

/** Every leaf path a value sets (`pools.pool`, `policies.checkinTime`). */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (!isRecord(value) || (prefix && Object.keys(value).length === 0))
    return prefix ? [prefix] : []
  // A TimeOfDay or similar small record under a named path is a value.
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return isRecord(child) && GOOGLE_LODGING_UPDATE_PATHS.has(path)
      ? leafPaths(child, path)
      : [path]
  })
}

const covers = (mask: string, path: string) =>
  path === mask || path.startsWith(`${mask}.`)

/**
 * The paths to set (their values in `payload`) and the paths to clear
 * (`clear`, also in the mask, absent from the payload). The payload may not
 * carry anything outside the mask, so what is reviewed is what is sent.
 */
export const bulkLodgingInputSchema = z
  .strictObject({
    operation: z.literal("lodging"),
    updateMask: z.array(lodgingPath).min(1).max(50),
    clear: z.array(lodgingPath).max(50).default([]),
    payload: lodgingSchema,
  })
  .superRefine((value, context) => {
    const mask = value.updateMask
    if (new Set(mask).size !== mask.length)
      context.addIssue({
        code: "custom",
        path: ["updateMask"],
        message: "Name each lodging field once.",
      })
    mask.forEach((path, index) => {
      if (mask.some((other) => other !== path && covers(other, path)))
        context.addIssue({
          code: "custom",
          path: ["updateMask", index],
          message: "A lodging field is named both on its own and in its group.",
        })
      const cleared = value.clear.includes(path)
      const present = valueAtPath(value.payload, path) !== undefined
      if (cleared && present)
        context.addIssue({
          code: "custom",
          path: ["clear"],
          message: "A cleared lodging field cannot also have a value.",
        })
      if (!cleared && !present)
        context.addIssue({
          code: "custom",
          path: ["payload"],
          message: `Give a value for ${path}, or clear it.`,
        })
    })
    if (value.clear.some((path) => !mask.includes(path)))
      context.addIssue({
        code: "custom",
        path: ["clear"],
        message: "Only fields in the update mask can be cleared.",
      })
    if (
      leafPaths(value.payload).some(
        (leaf) => !mask.some((path) => covers(path, leaf))
      )
    )
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "The lodging values include a field outside the update mask.",
      })
  })
export type BulkLodgingInput = z.infer<typeof bulkLodgingInputSchema>

/** Each changed path as the listing holds it (null when unset). */
export function lodgingCurrent(
  input: Pick<BulkLodgingInput, "updateMask">,
  lodging: unknown
): Record<string, unknown> {
  return Object.fromEntries(
    [...input.updateMask]
      .sort()
      .map((path) => [path, valueAtPath(lodging, path) ?? null])
  )
}

/** Each changed path after the change (null is cleared). */
export function lodgingProposed(
  input: Pick<BulkLodgingInput, "updateMask" | "payload">
): Record<string, unknown> {
  return Object.fromEntries(
    [...input.updateMask]
      .sort()
      .map((path) => [path, valueAtPath(input.payload, path) ?? null])
  )
}

/**
 * Whether the value at a masked path matches what the change sends. A group
 * path (`pools`) is replaced whole by Google, so its writable fields the
 * change leaves out must read back empty: a listing that still holds
 * `pools.hotTub` does not show a `pools: { pool: true }` write. Leaf values
 * (and a TimeOfDay, which is one value) compare the way Google echoes them.
 * Fields Google does not let a client write are ignored.
 */
function lodgingValueMatches(
  actual: unknown,
  expected: unknown,
  path: string
): boolean {
  if (!isRecord(expected) || isTimeOfDay(expected))
    return containsExpected(actual, expected)
  if (!isRecord(actual)) return isEmptyValue(expected) && isEmptyValue(actual)
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
  return [...keys].every((key) => {
    const child = `${path}.${key}`
    if (key in expected)
      return lodgingValueMatches(actual[key], expected[key], child)
    return !GOOGLE_LODGING_UPDATE_PATHS.has(child) || isEmptyValue(actual[key])
  })
}

/**
 * Whether a listing's lodging shows the change: a cleared path holds
 * nothing, a set path holds the value (`false` is a value, never unset;
 * text and times are compared the way Google echoes them), and a set group
 * holds exactly the fields the change gives it.
 */
export function lodgingApplied(
  lodging: unknown,
  input: Pick<BulkLodgingInput, "updateMask" | "clear" | "payload">
): boolean {
  return input.updateMask.every((path) =>
    input.clear.includes(path)
      ? isEmptyValue(valueAtPath(lodging, path))
      : lodgingValueMatches(
          valueAtPath(lodging, path),
          valueAtPath(input.payload, path),
          path
        )
  )
}

/** The top-level lodging groups a change touches (its parts within a batch). */
export const lodgingGroups = (input: Pick<BulkLodgingInput, "updateMask">) => [
  ...new Set(input.updateMask.map((path) => path.split(".")[0])),
]

/** The `metadata.updateTime` stamp Google requires on every lodging update. */
export function lodgingSendBody(
  input: Pick<BulkLodgingInput, "updateMask" | "payload">,
  sentAt: Date
) {
  return {
    updateMask: [...input.updateMask, "metadata.updateTime"].sort(),
    payload: {
      ...input.payload,
      metadata: { updateTime: sentAt.toISOString() },
    },
  }
}
