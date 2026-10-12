/**
 * Bulk batch follow-ups shown on the batch page (P09-R9). Client-safe and
 * pure.
 */
import {
  BULK_MAX_ITEMS,
  BULK_MAX_TARGETS,
  BULK_PREREQUISITES,
  type BulkOperation,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import { isBulkReviewOperation } from "@/lib/domain/bulk-reviews"

type Child = {
  locationId: string
  seq: number
  status: string
  resultCode: string | null
  operation: string
  /** Skipped at preview: such a child was never a hard prerequisite. */
  eligibility?: string
}

/** Children an original batch may still send: no new preview overlaps them. */
const IN_FLIGHT = new Set(["queued", "running"])

/**
 * Retry does not requeue these, nor a change whose hard prerequisite ended
 * in one of them (`retryBulkChange`, the `stuck` query in
 * lib/server/bulk-listings.ts).
 */
const NOT_RETRIED = new Set(["conflict", "expired", "cancelled", "skipped"])

/**
 * Families whose plan never reads back whether the change is already there:
 * a post draft is created again every time it is planned. Such a change goes
 * into a new preview only when every listing there needs it again; the
 * others are protected at plan time (`already_applied`, the baseline hash,
 * `photo_already_added`).
 */
const UNGUARDED_FAMILIES = new Set<string>(["post_draft"])

/** The child's hard prerequisites at its listing (`BULK_PREREQUISITES`). */
function prerequisitesOf(child: Child, children: readonly Child[]): Child[] {
  const families: readonly string[] =
    BULK_PREREQUISITES[child.operation as BulkOperation] ?? []
  if (!families.length) return []
  return children.filter(
    (other) =>
      other.locationId === child.locationId &&
      other.seq < child.seq &&
      other.eligibility !== "skipped" &&
      families.includes(other.operation)
  )
}

/** Retry leaves this child alone, directly or through its prerequisites. */
function stuck(child: Child, children: readonly Child[]): boolean {
  if (NOT_RETRIED.has(child.status)) return true
  return (
    child.status === "failed" &&
    child.resultCode === "dependency_not_applied" &&
    prerequisitesOf(child, children).some((p) => stuck(p, children))
  )
}

/**
 * Children that were never sent and cannot be retried in place: a preview
 * or approval that expired, a listing that changed on Google after the
 * preview (`conflict`), and a change whose prerequisite did not apply there
 * (`dependency_not_applied`) when that prerequisite conflicted, expired, was
 * cancelled or skipped. A dependent whose prerequisite merely failed is
 * requeued with it by Retry, so it needs no new preview. Each needs Google
 * read again in a new preview.
 */
export function needsNewPreview(
  child: Child,
  children: readonly Child[] = [child]
): boolean {
  return (
    child.status === "conflict" ||
    child.status === "expired" ||
    (child.status === "failed" &&
      child.resultCode === "dependency_not_applied" &&
      prerequisitesOf(child, children).some((p) => stuck(p, children)))
  )
}

export type NewPreview = {
  locationIds: string[]
  items: BulkOperationInput[]
  /**
   * Post drafts (by position in the batch) left out because the new preview
   * would also create them at listings that already have them; each lists
   * the listings that still need it.
   */
  omitted: { seq: number; locationIds: string[] }[]
}

/**
 * The request for a new preview of the children that need one. The preview
 * API pairs every listing with every change, so the request is built from
 * pairs: each child that needs a new preview, plus the hard prerequisites
 * of its listing's dependent changes (so a category change still comes
 * before the changes that depend on it), in the batch's order. A Google
 * field, photo, menu or link change at a listing that already shows it is
 * skipped there as already applied; a post draft has no such check, so it
 * is included only when every listing in the request needs it, and is
 * reported in `omitted` otherwise.
 *
 * Offered only once the batch has nothing queued or running, so a new
 * preview never overlaps a child the batch may still send. Null when no
 * child needs one, or for review batches, which are started from the inbox,
 * not previewed.
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
): NewPreview | null {
  const all = operation.children.filter(
    (child) => !isBulkReviewOperation(child.operation)
  )
  if (all.some((child) => IN_FLIGHT.has(child.status))) return null
  const wanted = new Map<string, Set<number>>()
  const want = (child: Child) => {
    const seqs = wanted.get(child.locationId) ?? new Set<number>()
    seqs.add(child.seq)
    wanted.set(child.locationId, seqs)
  }
  for (const child of all) {
    if (previewClosed) {
      want(child)
      continue
    }
    if (!needsNewPreview(child, all)) continue
    want(child)
    for (const prerequisite of prerequisitesOf(child, all))
      if (prerequisite.status !== "succeeded") want(prerequisite)
  }
  if (!wanted.size) return null
  const allSeqs = new Set([...wanted.values()].flatMap((seqs) => [...seqs]))
  const included = new Set(allSeqs)
  const listingsFor = () =>
    [...wanted]
      .filter(([, seqs]) => [...seqs].some((seq) => included.has(seq)))
      .map(([locationId]) => locationId)
  // Drop an unguarded change while a listing in the request does not need
  // it; dropping one can only shrink the listings, never add one.
  for (;;) {
    const listings = listingsFor()
    const unsafe = [...included].filter(
      (seq) =>
        UNGUARDED_FAMILIES.has(operation.items[seq]?.operation ?? "") &&
        listings.some((locationId) => !wanted.get(locationId)!.has(seq))
    )
    if (!unsafe.length) break
    for (const seq of unsafe) included.delete(seq)
  }
  const omitted = [...allSeqs]
    .filter((seq) => !included.has(seq))
    .sort((a, b) => a - b)
    .map((seq) => ({
      seq,
      locationIds: [...wanted]
        .filter(([, seqs]) => seqs.has(seq))
        .map(([locationId]) => locationId),
    }))
  const locationIds = listingsFor()
  const items = operation.items.filter((_, seq) => included.has(seq))
  // A batch was already inside both caps, so a subset is too.
  if (
    locationIds.length > BULK_MAX_TARGETS ||
    locationIds.length * items.length > BULK_MAX_ITEMS
  )
    return null
  return { locationIds, items, omitted }
}

/**
 * Whole seconds left before `deadline`, never negative; 0 means the window
 * has closed. `now` is the browser's clock; pass the server's clock offset
 * (`serverClockOffset`) so a wrong browser clock does not move the deadline.
 */
export function secondsLeft(deadline: string, now: number, offset = 0): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - (now + offset)) / 1000))
}

/**
 * Milliseconds to add to the browser's clock to get the server's: the
 * server's time when it answered, less the browser's time when the answer
 * arrived. 0 without a server time.
 */
export function serverClockOffset(
  serverTime: string | null | undefined,
  receivedAt: number
): number {
  const server = serverTime ? Date.parse(serverTime) : Number.NaN
  return Number.isFinite(server) && receivedAt > 0 ? server - receivedAt : 0
}

/** `m:ss` for a countdown ("14:59", "0:05"). */
export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}
