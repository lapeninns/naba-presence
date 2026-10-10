import { asRecord } from "@/lib/locations/google-values"

export type IndustryCapability = {
  /** Google will answer the lodging APIs for this listing. */
  lodging: boolean
  health: boolean
  /** Worth asking Google anything at all about industry data. */
  any: boolean
}

/**
 * Whether this listing can have industry data, according to Google.
 *
 * Google supplies `canOperateLodgingData` in the business-information read
 * mask before the specialist editor is mounted. This mirrors
 * `lib/server/food-menus.ts`, which already gates the food-menu fetch on
 * `metadata.canHaveFoodMenus`.
 *
 * Absent flags mean "do not ask" rather than "unknown": a listing that gains
 * lodging data later gains the flag with it, and the next load picks it up.
 */
export function industryCapability(location: unknown): IndustryCapability {
  const metadata = asRecord(asRecord(location).metadata)
  const lodging = metadata.canOperateLodgingData === true
  return { lodging, health: false, any: lodging }
}
