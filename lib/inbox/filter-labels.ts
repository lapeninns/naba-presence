// Shared human labels for inbox filter values. The More filters sheet and the
// active-filter chips must agree; chips used to leak wire enums while the
// sheet already showed friendly names.

import {
  REVIEW_SORT_LABELS,
  type ReviewSort,
} from "@/lib/contracts/reviews"

export const RATING_OPTIONS = [
  { value: 5, label: "5 stars" },
  { value: 4, label: "4 stars" },
  { value: 3, label: "3 stars" },
  { value: 2, label: "2 stars" },
  { value: 1, label: "1 star" },
] as const

/** e.g. "5 stars", "1 star", "1, 2 stars". */
export function formatRatingsChip(ratings: number[]): string {
  const sorted = [...ratings].sort((a, b) => a - b)
  if (sorted.length === 1) {
    const rating = sorted[0]
    return `Rating: ${rating === 1 ? "1 star" : `${rating} stars`}`
  }
  return `Rating: ${sorted.join(", ")} stars`
}

/** Chip label for an active date filter, e.g. "9 Jul – 15 Jul". */
export function formatDateRangeChip(
  dateFrom: string | undefined,
  dateTo: string | undefined
): string {
  const fmt = (iso: string) => {
    const day = iso.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
    const date = new Date(`${day}T00:00:00.000Z`)
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(date)
  }
  if (dateFrom && dateTo) return `Date: ${fmt(dateFrom)} – ${fmt(dateTo)}`
  if (dateFrom) return `From: ${fmt(dateFrom)}`
  if (dateTo) return `To: ${fmt(dateTo)}`
  return "Date range"
}

// The sort labels are the contract's (they are the sort vocabulary itself).
export const SORT_LABELS: Record<ReviewSort, string> = REVIEW_SORT_LABELS

export function formatSortChip(sort: string): string {
  return `Sort: ${(SORT_LABELS as Record<string, string>)[sort] ?? sort}`
}
