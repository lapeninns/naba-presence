import {
  GENERIC_ERROR_COPY,
  describeErrorCode,
} from "@/lib/errors/action-errors"

/**
 * How one recorded Google change attempt reads: the word and the tone. One
 * helper, so the same outcome is never amber in one place and red in
 * another. A failure is danger; an attempt whose outcome Google never
 * confirmed ("ambiguous") is a warning: it may have landed.
 */

export type ActivityTone = "success" | "warning" | "danger" | "neutral"

export function activityTone(status: string): ActivityTone {
  switch (status) {
    case "succeeded":
      return "success"
    case "failed":
      return "danger"
    case "ambiguous":
      return "warning"
    default:
      return "neutral"
  }
}

/** The same tone in the status pill's vocabulary. */
export function activityPillTone(
  status: string
): "ok" | "warn" | "bad" | "outline" {
  const tone = activityTone(status)
  return tone === "success"
    ? "ok"
    : tone === "warning"
      ? "warn"
      : tone === "danger"
        ? "bad"
        : "outline"
}

/** "publish_food_menus" → "Publish food menus". Only for words that are not on a map. */
export function humaniseActivity(value: string): string {
  const lower = value.toLowerCase().replace(/[_-]+/g, " ").trim()
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : value
}

/** What an unmapped key reads as. A raw token is never shown. */
export const OTHER_CHANGE = "Other change"

/**
 * What was done, in words. Keys are every `operation` the activity list can
 * carry (management writes, hours, profile, links, media, posts, reviews,
 * bulk and schedule rows); the projection is
 * `lib/server/location-activity-projection.ts`.
 */
export const ACTIVITY_OPERATION_LABELS: Record<string, string> = {
  patch: "Updated",
  update_lodging: "Updated",
  start_verification: "Started verification",
  complete_verification: "Entered verification PIN",
  create_admin: "Added administrator",
  update_admin: "Changed administrator",
  delete_admin: "Removed administrator",
  accept_invitation: "Accepted invitation",
  decline_invitation: "Declined invitation",
  transfer_location: "Transferred listing",
  delete_location: "Deleted listing",
  create_location: "Created listing",
  accept_google_update: "Accepted Google’s update",
  publish: "Sent to Google",
  publish_google: "Sent to Google",
  validate: "Checked",
  validate_google: "Checked",
  reconcile: "Compared with Google",
  import_google: "Imported from Google",
  import_nabatable: "Imported",
  create: "Added",
  update: "Updated",
  delete: "Removed",
  bulk_change: "Bulk change",
  scheduled_publication: "Scheduled post sent",
}

/** Which part of the listing it touched. */
export const ACTIVITY_RESOURCE_LABELS: Record<string, string> = {
  business_info: "Business profile",
  profile: "Business profile",
  attributes: "Attributes",
  lodging: "Lodging",
  location_lifecycle: "Listing",
  verification: "Verification",
  verification_start: "Verification",
  verification_complete: "Verification",
  account_admin: "Administrators",
  location_admin: "Administrators",
  administration_access: "Administrators",
  invitation: "Invitation",
  hours: "Opening hours",
  food_menus: "Food menu",
  place_actions: "Booking and order links",
  place_action: "Booking and order links",
  media: "Photos",
  posts: "Posts",
  reviews: "Reviews",
  bulk: "Several listings",
  // Bulk rows name their family here.
  regular_hours: "Opening hours",
  special_hours: "Special hours",
  more_hours: "More hours",
  categories: "Categories",
  post_draft: "Post drafts",
  photos: "Photos",
  review_approval: "Review replies",
  review_template_reply: "Review replies",
  mixed: "Several areas",
  // Types the database allows but no writer produces yet.
  business_calls: "Call settings",
  healthcare_services: "Healthcare services",
  healthcare_provider_attributes: "Healthcare details",
  notifications: "Notifications",
}

const MASK_LABELS: Record<string, string> = {
  regularHours: "Regular hours",
  specialHours: "Special hours",
  moreHours: "More hours",
  title: "Business name",
  profile: "Description",
  "profile.description": "Description",
  phoneNumbers: "Phone numbers",
  adWordsLocationExtensions: "Ad phone number",
  websiteUri: "Website",
  storefrontAddress: "Address",
  categories: "Categories",
  serviceArea: "Service area",
  serviceItems: "Services",
  labels: "Labels",
  storeCode: "Store code",
  openInfo: "Opening status",
  "openInfo.status": "Opening status",
  "openInfo.openingDate": "Opening date",
  relationshipData: "Related locations",
  menus: "Food menu",
  media: "Photos",
  localPost: "Post",
}

