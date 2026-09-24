import { TIMEZONE_OPTIONS } from "@/lib/settings/forms/settings-policy"

export { TIMEZONE_OPTIONS }

/**
 * The zones agencies in this market actually work in, listed first in the
 * timezone picker. Only zones the runtime knows are kept, so the list never
 * offers a value the form's validation would then refuse.
 */
export const COMMON_TIMEZONES: readonly string[] = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
].filter((zone) => TIMEZONE_OPTIONS.includes(zone))

/** "America/Los_Angeles" → "America / Los Angeles". */
export function timezoneLabel(zone: string): string {
  return zone.replaceAll("_", " ").replaceAll("/", " / ")
}
