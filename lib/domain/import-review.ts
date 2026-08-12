import { z } from "zod"

import {
  PROFILE_FIELD_KEYS,
  classifyProfileField,
  type ProfileDriftStatus,
} from "@/lib/domain/profile"

// Drift classification is shared with the profile surface; re-exported here so
// import-review consumers have a single import site.
export { classifyProfileField as classifyResourceDrift }
export type { ProfileDriftStatus }

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

// Stored suggested_patch payloads are re-parsed defensively at decision time.
// Never trust what an earlier version of the code wrote into the database.
const menuNodeSchema = z.record(z.string(), z.unknown())

export const profileFieldPatchSchema = z.object({
  op: z.literal("set_field"),
  fieldKey: z.enum(PROFILE_FIELD_KEYS),
  value: z.string().nullable(),
})

export const menuMergePatchSchema = z.object({
  op: z.literal("merge_item"),
  localPath: z.string().min(1),
  sectionLabel: z.string(),
  itemLabel: z.string(),
  fields: menuNodeSchema,
})

export const menuInsertPatchSchema = z.object({
  op: z.literal("insert_item"),
  sectionLabel: z.string(),
  node: menuNodeSchema,
})

export const menuRemovePatchSchema = z.object({
  op: z.literal("remove_item"),
  localPath: z.string().min(1),
  sectionLabel: z.string(),
  itemLabel: z.string(),
})

export const menuInsertSectionPatchSchema = z.object({
  op: z.literal("insert_section"),
  sectionLabel: z.string(),
  node: menuNodeSchema,
})

export const menuRemoveSectionPatchSchema = z.object({
  op: z.literal("remove_section"),
  localPath: z.string().min(1),
  sectionLabel: z.string(),
})

export const menuReplaceAllPatchSchema = z.object({
  op: z.literal("replace_all"),
  menus: z.array(menuNodeSchema),
})

export const suggestedPatchSchema = z.discriminatedUnion("op", [
  profileFieldPatchSchema,
  menuMergePatchSchema,
  menuInsertPatchSchema,
  menuRemovePatchSchema,
  menuInsertSectionPatchSchema,
  menuRemoveSectionPatchSchema,
  menuReplaceAllPatchSchema,
])

export type SuggestedPatch = z.infer<typeof suggestedPatchSchema>
export type ProfileFieldPatch = z.infer<typeof profileFieldPatchSchema>
export type MenuPatch = Exclude<SuggestedPatch, ProfileFieldPatch>

export class ProposalDecisionError extends Error {
  readonly code:
    | "proposal_not_pending"
    | "proposal_action_unsupported"
    | "proposal_patch_invalid"

  constructor(code: ProposalDecisionError["code"], message: string) {
    super(message)
    this.code = code
  }
}

export type DecisionPlan =
  | { type: "apply_profile_field"; patch: ProfileFieldPatch }
  | { type: "apply_menu_patch"; patch: MenuPatch }
  | { type: "delete_local_item"; patch: MenuPatch }
  | { type: "mark_only"; terminal: "ignored" }

export type ProposalForDecision = {
  status: ProposalStatus
  kind: ProposalKind
  resourceType: ProposalResourceType
  suggestedPatch: unknown
}

function parsePatch(value: unknown): SuggestedPatch {
  const parsed = suggestedPatchSchema.safeParse(value)
  if (!parsed.success) {
    throw new ProposalDecisionError(
      "proposal_patch_invalid",
      "The stored suggestion payload is no longer valid."
    )
  }
  return parsed.data
}

/**
 * Pure decision planner: action x kind x status -> plan or named error. All
 * compatibility rules live here so the matrix is unit-testable without a
 * database; the service layer only executes the returned plan.
 */
export function planDecision(input: {
  action: ProposalDecisionAction
  row: ProposalForDecision
}): DecisionPlan {
  const { action, row } = input
  if (row.status !== "processing") {
    throw new ProposalDecisionError(
      "proposal_not_pending",
      "This suggestion has already been decided."
    )
  }
  if (action === "ignore") {
    return { type: "mark_only", terminal: "ignored" }
  }
  if (action === "keep_local") {
    if (
      row.kind !== "item_missing_from_google" &&
      row.kind !== "section_missing_from_google"
    ) {
      throw new ProposalDecisionError(
        "proposal_action_unsupported",
        "Keep is only available for items that are missing on Google."
      )
    }
    return { type: "mark_only", terminal: "ignored" }
  }
  if (action === "delete_local") {
    if (
      row.kind !== "item_missing_from_google" &&
      row.kind !== "section_missing_from_google"
    ) {
      throw new ProposalDecisionError(
        "proposal_action_unsupported",
        "Remove is only available for items that are missing on Google."
      )
    }
    const patch = parsePatch(row.suggestedPatch)
    if (patch.op !== "remove_item" && patch.op !== "remove_section") {
      throw new ProposalDecisionError(
        "proposal_patch_invalid",
        "The stored suggestion payload does not support removal."
      )
    }
    return { type: "delete_local_item", patch }
  }
  // action === "apply"
  if (row.kind === "item_missing_from_google" || row.kind === "section_missing_from_google") {
    throw new ProposalDecisionError(
      "proposal_action_unsupported",
      "Apply is not available for items that are missing on Google. Choose keep or remove."
    )
  }
  const patch = parsePatch(row.suggestedPatch)
  if (row.resourceType === "profile") {
    if (patch.op !== "set_field" || row.kind !== "field_changed") {
      throw new ProposalDecisionError(
        "proposal_patch_invalid",
        "The stored suggestion payload does not match this field."
      )
    }
    return { type: "apply_profile_field", patch }
  }
  if (
    patch.op === "set_field" ||
    patch.op === "remove_item" ||
    patch.op === "remove_section"
  ) {
    throw new ProposalDecisionError(
      "proposal_patch_invalid",
      "The stored suggestion payload does not match this menu change."
    )
  }
  return { type: "apply_menu_patch", patch }
}
