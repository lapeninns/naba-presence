import { ApiClientError } from "@/lib/api/client"
import { LISTING_CHANGE_AWAITING_APPROVAL } from "@/lib/contracts/listing-changes"
import {
  operationOutcomeSchema,
  type OperationOutcome,
} from "@/lib/contracts/mutation-operations"

/**
 * The single mapping layer from server error codes to GB-English user copy.
 * No error code is ever shown (inbox spec §6/§8, locations spec §7).
 *
 * Merged in Sprint 4.4 from lib/inbox, lib/locations and lib/settings
 * action-errors. Where the three maps disagreed on a shared code, the wording
 * below is the more specific / honest of the two; each choice is annotated.
 */

/**
 * The subject an approval-flow error refers to. The inbox spec (§8) mandates
 * the exact second-approver string for review replies, and the same server
 * codes are reused by Google posts, so these two codes are the only ones whose
 * copy depends on the surface. Everything else is surface-neutral.
 */
export type ActionErrorContext = "reply" | "post"

export type DescribeActionErrorOptions = {
  context?: ActionErrorContext
}

const APPROVAL_COPY: Record<ActionErrorContext, Record<string, string>> = {
  reply: {
    // Exact string mandated by inbox spec §8.
    second_approver_required:
      "A different authorised user must approve this reply.",
    approval_not_pending: "This review is no longer awaiting approval.",
  },
  post: {
    second_approver_required:
      "A different authorised user must approve this post.",
    approval_not_pending: "This post is no longer awaiting approval.",
  },
}

