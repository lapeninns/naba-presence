// Client-safe readback adapter for industry PATCHes (lodging, healthcare
// serviceList; lib/server/industry-management.ts). The resource is read
// again after the write and each updateMask path is compared with what the
// payload asked for. Fields outside the mask, and fields Google adds inside a
// masked group (the `*Exception` siblings, metadata), are ignored.
import {
  containsExpected,
  isEmptyValue,
  isRecord,
  isTimeOfDay,
  valueAtPath,
} from "./compare"

/** Keys Google keeps beside the values a group write sets. */
function isGoogleOwnedKey(key: string): boolean {
  return key === "metadata" || key === "name" || key.endsWith("Exception")
}

/**
 * `actual` holds exactly what `expected` sets: every leaf `expected` names
 * matches, and every leaf it leaves out reads back unset (or is one of
 * Google's own sibling keys). A masked lodging group is written whole, so a
 * leaf the editor cleared -- `policies.checkinTime` dropped from the JSON, or
 * a group sent as `{}` -- is confirmed only once Google cleared it too.
 */
function matchesWhole(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => matchesWhole(actual[index], item))
    )
  }
  if (!isRecord(expected) || isTimeOfDay(expected)) {
    return containsExpected(actual, expected)
  }
  if (!isRecord(actual)) return isEmptyValue(actual) && isEmptyValue(expected)
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
  return [...keys].every((key) =>
    expected[key] === undefined
      ? isGoogleOwnedKey(key) || isEmptyValue(actual[key])
      : matchesWhole(actual[key], expected[key])
  )
}

/**
 * The masked paths the readback does not confirm. With `wholeGroups` (the
 * lodging groups), a masked path is compared as the whole value it replaces
 * (matchesWhole); without it, only the leaves the payload names are checked.
 */
export function industryMismatches(
  updateMask: readonly string[],
  payload: Record<string, unknown>,
  readback: Record<string, unknown>,
  options: { wholeGroups?: boolean } = {}
): string[] {
  const matches = options.wholeGroups ? matchesWhole : containsExpected
  return updateMask.filter(
    (path) => !matches(valueAtPath(readback, path), valueAtPath(payload, path))
  )
}

/**
 * The masked paths of `current`, in a stable order: the input to the
 * field-scoped expected baseline (lib/server/industry-management.ts), so a
 * Google change to a group this write does not touch does not make it stale.
 */
export function maskedFieldBaseline(
  updateMask: readonly string[],
  current: Record<string, unknown>
): Array<[string, unknown]> {
  return [...new Set(updateMask)]
    .sort()
    .map((path) => [path, valueAtPath(current, path) ?? null])
}
