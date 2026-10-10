/**
 * Known per-organisation product flags (organisation_feature, migration
 * 0071). Dependency-free so scripts/ops-pause.mjs can import it through
 * Node's type stripping and refuse a name nothing reads: the table accepts
 * any snake_case name, so a slice adding a feature adds it here only.
 */
export const ORG_FEATURES = [
  // One-time scheduled posts (plan P08).
  "post_scheduling",
  // Bulk listing and review actions (plan P09).
  "bulk_actions",
  // Two-person approval of direct listing writes (plan P02-S2b): with the
  // organisation's require_two_person_approval on, a publisher's listing
  // write parks as a change request for a second publisher to approve
  // (lib/server/listing-changes.ts).
  "listing_change_approvals",
] as const

export type OrgFeature = (typeof ORG_FEATURES)[number]
