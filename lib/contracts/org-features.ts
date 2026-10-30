/**
 * Known per-organisation product flags (organisation_feature, migration
 * 0090). Dependency-free so scripts/ops-pause.mjs can import it through
 * Node's type stripping and refuse a name nothing reads: the table accepts
 * any snake_case name, so a slice adding a feature adds it here only.
 */
export const ORG_FEATURES = [
  // One-time scheduled posts (plan P08). Off: the schedule routes refuse
  // to create, approve, revise or resume, the calendar is unavailable and
  // the runner blocks a due schedule (lib/server/publication-schedules.ts).
  "post_scheduling",
  // Repeating (daily, weekly, monthly) publication schedules, on top of
  // post_scheduling. One-time is the generally available frequency; a
  // repeating rule is refused, and an active one blocked, without this.
  "post_scheduling_recurring",
  // Bulk listing and review actions (plan P09).
  "bulk_actions",
  // Two-person approval of direct listing writes (plan P02-S2b): with the
  // organisation's require_two_person_approval on, a publisher's listing
  // write parks as a change request for a second publisher to approve
  // (lib/server/listing-changes.ts).
  "listing_change_approvals",
  // The owner Data and privacy settings area (plan P04-7): privacy
  // requests, legal holds, subject export and retention status at
  // /settings/privacy. The API routes it drives stay served either way.
  "privacy_settings",
  // Owner switch between business and agency mode (plan P06-5): the
  // Settings card and PATCH /api/organisations { workspaceMode }. Renames
  // stay served either way.
  "workspace_mode_change",
  // App-sent invitation email (plan P06-6): creating an invitation emails
  // the link, each invitation shows whether it went out, and owners and
  // admins can resend. Off, an invitation is a link to copy, as before.
  "invitation_email",
  // S3: review topics (lib/server/review-topics-job.ts). Off: no review of
  // the organisation is sent for classification, the Reports panel and the
  // Inbox Topic filter are not shown, and no topic alert is raised.
  "review_topics",
] as const

export type OrgFeature = (typeof ORG_FEATURES)[number]