/** The label for one `update_mask` key; "Other change" when it is not known. */
export function activityMaskLabel(key: string): string {
  const exact = MASK_LABELS[key]
  if (exact) return exact
  // storefrontAddress.locality, relationshipData.parentChain, …
  const parent = key.split(".")[0] ?? key
  if (key.includes(".") && MASK_LABELS[parent]) return MASK_LABELS[parent]
  if (key.startsWith("attributes/")) return "Attributes"
  // Lodging is one write with hundreds of paths; the group is the answer.
  if (key === "metadata.updateTime") return "Lodging details"
  if (LODGING_GROUPS.has(parent)) return "Lodging details"
  return OTHER_CHANGE
}

const LODGING_GROUPS = new Set([
  "accessibility",
  "activities",
  "business",
  "commonLivingArea",
  "connectivity",
  "families",
  "foodAndDrink",
  "guestUnits",
  "healthAndSafety",
  "housekeeping",
  "metadata",
  "parking",
  "pets",
  "policies",
  "pools",
  "property",
  "services",
  "sustainability",
  "transportation",
  "wellness",
])

/** The distinct labels for a mask, in the order they first appear. */
export function activityMaskLabels(keys: readonly string[]): string[] {
  return [...new Set(keys.map(activityMaskLabel))]
}

export function activityOperationLabel(operation: string): string {
  return ACTIVITY_OPERATION_LABELS[operation] ?? OTHER_CHANGE
}

export function activityResourceLabel(resourceType: string): string {
  return ACTIVITY_RESOURCE_LABELS[resourceType] ?? OTHER_CHANGE
}

/** "Opening hours · Sent to Google" reads as one line; this is the title. */
export function activityTitle(operation: string, resourceType: string) {
  const what = activityOperationLabel(operation)
  const where = activityResourceLabel(resourceType)
  return what === OTHER_CHANGE && where === OTHER_CHANGE
    ? OTHER_CHANGE
    : `${what} · ${where}`
}

// Recorded codes that the shared error copy does not cover. A code that is on
// neither list reads as the shared generic sentence, never as the token.
const ERROR_LABELS: Record<string, string> = {
  target_changed: "Google’s version changed before this was sent.",
  attempt_interrupted: "It was interrupted before it finished.",
  execution_interrupted: "It was interrupted before it finished.",
  response_ambiguous:
    "Google’s answer was unclear, so it may have gone through.",
  administration_outcome_unknown:
    "Google’s answer was unclear, so it may have gone through.",
  place_action_outcome_unknown:
    "Google’s answer was unclear, so it may have gone through.",
  google_mutation_ambiguous:
    "Google’s answer was unclear, so it may have gone through.",
  provider_rejected: "Google rejected the change.",
  lifecycle_provider_rejected: "Google rejected the change.",
  administration_provider_rejected: "Google rejected the change.",
  place_action_provider_rejected: "Google rejected the change.",
  lifecycle_postcondition_unconfirmed:
    "Google has not confirmed the change yet.",
  administration_postcondition_unconfirmed:
    "Google has not confirmed the change yet.",
  google_confirmation_unresolved: "Google has not confirmed the change yet.",
  outcome_unverified: "Google has not confirmed the change yet.",
  recovery_exhausted: "We could not finish it after several tries.",
  job_failed: "We could not finish it. Try again.",
  schedule_deadline_passed: "It was too late to send.",
  expired_content: "The post had already expired.",
  outside_dispatch_window: "It was outside the allowed sending hours.",
  paused_when_due: "Publishing was paused when it was due.",
  source_changed: "The post was edited after it was scheduled.",
  source_superseded: "The post was replaced after it was scheduled.",
  approval_invalidated: "The approval no longer applied.",
  schedule_cancelled: "The schedule was cancelled.",
}

/** One sentence for a recorded failure code, in the shared error copy. */
export function activityErrorLabel(code: string): string {
  const own = ERROR_LABELS[code]
  if (own) return own
  const shared = describeErrorCode(code)
  return shared === GENERIC_ERROR_COPY
    ? "Google could not complete this change."
    : shared
}

export function activityExecutionLabel(state: string): string | null {
  switch (state) {
    case "pending":
      return "Being sent to Google"
    case "accepted":
      return "Google accepted the request"
    case "rejected":
      return "Google rejected the request"
    case "unknown":
      return "Google’s answer is unknown"
    default:
      return null
  }
}

export function activityConfirmationLabel(state: string): string | null {
  switch (state) {
    case "pending":
      return "Google confirmation: waiting"
    case "confirmed":
      return "Google confirmation: confirmed"
    case "unresolved":
      return "Google confirmation: not confirmed yet"
    default:
      return null
  }
}

const STATUS_LABELS: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  ambiguous: "Outcome unclear",
  started: "Started",
  validating: "Checking",
  validated: "Checked",
  publishing: "Sending",
  importing: "Importing",
  accepted: "Accepted",
  retryable: "Will retry",
  superseded: "Replaced",
  stale: "Out of date",
  needs_resolution: "Needs a look",
  queued: "Queued",
  running: "Running",
  conflict: "Conflict",
  cancelled: "Cancelled",
  expired: "Expired",
  published: "Published",
  rejected: "Rejected by Google",
  missed: "Missed",
}

export function activityStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Other"
}