const COPY: Record<string, string> = {
  // ---- Listing change approvals (two-person mode, P02-S2b) ---------------
  // Not a failure: the change is held for a second publisher.
  listing_change_awaiting_approval:
    "Sent for approval. Another publisher needs to approve this change before it goes to Google.",
  listing_change_upload_unsupported:
    "Uploads can’t be sent for approval yet. Add the photo by its web address instead.",
  listing_second_approver_required:
    "A different publisher must approve this change.",
  change_request_not_pending: "This change is no longer waiting for approval.",
  change_request_changed:
    "This is not the change you were shown. Reload and review it again.",
  change_request_not_found: "This change request was not found.",
  change_request_invalid:
    "This change can no longer be sent as it was requested. Make it again.",
  // ---- Session / permissions (shared) -------------------------------------
  authentication_required:
    "Your session has expired. Sign in again to continue.",
  // Divergence: locations said "do that", settings said "do this for this
  // organisation". The organisation qualifier reads wrong on a location or
  // review action, so the neutral wording wins.
  permission_denied: "You do not have permission to do that.",
  // Divergence: inbox "publish for this location" vs locations "publish this
  // location to Google". Both are publishes to Google scoped to a location.
  publish_permission_required:
    "You do not have permission to publish to Google for this location.",
  publish_not_allowed:
    "You do not have permission to publish to Google for this location.",
  canonical_edit_permission_required:
    "Only owners and admins can edit this location.",
  // DELETE /api/session?scope=all: this browser is signed out, the rest are
  // unknown. Never say "everywhere" happened.
  sign_out_everywhere_failed:
    "You’re signed out on this device, but other devices may still be signed in. Sign in again and retry “Sign out everywhere”.",

  // ---- Google write gates / pauses ---------------------------------------
  // Divergence: inbox "Publishing is temporarily paused. Try again shortly."
  // vs locations "Publishing to Google is currently paused." Keep the Google
  // qualifier and the retry hint.
  publishing_paused:
    "Publishing to Google is temporarily paused. Try again shortly.",
  drafts_paused: "Draft saving is temporarily paused. Try again shortly.",
  // Our own burst limit (lib/server/abuse-limits.ts), not the monthly
  // allowance: waiting is enough.
  draft_rate_limited:
    "Too many drafts were requested in a short time. Wait a moment and try again.",
  google_writes_paused: "Publishing to Google is currently unavailable.",
  // A Business Profile API Google has switched off for good (Business Calls,
  // provider attributes, insurance networks, Q&A). No retry will help.
  google_api_retired:
    "Google no longer offers this Business Profile feature, so it can't be changed here.",
  profile_publishing_disabled:
    "Publishing profile changes to Google is currently unavailable.",
  hours_publishing_disabled:
    "Publishing opening hours to Google is currently unavailable.",
  business_information_paused:
    "Publishing business information to Google is currently unavailable.",
  media_paused: "Photo and video changes are currently paused.",
  place_actions_paused: "Booking link changes are currently paused.",
  posts_paused: "Google posts are currently paused.",
  food_menus_paused: "Menu publishing is currently paused.",
  import_review_paused: "Google import review is currently paused.",
  // sync_paused is thrown by review sync, performance ingestion and keyword
  // ingestion alike, so the copy no longer says "review sync".
  sync_paused: "Syncing with Google is paused right now. Try again shortly.",

  // ---- AI (lib/server/ai.ts) -----------------------------------------------
  ai_not_configured: "AI assistance isn’t available for this workspace yet.",
  ai_timeout: "The AI took too long to respond. Try again shortly.",
  ai_provider_error:
    "The AI provider could not complete that request. Try again shortly.",
  // A 502 without an entry reads as SERVICE_UNAVAILABLE_COPY, which blames
  // Google for a provider that answered — it just answered with nothing.
  ai_empty_response:
    "The AI returned nothing this time. Try again, or write the reply yourself.",

  // 402 when the month's draft allowance is spent; describeActionError adds
  // the reset date from details.resetsAt when the server sent one.
  ai_credits_exhausted:
    "You have used all your AI drafts for this month. You can still write a reply yourself.",
  // 429 that lasts until the month resets, so "wait a moment" would mislead.
  ai_token_backstop:
    "AI drafting is paused for this month because of unusually high usage. You can still write a reply yourself.",

  // ---- Inbox: drafts, verification, publishing ----------------------------
  verified_draft_required: "Verify a draft before publishing this reply.",
  // The 404s on this path all mean "the pane you are looking at is behind the
  // data", which the status fallback's "it may have been removed" only half
  // says — the fix is to reload the review, not to hunt for the missing row.
  draft_not_found:
    "That draft no longer exists. Reload the review and write a new one.",
  review_or_draft_not_found:
    "This review or its draft no longer exists. Reload the inbox.",
  reply_not_found: "There is no reply on this review to remove.",
  // The approver's pane is bound to the draft it showed. A stale one is a 409
  // whose fallback says "refresh and try again" without saying what changed —
  // and what changed is the text they were about to approve.
  approval_draft_changed:
    "This reply changed after you opened it. Read the current draft before approving or rejecting it.",
  // Google posts: the approval names the revision the approver read.
  approval_post_changed:
    "This post changed after you opened it. Read the current version before approving or rejecting it.",
  expected_revision_required:
    "Reload this post, then approve the version you can see.",
  stale_draft_evidence:
    "The review changed after this reply was checked. Press Publish again to re-check it against the current review.",
  google_mutation_ambiguous:
    "Google may have applied the change. Check its status before retrying.",
  google_publish_failed: "Google rejected the reply. Please try again.",
  review_restricted: "This review is restricted from replies.",
  review_changed:
    "The review changed after this draft was prepared. Re-verify the draft and try again.",
  location_not_verified:
    "Google has not verified this location yet, so replies cannot be published.",
  verification_failed:
    "We could not confirm this reply on Google. Try again shortly.",
  verification_required:
    "This reply needs re-verifying before it can be published. Re-verify and try again.",
  // Bulk rows: an unexpected fault on one row is reported on that row. After
  // an approval it may already have reached Google, so it is not "failed".
  publish_outcome_unknown:
    "The approval is recorded but we could not tell whether the reply reached Google. Check the review before trying again.",
  bulk_row_failed: "Something went wrong with this one. Nothing was changed.",
  // After a bulk approval: the decision is spent, so "try again" would only
  // earn approval_not_pending. Say what happens next instead.
  publish_retry_scheduled:
    "The approval is recorded. Google could not take the reply just now, so it will be sent again automatically.",
  google_reply_rejected:
    "The approval is recorded, but Google rejected the reply, so it is not on the profile. Edit the reply and publish it again.",
  publish_not_sent:
    "The approval is recorded, but the reply was not sent to Google. Open the review to check its state.",
  publish_in_progress:
    "A publish for this reply is already under way. Wait a moment and try again.",
  // The Google write pipeline raises these while another request for the same
  // snapshot is still in flight. Without them the 409 fell through to the
  // status fallback, which told the user to refresh — the one thing that
  // cannot help, because refreshing re-derives the same snapshot.
  hours_publish_in_progress:
    "A publish of these opening hours is already under way. Wait a moment and try again.",
  profile_operation_in_progress:
    "A publish of this profile is already under way. Wait a moment and try again.",
  food_menus_publish_in_progress:
    "A publish of this menu is already under way. Wait a moment and try again.",
  gbp_mutation_in_progress:
    "This change is already being applied to Google. Wait a moment and try again.",
  // The default mismatch code for any Google write whose surface does not
  // override it. A 502 without an entry reads as "temporarily unavailable",
  // which invites a blind retry of a write that may well have landed.
  google_readback_mismatch:
    "Google did not confirm the change. Check it on Google before publishing again.",
  // `resolveExistingPublishAttempt` / the delete equivalent. Both are 409s
  // whose status fallback tells the user to refresh, which cannot help: the
  // previous attempt is settled and the reply itself has to change (publish)
  // or the deletion has to be abandoned.
  previous_publish_failed:
    "Google rejected the last attempt at this reply. Edit the reply, then publish again.",
  previous_delete_failed:
    "Google refused to remove this reply, and retrying the same request won’t change that.",
  // 429s, but nothing to do with the caller's rate: the attempt is parked on
  // its own back-off, so "too many requests" would blame the wrong party.
  publish_retry_not_ready:
    "This reply is waiting to be retried automatically. Give it a few minutes.",
  delete_retry_not_ready:
    "Removing this reply is waiting to be retried automatically. Give it a few minutes.",
  reply_diverged:
    "The reply on Google is not the one we sent. Check it on Google before replacing it.",
  google_delete_failed: "Google refused to remove the reply. Please try again.",

  // ---- Locations: profile / hours / menu ----------------------------------
  canonical_resource_stale:
    "This changed since you loaded it. Refresh and try again.",
  profile_snapshot_stale:
    "The profile changed since you loaded it. Refresh and try again.",
  hours_snapshot_stale:
    "The opening hours changed since you loaded them. Refresh and try again.",
  food_menus_stale:
    "The menu changed since you loaded it. Refresh and try again.",
  profile_overwrite_confirmation_required:
    "Google changed these details independently. Confirm the overwrite to continue.",
  canonical_overwrite_confirmation_required:
    "This location changed independently. Confirm the overwrite to continue.",
  google_hours_overwrite_confirmation_required:
    "Google changed the opening hours independently. Confirm the overwrite to continue.",
  profile_patch_empty:
    "The selected fields do not produce any change to publish.",
  profile_fields_required: "Select at least one profile field.",
  profile_field_direction_unsupported:
    "One of the selected fields cannot be changed in that direction.",
  profile_confirmation_invalid:
    "We couldn’t confirm that action. Refresh and try again.",
  food_menus_not_eligible:
    "Google reports that this location cannot have a food menu.",
  food_menus_confirmation_required:
    "Confirm the full menu replacement to continue.",
  google_location_not_linked:
    "Link this location to Google before managing it here.",
  location_not_linked: "Link this location to Google before managing it here.",

  // ---- Locations: photos ---------------------------------------------------
  media_stale:
    "This item changed on Google since you loaded it. Refresh and try again.",
  media_category_not_patchable:
    "Google does not allow changing an existing item to a cover or profile photo.",
  media_type_unsupported:
    "That file type is not supported. Upload a JPEG or PNG photo, or an MP4 or QuickTime video.",
  media_file_too_small:
    "That photo is too small. Google requires photos of at least 10 KB.",
  media_file_too_large: "That file is too large. Uploads cannot exceed 75 MB.",
  customer_media_read_only: "Customer photos cannot be changed here.",
  // 400 has no status fallback, so without this the empty-upload guard read
  // as "Something went wrong".
  media_file_required: "Choose a photo or video to upload.",
  media_readback_missing:
    "Google accepted the upload but did not name it, so we can’t show it yet. Refresh in a moment.",
  media_not_found:
    "That photo or video is no longer on this location. Refresh the tab.",
  media_needs_resolution:
    "Google did not confirm whether this was added. Check the listing on Google, then mark it as added or not added before trying again.",
  media_create_in_progress:
    "This is still being added to Google. Wait a moment, then refresh.",
  media_upload_interrupted:
    "The upload to Google did not finish, so nothing was added. Try again.",
  media_resolution_not_pending:
    "That upload no longer needs a decision. Refresh the tab.",
  media_resolution_conflict:
    "This was marked as not added while it was still being sent, and Google has now added it. Check the listing’s photos before adding it again.",

  // ---- Locations: booking --------------------------------------------------
  place_action_stale:
    "This link changed on Google since you loaded it. Refresh and try again.",
  place_action_not_editable:
    "Google reports that this provider link cannot be edited here.",
  place_action_not_found:
    "That booking link is no longer on this location. Refresh the tab.",

  // ---- Locations: posts ----------------------------------------------------
  post_not_found: "That post could not be found. It may have been removed.",
  // A post holds `publishing` from before the Google call until settle, so a
  // double-click gets this 409 rather than a second write.
  post_publish_in_progress:
    "This post is already being published. Wait a moment and try again.",
  // The read-back found no post at Google. A 502 without an entry says "try
  // again shortly", which reads as "we may have published it"; the truthful
  // answer is that nothing was published.
  google_post_not_published:
    "Google does not list this post, so nothing was published. You can publish it again.",
  // A post update Google never confirmed. Re-sending it is safe (it replaces
  // the post's text rather than adding a post), so the copy says so.
  google_post_update_unconfirmed:
    "Google did not confirm this change to the post. Publish it again to resend it.",
  // An unconfirmed create: sending again could make a second live post.
  post_publish_uncertain:
    "Google has not confirmed whether this post went live. Refresh the posts list before changing it.",

  // ---- Locations: business information (Google-direct) --------------------
  business_information_stale:
    "These details changed on Google since you loaded them. Refresh and try again.",
  attributes_stale:
    "These attributes changed on Google since you loaded them. Refresh and try again.",
  business_information_readback_mismatch:
    "Google did not confirm the change. Refresh and try again.",

  // ---- Locations: industry + administration (Google-direct) ---------------
  search_query_required: "Enter a search term.",
  administration_confirmation_invalid:
    "We couldn’t confirm that action. Refresh and try again.",

  // ---- Locations: import review (suggestions from Google) -----------------
  proposal_not_found:
    "That suggestion could not be found. It may have been removed.",
  proposal_not_pending: "This suggestion has already been decided.",
  proposal_superseded:
    "This suggestion was refreshed from Google. Review the latest version.",
  proposal_target_missing:
    "The menu item this suggestion applies to no longer exists here.",
  proposal_patch_invalid:
    "This suggestion could not be applied. Refresh from Google and try again.",
  proposal_action_unsupported:
    "That action is not available for this suggestion.",
  proposal_apply_failed:
    "This suggestion could not be applied. Try again shortly.",
  import_confirmation_invalid:
    "We couldn’t confirm that action. Refresh and try again.",

  // ---- Settings: policy ----------------------------------------------------
  direct_publish_consent_required:
    "An owner must confirm direct publishing before approval can be turned off.",
  organisation_not_found: "We couldn’t find this organisation’s settings.",

  // ---- Settings: team ------------------------------------------------------
  owner_role_required:
    "Only an owner can grant, change or remove the owner role.",
  last_owner:
    "You can’t remove or demote the last owner. Make someone else an owner first.",
  cannot_remove_self:
    "You can’t remove your own access. Ask another owner or admin to do it.",
  member_not_found: "That team member no longer exists.",
  use_invitations: "Send an invitation instead of adding someone directly.",
  invitation_pending:
    "There’s already a pending invitation for that email address.",
  already_a_member:
    "That person is already in this organisation. Change their role from the team list instead.",
  invitation_not_found: "That invitation is no longer available.",
  viewer_cannot_publish: "Viewers can’t be given publishing access.",
  duplicate_location: "That location appears more than once.",
  location_not_found: "That location no longer exists.",
  // Client access (PUT /api/members/[userId]/client-access, invitations).
  invitation_scope_empty:
    "Those clients or locations have no listings left, so the invitation would give access to nothing. Choose others, or invite for all of them.",
  role_sees_all_clients:
    "Owners and admins always see every client. Change their role to limit what they see.",
  duplicate_client: "That client appears more than once.",
  client_not_found:
    "One of those clients no longer exists. Reload and try again.",

  // ---- Settings: compliance ------------------------------------------------
  privacy_request_not_found: "That privacy request no longer exists.",
  privacy_legal_hold:
    "Some matching reviews are under an active legal hold and can’t be erased yet.",
  privacy_subject_not_found: "No records matched that reference.",
  privacy_request_resolved:
    "This request has already been completed or rejected, so it can’t be worked on again.",
  privacy_request_transition_invalid:
    "A privacy request can’t move back to that status.",
  // The local erasure committed; only the withdrawal at Google failed, and
  // the request is deliberately left open. The 409 fallback ("refresh and try
  // again") hides that half the work is already done and durable.
  privacy_reply_withdraw_failed:
    "The reply could not be withdrawn from Google. The local records were erased and the request stays open — retry it once Google is reachable.",
  legal_hold_not_found: "There’s no active legal hold for that review.",
  review_not_found: "That review no longer exists.",

  // ---- Settings: connections (OAuth) --------------------------------------
  google_oauth_denied: "Google sign-in was cancelled before it finished.",
  invalid_oauth_callback:
    "Google sign-in didn’t complete. Try connecting again.",
  invalid_oauth_state:
    "That Google sign-in link has expired. Try connecting again.",
  oauth_session_changed:
    "Your session changed during sign-in. Try connecting again.",
  google_not_configured: "Google Business Profile isn’t available right now.",
  google_reconnect_required:
    "Google access has expired. Reconnect this account to continue.",
  // Distinct from google_reconnect_required on purpose: the grant is intact
  // and nobody needs to reconnect. Without an entry the 503 reads as the
  // generic "Google or our service is unavailable", which invites the one
  // action — reconnecting — that would not help.
  google_token_unavailable:
    "We could not get Google access just now. Try again shortly; there is no need to reconnect.",
  connection_not_found: "That connection is no longer available.",
  google_pagination_cycle:
    "Google returned an unexpected response. Try again shortly.",
  // Google's own throttle, not the caller's. The 429 fallback ("Too many
  // requests") blames the user for a limit they did not reach.
  google_rate_limited:
    "Google is limiting requests right now. Wait a moment and try again.",

  // ---- Settings: connections (accounts / locations / links) ---------------
  accounts_not_discovered:
    "Discover your Google accounts before importing locations.",
  location_routing_conflict:
    "That Google location is already managed by another organisation.",
  relink_confirmation_required:
    "Confirm the change before moving this location’s history.",
  location_already_linked:
    "That location is already linked to a different Google location.",
  external_location_not_found: "That Google location couldn’t be found.",
  location_link_not_found: "That location link no longer exists.",

  // ---- Settings: notifications --------------------------------------------
  account_required: "Choose a Google account first.",
  active_google_account_not_found: "Select an active Google account first.",

  // ---- Settings: backfill --------------------------------------------------
  backfill_batch_running:
    "A sync batch is already in progress. Wait for it to finish before cancelling.",

  // ---- Settings: operations health ----------------------------------------
  // The replay route only re-arms a failed or dead-lettered event, so the 404
  // fallback ("it may have been removed") describes the wrong cause: the row
  // is usually there and simply running.
  replay_event_not_found:
    "That event can’t be replayed. Only failed and dead-lettered events can be, and one that is already running has to finish first.",

  // ---- Google canonical codes ---------------------------------------------
  // Passed through from Google by the listing routes (administration,
  // industry). The status fallback read a Google 404 as "It may have been
  // removed", as if the listing had vanished, when Google had only refused
  // the account or resource named in the request.
  NOT_FOUND:
    "Google couldn’t find that account or listing. Check the details and try again. Nothing was changed.",
  PERMISSION_DENIED:
    "Google refused this change: the connected login doesn’t have permission for it. Nothing was changed.",
  INVALID_ARGUMENT:
    "Google didn’t accept those details. Check them and try again. Nothing was changed.",

  // ---- Client-side --------------------------------------------------------
  // A write whose request got no answer (apiFetch, the upload XHR). Same
  // sentence as NETWORK_ERROR_COPY below.
  network_error:
    "We couldn’t reach NabaPresence. Check your connection and try again.",
  malformed_response:
    "The server sent an unexpected response. Refresh and try again.",
}

