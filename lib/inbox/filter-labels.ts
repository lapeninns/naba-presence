// Shared human labels for inbox filter values. The Filters sheet, the
// active-filter chips and the toolbar must say the same thing for the same
// filter: a chip that reads "Location" above a sheet group called "Venue"
// makes an operator wonder whether they are two filters.

import {
  REVIEW_SORT_LABELS,
  type ReviewSort,
} from "@/lib/contracts/review-values"
import { formatDayMonth } from "@/lib/format"

/**
 * What each filter is called, wherever it is named: the sheet's group
 * heading and the first half of its chip ("Venue: Riverside").
 */
export const FILTER_NAMES = {
  rating: "Rating",
  written: "Written review",
  topic: "Topic",
  venue: "Venue",
  client: "Client",
  assignee: "Assigned to",
  owner: "Waiting on",
  replyState: "Reply status",
  age: "Age",
  dates: "Date range",
  sort: "Sort",
  search: "Search",
} as const

/** The one "clear everything" label, on the chip row and in the sheet. */
export const CLEAR_FILTERS_LABEL = "Clear all filters"

export const RATING_OPTIONS = [
  { value: 5, label: "5 stars" },
  { value: 4, label: "4 stars" },
  { value: 3, label: "3 stars" },
  { value: 2, label: "2 stars" },
  { value: 1, label: "1 star" },
] as const

export const ASSIGNEE_LABELS: Record<string, string> = {
  me: "Me",
  unassigned: "Unassigned",
}

export const WRITTEN_LABELS = {
  with_text: "With text",
  rating_only: "Rating only",
} as const

export const REPLY_STATE_LABELS = {
  unreplied: "Unreplied",
  replied: "Replied",
} as const

/**
 * The chosen ratings in words: "5 stars", "1 star", a run as a range
 * ("1–2 stars"), anything else as a list ("1, 3 stars").
 */
export function formatRatings(ratings: number[]): string {
  const sorted = [...new Set(ratings)].sort((a, b) => a - b)
  if (sorted.length === 1)
    return sorted[0] === 1 ? "1 star" : `${sorted[0]} stars`
  const contiguous = sorted.every(
    (rating, index) => index === 0 || rating === sorted[index - 1] + 1
  )
  return contiguous
    ? `${sorted[0]}–${sorted[sorted.length - 1]} stars`
    : `${sorted.join(", ")} stars`
}

/** Chip label for an active date filter, e.g. "Date range: 9 Jul – 15 Jul". */
export function formatDateRangeChip(
  dateFrom: string | undefined,
  dateTo: string | undefined
): string {
  const fmt = (iso: string) => {
    const day = iso.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
    const date = new Date(`${day}T00:00:00.000Z`)
    return formatDayMonth(date, "UTC")
  }
  if (dateFrom && dateTo)
    return `${FILTER_NAMES.dates}: ${fmt(dateFrom)} – ${fmt(dateTo)}`
  if (dateFrom) return `${FILTER_NAMES.dates}: from ${fmt(dateFrom)}`
  if (dateTo) return `${FILTER_NAMES.dates}: to ${fmt(dateTo)}`
  return FILTER_NAMES.dates
}

// The sort labels are the contract's (they are the sort vocabulary itself).
export const SORT_LABELS: Record<ReviewSort, string> = REVIEW_SORT_LABELS

export function formatSortChip(sort: string): string {
  return `${FILTER_NAMES.sort}: ${(SORT_LABELS as Record<string, string>)[sort] ?? sort}`
}

/** The accessible name of a chip's remove control. */
export function removeFilterLabel(chipLabel: string): string {
  return `Remove filter: ${chipLabel}`
}

/**
 * The Filters sheet's closing button, from the list's own count label
 * ("12 reviews", "50 reviews so far", "Loading reviews…"): it says what
 * closing the sheet will show. While the count is not known it says so
 * rather than promising a number.
 */
export function showResultsLabel(resultLabel: string): string {
  const match = /^([\d,]+) (reviews?)( so far)?$/.exec(resultLabel.trim())
  if (match) return `Show ${match[1]}${match[3] ? "+" : ""} ${match[2]}`
  if (/^loading/i.test(resultLabel)) return resultLabel
  return "Show results"
}

/**
 * What the open Filters sheet says aloud as the filters change: the settled
 * count ("12 reviews"), never the loading state in between, which would
 * otherwise be read after every tap.
 */
export function resultsAnnouncement(resultLabel: string): string {
  return /^loading/i.test(resultLabel.trim()) ? "" : resultLabel
}
