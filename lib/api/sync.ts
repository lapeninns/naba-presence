import { apiFetch } from "./client"

/**
 * The part of a manual sync's envelope the refresh reads back: one entry per
 * listing that was due and checked (`outcomes`, an empty list when none was
 * due), and `truncated` when the time budget stopped the walk with listings
 * still due (the job runner picks those up). Optional throughout: an answer
 * without them is read as "started", as before.
 */
export type ManualSyncResult = {
  organisations?: Array<{
    outcomes?: Array<{ status: "succeeded" | "failed" }>
  }>
  truncated?: boolean
}

// The session branch of these routes syncs only the caller's org. We send an
// empty body. The session branch never returns a "did nothing" 200:
// contention is a 409 and the kill switch a 503, so success here really
// means the sync ran, and the envelope says what it found.
export async function triggerPerformanceSync(): Promise<ManualSyncResult> {
  return apiFetch<ManualSyncResult>("/api/sync/performance", {
    method: "POST",
    body: {},
  })
}

export async function triggerKeywordsSync(): Promise<ManualSyncResult> {
  return apiFetch<ManualSyncResult>("/api/sync/keywords", {
    method: "POST",
    body: {},
  })
}

export type ReviewSyncResult = {
  skipped?: boolean
  failures?: Array<{ errorCode: string }>
}

/**
 * Asks Google for reviews newer than the last successful check. This is the
 * reconcile walk, which always starts at the newest page, rather than the
 * historical sweep, which resumes a cursor and can miss anything new until
 * that walk finishes.
 */
export async function triggerReviewSync(): Promise<ReviewSyncResult> {
  return apiFetch<ReviewSyncResult>("/api/sync/reconcile", {
    method: "POST",
    body: {},
  })
}
