import { ApiClientError } from "@/lib/api/client"

// The single mapping layer from server error codes to GB-English user copy
// (spec §6/§8). No error code is ever shown. The exact second-approver string
// is mandated by spec §8.
const MESSAGES: Record<string, string> = {
  second_approver_required:
    "A different authorised user must approve this reply.",
  publish_permission_required:
    "You do not have permission to publish for this location.",
  approval_not_pending: "This review is no longer awaiting approval.",
  verified_draft_required: "Verify a draft before publishing this reply.",
  stale_draft_evidence:
    "This review changed since the draft was verified. Re-verify before publishing.",
  google_mutation_ambiguous:
    "Google may have applied the change. Check its status before retrying.",
  google_publish_failed: "Google rejected the reply. Please try again.",
  drafts_paused: "Draft generation is temporarily paused. Try again shortly.",
  publishing_paused: "Publishing is temporarily paused. Try again shortly.",
  review_restricted: "This review is restricted from replies.",
  authentication_required: "Your session has expired. Please sign in again.",
  review_changed:
    "The review changed after this draft was prepared. Re-verify the draft and try again.",
  location_not_verified:
    "Google has not verified this location yet, so replies cannot be published.",
  verification_failed:
    "We could not confirm this reply on Google. Try again shortly.",
  verification_required:
    "This reply needs re-verifying before it can be published. Re-verify and try again.",
  publish_in_progress:
    "A publish for this reply is already under way. Wait a moment and try again.",
}

export function describeActionError(error: unknown): string {
  if (error instanceof ApiClientError && MESSAGES[error.code]) {
    return MESSAGES[error.code]
  }
  return "Something went wrong. Please try again."
}