// Copy for an ApiClientError whose code has no entry above, keyed by the HTTP
// status the server chose. Every unmapped 401 used to read "Something went
// wrong" in the inbox, which hid a signed-out session behind a retry button.
const STATUS_FALLBACK: Record<number, string> = {
  401: "Your session has expired. Sign in again to continue.",
  403: "You do not have permission to do that.",
  404: "That could not be found. It may have been removed.",
  409: "This changed since you loaded it. Refresh and try again.",
  413: "That upload is too large.",
  429: "Too many requests. Wait a moment and try again.",
}

export const SERVICE_UNAVAILABLE_COPY =
  "Google or our service is temporarily unavailable. Try again shortly."
export const NETWORK_ERROR_COPY =
  "We couldn’t reach NabaPresence. Check your connection and try again."
export const GENERIC_ERROR_COPY = "Something went wrong. Please try again."
export const TIMEOUT_ERROR_COPY =
  "Google took too long to answer. Nothing was changed — try again."

/**
 * A timed-out or cancelled fetch. `AbortSignal.timeout()` rejects with a
 * `TimeoutError` and `AbortController.abort()` with an `AbortError`; both are
 * `DOMException`s, which is why neither matched the `TypeError` branch below.
 * Named rather than `instanceof DOMException` so it also holds in jsdom and on
 * the server, where the constructor is not always the same global.
 */
