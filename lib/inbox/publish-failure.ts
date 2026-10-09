/**
 * Why a publish failed, in the terms that decide what the operator does next.
 *
 * The pane used to answer every failure with "Edit the reply, then try
 * again" and a link to the Google connections — right for a reply Google's
 * moderation refused, wrong for a timeout (the reply was fine; try again)
 * and wrong again for a revoked grant (no edit helps; reconnect). The cause
 * comes from the newest publish attempt's provider code, and from Google's
 * own verdict on the reply where it gave one.
 *
 *  · `content`    Google refused the words. Edit, then publish again.
 *  · `connection` The Google grant or link is gone. Reconnect, then retry.
 *  · `transient`  Google or the network did not answer. Retry as it is.
 *  · `unknown`    No code to go on. Say so, and offer both ways.
 */
export type PublishFailureCause =
  "content" | "connection" | "transient" | "unknown"

// Codes the server raises for a missing or unusable Google credential or
// link (lib/server/google/connection-failures.ts, lib/server/jobs.ts), and
// Google's own auth statuses.
const CONNECTION_CODES = new Set([
  "google_reconnect_required",
  "google_token_unavailable",
  "connection_not_found",
  "connection_disconnected",
  "reconnect_abandoned",
  "google_location_not_linked",
  "location_not_linked",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
])

// Google refused the request as written.
const CONTENT_CODES = new Set([
  "INVALID_ARGUMENT",
  "FAILED_PRECONDITION",
  "review_restricted",
])

// Nothing wrong with the reply or the grant: Google, the network or our own
// runner did not get an answer in time.
const TRANSIENT_CODES = new Set([
  "network_error",
  "google_timeout",
  "google_rate_limited",
  "google_retry_exhausted",
  "google_mutation_ambiguous",
  "recovery_exhausted",
  "lease_expired",
  "UNAVAILABLE",
  "INTERNAL",
  "DEADLINE_EXCEEDED",
  "RESOURCE_EXHAUSTED",
  "ABORTED",
])

export function publishFailureCause(
  reply:
    | {
        publishStatus?: string | null
        googlePolicyViolation?: string | null
        lastErrorCode?: string | null
      }
    | null
    | undefined
): PublishFailureCause {
  if (reply?.googlePolicyViolation || reply?.publishStatus === "rejected") {
    return "content"
  }
  const code = reply?.lastErrorCode
  if (!code) return "unknown"
  if (CONNECTION_CODES.has(code)) return "connection"
  if (CONTENT_CODES.has(code)) return "content"
  if (TRANSIENT_CODES.has(code)) return "transient"
  return "unknown"
}
