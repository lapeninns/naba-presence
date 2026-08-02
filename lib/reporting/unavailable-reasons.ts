// Raw sync_checkpoint.last_error_code -> plain copy. The code universe is
// open (it is whatever error.code a thrown sync error carries, defaulting to
// performance_sync_failed / keyword_sync_failed), so the generic fallback is
// load-bearing: an unmapped code must still yield honest copy, never the code.
const KNOWN: Record<string, string> = {
  performance_sync_failed: "Google did not return performance data on the last attempt. We will retry automatically.",
  keyword_sync_failed: "Google did not return search-keyword data on the last attempt. We will retry automatically.",
  google_rate_limited: "Google is rate-limiting requests, so the latest figures may be delayed. We will retry shortly.",
  google_location_not_linked: "This location is no longer linked to Google, so its figures cannot be refreshed.",
  location_not_linked: "This location is no longer linked to Google, so its figures cannot be refreshed.",
  permission_denied: "We no longer have permission to read this location's Google data. Reconnect Google to restore it.",
}

const FALLBACK =
  "Some figures could not be refreshed from Google on the last attempt. We will retry automatically."

export function humaniseUnavailableReasons(codes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  let usedFallback = false
  for (const code of codes) {
    const copy = KNOWN[code]
    if (copy) {
      if (!seen.has(copy)) {
        seen.add(copy)
        out.push(copy)
      }
    } else if (!usedFallback) {
      usedFallback = true
      out.push(FALLBACK)
    }
  }
  return out
}
