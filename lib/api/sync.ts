import { apiFetch } from "./client"

// The session branch of these routes syncs only the caller's org. We send an
// empty body and ignore the batch envelope — the surface only needs success
// vs an ApiClientError (which the trigger button maps to copy). The session
// branch never returns a "did nothing" 200: contention is a 409 and the kill
// switch a 503, so success here really means the sync ran.
export async function triggerPerformanceSync(): Promise<void> {
  await apiFetch("/api/sync/performance", { method: "POST", body: {} })
}

export async function triggerKeywordsSync(): Promise<void> {
  await apiFetch("/api/sync/keywords", { method: "POST", body: {} })
}