export function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
}

/**
 * Copy for an error CODE, rather than a thrown error.
 *
 * The bulk endpoint and the failed-publish banner both report codes that were
 * never thrown here — they came back inside a per-row result or a stored
 * attempt — and they deserve the same sentences as the errors that were.
 */
export function describeErrorCode(code: unknown): string {
  if (typeof code !== "string") return describeActionError(code)
  return COPY[code] ?? GENERIC_ERROR_COPY
}

export function describeActionError(
  error: unknown,
  options: DescribeActionErrorOptions = {}
): string {
  if (error instanceof ApiClientError) {
    const context = options.context ?? "reply"
    if (error.code === "ai_credits_exhausted") {
      const resetsAt = (error.details as { resetsAt?: unknown } | undefined)
        ?.resetsAt
      const date = typeof resetsAt === "string" ? new Date(resetsAt) : undefined
      if (date && !Number.isNaN(date.getTime())) {
        const formatted = date.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        })
        return `You have used all your AI drafts for this month. They reset on ${formatted}. You can still write a reply yourself.`
      }
    }
    const mapped = APPROVAL_COPY[context][error.code] ?? COPY[error.code]
    if (mapped) return mapped
    if (error.status >= 500) return SERVICE_UNAVAILABLE_COPY
    const byStatus = STATUS_FALLBACK[error.status]
    if (byStatus) return byStatus
    return GENERIC_ERROR_COPY
  }
  // fetch() rejects with a TypeError when the network is down or the request
  // never reached the server; apiFetch wraps it as `network_error` only for
  // writes.
  if (error instanceof TypeError) return NETWORK_ERROR_COPY
  // An aborted or timed-out request rejects with a DOMException, NOT a
  // TypeError, so it used to fall through to "Something went wrong" — the one
  // sentence this file exists to avoid. A request that ran out of time is a
  // different fact from a request that failed, and the operator can act on it.
  if (isTimeoutError(error)) return TIMEOUT_ERROR_COPY
  return GENERIC_ERROR_COPY
}

