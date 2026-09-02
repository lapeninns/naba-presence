// Client-safe import-review vocabulary: proposal resource types, kinds,
// statuses, decision actions and menu match statuses. Re-exported by
// lib/domain/import-review.ts. See lib/domain/README.md.

export const PROPOSAL_RESOURCE_TYPES = ["profile", "food_menus"] as const
export type ProposalResourceType = (typeof PROPOSAL_RESOURCE_TYPES)[number]

export const PROPOSAL_KINDS = [
  "field_changed",
  "item_changed",
  "item_added_on_google",
  "item_missing_from_google",
  "section_added_on_google",
  "section_missing_from_google",
  "structure_changed",
] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

export const PROPOSAL_STATUSES = [
  "pending",
  "processing",
  "applied",
  "ignored",
  "failed",
  "superseded",
] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export const PROPOSAL_DECISION_ACTIONS = [
  "apply",
  "ignore",
  "delete_local",
  "keep_local",
] as const
export type ProposalDecisionAction =
  (typeof PROPOSAL_DECISION_ACTIONS)[number]

export const MATCH_STATUSES = [
  "previous_identity",
  "label_price",
  "label_unique",
  "unmatched",
] as const
export type MenuMatchStatus = (typeof MATCH_STATUSES)[number]
