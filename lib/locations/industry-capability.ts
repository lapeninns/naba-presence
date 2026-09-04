import { asRecord } from "@/lib/locations/google-values"

export type IndustryCapability = {
  /** Google will answer the lodging APIs for this listing. */
  lodging: boolean
  /** Google will answer the healthcare APIs for this listing. */
  health: boolean
  /** Worth asking Google anything at all about industry data. */
  any: boolean
}

/**
 * Whether this listing can have industry data, according to Google.
 *
 * The industry group fans out seven Google calls, paced 500ms apart on one
 * connection (lib/server/google/transport.ts), so it costs about three and a
 * half seconds. For an ordinary business every one of those calls FAILS —
 * lodging answers "This operation is not supported for this location" and the
 * rest just fail — and the group then renders nothing. That wait was being
 * paid on every profile load by every location that could never use it.
 *
 * Google tells us in advance: it returns `canOperateLodgingData` and
 * `canOperateHealthData` on the location's `metadata` ONLY when they are true,
 * and `metadata` is already in the business-information read mask, so the
 * answer is on the wire before the industry group is mounted. This mirrors
 * `lib/server/food-menus.ts`, which already gates the food-menu fetch on
 * `metadata.canHaveFoodMenus`.
 *
 * Absent flags mean "do not ask" rather than "unknown": a listing that gains
 * lodging data later gains the flag with it, and the next load picks it up.
 */
export function industryCapability(location: unknown): IndustryCapability {
  const metadata = asRecord(asRecord(location).metadata)
  const lodging = metadata.canOperateLodgingData === true
  const health = metadata.canOperateHealthData === true
  return { lodging, health, any: lodging || health }
}