/** Error copy for one step in a flow whose earlier writes may already have succeeded. */
export function describePublishStepError(
  error: unknown,
  target: "local" | "google"
): string {
  if (
    isTimeoutError(error) ||
    (error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError"))
  ) {
    return target === "google"
      ? "Google did not confirm this step. It may have applied the change; check Google before retrying."
      : "NabaPresence did not confirm this save. It may have been saved; reload to check before retrying."
  }
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "PERMISSION_DENIED":
        return "Google refused this change: the connected login doesn’t have permission for it."
      case "NOT_FOUND":
        return "Google couldn’t find that account or listing. Check the details and try again."
      case "INVALID_ARGUMENT":
        return "Google didn’t accept those details. Check them and try again."
    }
  }
  return describeActionError(error)
}

/**
 * A wave-1 sub-resource returns 409 when the location has no active Google
 * link; tabs render a distinct "link this location first" state rather than
 * an error.
 */
export function isNotLinkedError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === "google_location_not_linked" ||
      error.code === "location_not_linked")
  )
}

/** Review sync is paused by ops — settings shows a paused notice, not an error. */
export function isPausedError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "sync_paused"
}

// ---- Outcomes of failed writes -------------------------------------------

/**
 * Codes that say the write may have reached Google and nothing yet shows
 * whether it applied. Retrying blindly could apply it twice.
 */
