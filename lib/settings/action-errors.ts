import { ApiClientError } from "@/lib/api/client"

const COPY: Record<string, string> = {
  // Settings / policy
  direct_publish_consent_required: "An owner must confirm direct publishing before approval can be turned off.",
  organisation_not_found: "We couldn’t find this organisation’s settings.",
  // Team
  owner_role_required: "Only an owner can grant, change or remove the owner role.",
  last_owner: "You can’t remove or demote the last owner. Make someone else an owner first.",
  cannot_remove_self: "You can’t remove your own access. Ask another owner or admin to do it.",
  member_not_found: "That team member no longer exists.",
  use_invitations: "Send an invitation instead of adding someone directly.",
  invitation_pending: "There’s already a pending invitation for that email address.",
  invitation_not_found: "That invitation is no longer available.",
  viewer_cannot_publish: "Viewers can’t be given publishing access.",
  duplicate_location: "That location appears more than once.",
  location_not_found: "That location no longer exists.",
  // Compliance
  privacy_request_not_found: "That privacy request no longer exists.",
  privacy_legal_hold: "Some matching reviews are under an active legal hold and can’t be erased yet.",
  privacy_subject_not_found: "No records matched that reference.",
  legal_hold_not_found: "There’s no active legal hold for that review.",
  review_not_found: "That review no longer exists.",
  // Connections — OAuth
  google_oauth_denied: "Google sign-in was cancelled before it finished.",
  invalid_oauth_callback: "Google sign-in didn’t complete. Try connecting again.",
  invalid_oauth_state: "That Google sign-in link has expired. Try connecting again.",
  oauth_session_changed: "Your session changed during sign-in. Try connecting again.",
  google_not_configured: "Google Business Profile isn’t available right now.",
  google_reconnect_required: "Google access has expired. Reconnect this account to continue.",
  connection_not_found: "That connection is no longer available.",
  google_pagination_cycle: "Google returned an unexpected response. Try again shortly.",
  // Connections — accounts / locations / links
  accounts_not_discovered: "Discover your Google accounts before importing locations.",
  location_routing_conflict: "That Google location is already managed by another organisation.",
  relink_confirmation_required: "Confirm the change before moving this location’s history.",
  location_already_linked: "That location is already linked to a different Google location.",
  external_location_not_found: "That Google location couldn’t be found.",
  location_link_not_found: "That location link no longer exists.",
  // Notifications
  account_required: "Choose a Google account first.",
  active_google_account_not_found: "Select an active Google account first.",
  // Backfill
  sync_paused: "Review sync is paused right now. Try again shortly.",
  backfill_batch_running: "A sync batch is already in progress. Wait for it to finish before cancelling.",
}

export function describeActionError(error: unknown): string {
  if (error instanceof ApiClientError) {
    const mapped = COPY[error.code]
    if (mapped) return mapped
    if (error.status === 401) return "Your session has expired. Sign in again to continue."
    if (error.status >= 500) return "Google or our service is temporarily unavailable. Try again shortly."
  }
  return "Something went wrong. Please try again."
}

export function isPausedError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "sync_paused"
}
