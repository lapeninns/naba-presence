/**
 * What the client hub's listings table says about one listing beyond its
 * Google link (DSK-10): the same Health word and Waiting figure the listings
 * board shows, derived from the same DB-only summary. Pure and client-safe;
 * the client route calls it on the server so the hub needs no second read.
 */
import type { ListingSummary } from "@/lib/contracts/location-summary"
import { googleChangedCount, unpublishedCount } from "@/lib/listings/health"

/**
 * How many things wait on a listing: edits saved here but not on Google,
 * changes Google made (and pending suggestions), and posts awaiting approval.
 * The same sum as the listings board's Waiting figure
 * (`components/listings/listings-board.tsx`).
 */
export function listingWaiting(summary: ListingSummary): number {
  return (
    unpublishedCount(summary) +
    googleChangedCount(summary) +
    summary.posts.awaitingApproval
  )
}
