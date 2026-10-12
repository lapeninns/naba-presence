/**
 * Bulk batch follow-ups shown on the batch page (P09-R9). Client-safe and
 * pure.
 */
import {
  BULK_MAX_ITEMS,
  BULK_MAX_TARGETS,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import { isBulkReviewOperation } from "@/lib/domain/bulk-reviews"

type Child = {
  locationId: string
  seq: number
  status: string
  resultCode: string | null
  operation: string
}

/**
 * Children that were never sent and cannot be retried in place: a preview
 * or approval that expired, a listing that changed on Google after the
 * preview (`conflict`), and a change whose prerequisite did not apply there
 * (`dependency_not_applied`, which retry leaves alone once the prerequisite
 * conflicted or expired). Each needs Google read again in a new preview.
 */
export function needsNewPreview(child: Child): boolean {
  return (
    child.status === "conflict" ||
    child.status === "expired" ||
    (child.status === "failed" && child.resultCode === "dependency_not_applied")
  )
}

/**
 * The request for a new preview of the children that need one: their
 * listings, and the batch's changes those children carry, in the batch's
 * order (so a category change still comes before the changes that depend on
 * it). The new preview reads Google again for every pair; a listing that
 * already shows a change is skipped there as already applied, so nothing
 * that landed is sent twice. Null when no child needs one, or for review
 * batches, which are started from the inbox, not previewed.
 *
 * `previewClosed`: the 15-minute approval window has passed while the batch
 * still shows `previewed` (the sweep has not recorded it yet), so every
 * child needs a new preview.
 */
export function newPreviewRequest(
  operation: {
    items: readonly BulkOperationInput[]
    children: readonly Child[]
  },
  { previewClosed = false }: { previewClosed?: boolean } = {}
): { locationIds: string[]; items: BulkOperationInput[] } | null {
  const children = operation.children.filter(
    (child) =>
      !isBulkReviewOperation(child.operation) &&
      (previewClosed || needsNewPreview(child))
  )
  if (!children.length) return null
  const locationIds = [...new Set(children.map((child) => child.locationId))]
  const seqs = new Set(children.map((child) => child.seq))
  const items = operation.items.filter((_, seq) => seqs.has(seq))
  // A batch was already inside both caps, so a subset is too.
  if (
    !items.length ||
    locationIds.length > BULK_MAX_TARGETS ||
    locationIds.length * items.length > BULK_MAX_ITEMS
  )
    return null
  return { locationIds, items }
}

/**
 * Whole seconds left before `deadline`, never negative; 0 means the window
 * has closed.
 */
export function secondsLeft(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000))
}

/** `m:ss` for a countdown ("14:59", "0:05"). */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}
