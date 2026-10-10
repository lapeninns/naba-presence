// Client-safe readback adapter for industry PATCHes (lodging, healthcare
// serviceList; lib/server/industry-management.ts). The resource is read
// again after the write and each updateMask path is compared with what the
// payload asked for. Fields outside the mask, and fields Google adds inside a
// masked group (the `*Exception` siblings, metadata), are ignored.
import { containsExpected, valueAtPath } from "./compare"

/** The masked paths the readback does not confirm. */
export function industryMismatches(
  updateMask: readonly string[],
  payload: Record<string, unknown>,
  readback: Record<string, unknown>
): string[] {
  return updateMask.filter(
    (path) =>
      !containsExpected(valueAtPath(readback, path), valueAtPath(payload, path))
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
