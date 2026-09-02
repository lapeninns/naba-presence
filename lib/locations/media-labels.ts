/**
 * Photos tab vocabulary helpers: which Google media categories an existing
 * item may be moved to, and how categories and dates read on screen.
 */
import type { GoogleMediaCategory } from "@/lib/domain/google-contract"

/** Categories Google allows when PATCHing an existing media item. */
export const PATCHABLE_MEDIA_CATEGORIES = [
  "LOGO",
  "EXTERIOR",
  "INTERIOR",
  "PRODUCT",
  "AT_WORK",
  "FOOD_AND_DRINK",
  "MENU",
  "COMMON_AREA",
  "ROOMS",
  "TEAMS",
  "ADDITIONAL",
] as const satisfies readonly GoogleMediaCategory[]

export type PatchableMediaCategory = (typeof PATCHABLE_MEDIA_CATEGORIES)[number]

export function isPatchableMediaCategory(
  category: string
): category is PatchableMediaCategory {
  return (PATCHABLE_MEDIA_CATEGORIES as readonly string[]).includes(category)
}

/** `FOOD_AND_DRINK` -> `Food and drink`. */
export function humaniseCategory(category: string): string {
  const lower = category.toLowerCase().replace(/_/g, " ")
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function formatMediaDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}
