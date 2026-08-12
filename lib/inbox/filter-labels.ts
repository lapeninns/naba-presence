// Shared human labels for inbox filter values. The More filters sheet and the
// active-filter chips must agree; chips used to leak wire enums
// (`not_published`, `pass`) while the sheet already showed friendly names.

export const VERIFICATION_OPTIONS = [
  { value: "pass", label: "Passed" },
  { value: "warn", label: "Review needed" },
  { value: "fail", label: "Failed" },
  { value: "pending", label: "Pending" },
] as const

// Publish/sync status share a few labels with verification and with each
// other ("Failed", "Pending"). `ariaLabel` disambiguates every non-verification
// entry that would otherwise collide for screen readers / getByRole.
export const PUBLISH_STATUS_OPTIONS = [
  { value: "not_published", label: "Not published" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "accepted", label: "Sent to Google" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed", ariaLabel: "Publish status: Failed" },
  { value: "deleted", label: "Deleted" },
] as const

export const SYNC_STATUS_OPTIONS = [
  { value: "pending", label: "Pending", ariaLabel: "Sync status: Pending" },
  { value: "running", label: "Running" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed", ariaLabel: "Sync status: Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const

export const RATING_OPTIONS = [
  { value: 5, label: "5 stars" },
  { value: 4, label: "4 stars" },
  { value: 3, label: "3 stars" },
  { value: 2, label: "2 stars" },
  { value: 1, label: "1 star" },
] as const

function labelMap(
  options: readonly { value: string; label: string }[]
): Map<string, string> {
  return new Map(options.map((option) => [option.value, option.label]))
}

const VERIFICATION_LABELS = labelMap(VERIFICATION_OPTIONS)
const PUBLISH_STATUS_LABELS = labelMap(PUBLISH_STATUS_OPTIONS)
const SYNC_STATUS_LABELS = labelMap(SYNC_STATUS_OPTIONS)

function joinLabels(values: string[], labels: Map<string, string>): string {
  return values.map((value) => labels.get(value) ?? value).join(", ")
}

export function formatVerificationChip(values: string[]): string {
  return `Verification: ${joinLabels(values, VERIFICATION_LABELS)}`
}

export function formatPublishStatusChip(values: string[]): string {
  return `Publish: ${joinLabels(values, PUBLISH_STATUS_LABELS)}`
}

export function formatSyncStatusChip(values: string[]): string {
  return `Sync: ${joinLabels(values, SYNC_STATUS_LABELS)}`
}

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

export const SORT_LABELS: Record<string, string> = {
  updated_desc: "Most recent",
  rating_desc: "Highest rated",
  rating_asc: "Lowest rated",
}

export function formatSortChip(sort: string): string {
  return `Sort: ${SORT_LABELS[sort] ?? sort}`
}