const UNCERTAIN_CODES = new Set([
  "google_mutation_ambiguous",
  "mutation_uncertain",
  "post_publish_uncertain",
  "publish_outcome_unknown",
  "media_needs_resolution",
  "network_error",
])

/**
 * What a failed write call means in the shared outcome vocabulary
 * (lib/contracts/mutation-operations.ts), judged from the error alone:
 *
 *   uncertain  the request may have been applied: an ambiguous provider
 *              answer, a dropped connection or timeout, or a gateway error
 *              that carried no answer from the app at all;
 *   sent       another request under the same intent (or for the same
 *              change) is still on its way;
 *   rejected   Google answered and refused (its own status word as code);
 *   failed     anything else: the app refused before sending, or the
 *              request completed without applying.
 *
 * A replayed receipt names its outcome in `details.outcome`, which wins.
 * The receipt itself (`GET /api/mutations/{intentId}`) is the authority;
 * this is the best guess until it has been read.
 */
export function errorOutcome(
  error: unknown
): Extract<
  OperationOutcome,
  "uncertain" | "sent" | "rejected" | "failed" | "awaiting_approval"
> {
  if (error instanceof ApiClientError) {
    // A listing write parked for a second publisher (lib/api/client.ts).
    if (error.code === LISTING_CHANGE_AWAITING_APPROVAL) {
      return "awaiting_approval"
    }
    const named = operationOutcomeSchema.safeParse(
      (error.details as { outcome?: unknown } | undefined)?.outcome
    )
    if (
      named.success &&
      (named.data === "uncertain" ||
        named.data === "sent" ||
        named.data === "rejected" ||
        named.data === "failed")
    ) {
      return named.data
    }
    if (UNCERTAIN_CODES.has(error.code)) return "uncertain"
    if (error.code.endsWith("_in_progress")) return "sent"
    // The same test the server's receipts use (lib/server/mutation-operations.ts
    // failureOutcome): Google's own 4xx refusal, not auth, timeout or rate
    // limiting.
    if (
      error.status >= 400 &&
      error.status < 500 &&
      ![401, 408, 429].includes(error.status) &&
      !error.reconnectRequired &&
      (/^[A-Z][A-Z_]+$/.test(error.code) || error.code === "google_api_error")
    )
      return "rejected"
    // No JSON answer from the app (a proxy's 502/504), an unhandled server
    // error (the provider write may have landed and only the settle after it
    // failed), or a 2xx whose body did not parse: the handler may have run to
    // completion. Typed 5xx codes are the app's own verdicts and stay failed.
    if (
      error.status >= 500 &&
      (error.code === "http_error" ||
        error.code === "internal_error" ||
        error.code === "malformed_response")
    )
      return "uncertain"
    return "failed"
  }
  if (error instanceof TypeError || isTimeoutError(error)) return "uncertain"
  return "failed"
}

/**
 * True when a retry of the same action must reuse its intent: the first
 * request may have been applied, so the server has to answer the retry from
 * the receipt rather than write again.
 */
export function isUnconfirmedFailure(error: unknown): boolean {
  const outcome = errorOutcome(error)
  return outcome === "uncertain" || outcome === "sent"
}
