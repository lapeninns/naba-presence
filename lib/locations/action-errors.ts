import { ApiClientError } from "@/lib/api/client"

// Every wave-1 server code -> plain GB English. No code is ever shown (spec §7).
const COPY: Record<string, string> = {
  // profile / hours / menu — canonical + publish
  canonical_edit_permission_required: "Only owners and admins can edit this location.",
  publish_permission_required: "You do not have permission to publish this location to Google.",
  permission_denied: "You do not have permission to do that.",
  canonical_resource_stale: "This changed since you loaded it. Refresh and try again.",
  profile_snapshot_stale: "The profile changed since you loaded it. Refresh and try again.",
  hours_snapshot_stale: "The opening hours changed since you loaded them. Refresh and try again.",
  food_menus_stale: "The menu changed since you loaded it. Refresh and try again.",
  profile_overwrite_confirmation_required: "Google changed these details independently. Confirm the overwrite to continue.",
  canonical_overwrite_confirmation_required: "This location changed independently. Confirm the overwrite to continue.",
  google_hours_overwrite_confirmation_required: "Google changed the opening hours independently. Confirm the overwrite to continue.",
  profile_patch_empty: "The selected fields do not produce any change to publish.",
  profile_publishing_disabled: "Publishing to Google is currently unavailable.",
  hours_publishing_disabled: "Publishing to Google is currently unavailable.",
  food_menus_paused: "Menu publishing is currently paused.",
  food_menus_not_eligible: "Google reports that this location cannot have a food menu.",
  food_menus_confirmation_required: "Confirm the full menu replacement to continue.",
  google_location_not_linked: "Link this location to Google before managing it here.",
  location_not_linked: "Link this location to Google before managing it here.",
  // photos
  media_paused: "Photo and video changes are currently paused.",
  publish_not_allowed: "You do not have permission to publish this location to Google.",
  media_stale: "This item changed on Google since you loaded it. Refresh and try again.",
  media_category_not_patchable: "Google does not allow changing an existing item to a cover or profile photo.",
  media_type_unsupported: "That file type is not supported. Upload a JPEG or PNG photo, or an MP4 or QuickTime video.",
  media_file_too_small: "That photo is too small. Google requires photos of at least 10 KB.",
  media_file_too_large: "That file is too large. Uploads cannot exceed 75 MB.",
  customer_media_read_only: "Customer photos cannot be changed here.",
  // booking
  place_actions_paused: "Booking link changes are currently paused.",
  place_action_stale: "This link changed on Google since you loaded it. Refresh and try again.",
  place_action_not_editable: "Google reports that this provider link cannot be edited here.",
  // posts
  posts_paused: "Google posts are currently paused.",
  publishing_paused: "Publishing to Google is currently paused.",
  second_approver_required: "A different authorised user must approve this post.",
  approval_not_pending: "This post is no longer awaiting approval.",
  post_not_found: "That post could not be found. It may have been removed.",
  // M8 consoles — business information (Google-direct)
  business_information_paused: "Publishing business information to Google is currently unavailable.",
  business_information_stale: "These details changed on Google since you loaded them. Refresh and try again.",
  attributes_stale: "These attributes changed on Google since you loaded them. Refresh and try again.",
  business_information_readback_mismatch: "Google did not confirm the change. Refresh and try again.",
  // M8 consoles — industry + administration (Google-direct)
  google_writes_paused: "Publishing to Google is currently unavailable.",
  business_calls_mask_invalid: "Only the calls setting can be changed here.",
  search_query_required: "Enter a search term.",
  administration_confirmation_invalid: "We couldn't confirm that action. Refresh and try again.",
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

// A wave-1 sub-resource returns 409 when the location has no active Google link;
// tabs render a distinct "link this location first" state rather than an error.
export function isNotLinkedError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === "google_location_not_linked" || error.code === "location_not_linked")
  )
}
