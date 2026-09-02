/**
 * Wire contract for `/api/locations/[id]/import-review/**` and
 * GET `/api/import-review/counts`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports, and only the
 * client-safe `lib/domain/import-review-vocabulary` module from the domain
 * (see lib/domain/README.md). Shared by the routes (query/body schemas,
 * response types), `lib/api/location-import-review.ts` (response schemas) and
 * `lib/server/import-review.ts` (the proposal projection types).
 */
import { z } from "zod"

import {
  PROPOSAL_DECISION_ACTIONS,
  PROPOSAL_KINDS,
  PROPOSAL_RESOURCE_TYPES,
  PROPOSAL_STATUSES,
  type ProposalResourceType,
} from "@/lib/domain/import-review-vocabulary"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export {
  PROPOSAL_DECISION_ACTIONS,
  PROPOSAL_KINDS,
  PROPOSAL_RESOURCE_TYPES,
  PROPOSAL_STATUSES,
  type ProposalDecisionAction,
  type ProposalKind,
  type ProposalResourceType,
  type ProposalStatus,
} from "@/lib/domain/import-review-vocabulary"

/** How a proposal was raised: the presence-resources sweep or a manual refresh. */
export const RAISE_TRIGGERS = ["sweep", "manual"] as const
export type RaiseTrigger = (typeof RAISE_TRIGGERS)[number]

export const IMPORT_REVIEW_REFRESH_SCOPES = [
  "profile",
  "food_menus",
  "all",
] as const
export type ImportReviewRefreshScope =
  (typeof IMPORT_REVIEW_REFRESH_SCOPES)[number]

export const IMPORT_CONFIRMATIONS = [
  "import_google_profile_to_nabapresence",
  "import_google_food_menus_to_nabapresence",
] as const
export type ImportConfirmation = (typeof IMPORT_CONFIRMATIONS)[number]

/**
 * The confirmation literal a decision must carry for a proposal's surface.
 * Used by the client to build the body and by the route to cross-check it.
 */
export function importConfirmationFor(
  resourceType: ProposalResourceType
): ImportConfirmation {
  return resourceType === "profile"
    ? "import_google_profile_to_nabapresence"
    : "import_google_food_menus_to_nabapresence"
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** GET `/import-review` query. */
export const importReviewListQuerySchema = z.object({
  resourceType: z.enum(PROPOSAL_RESOURCE_TYPES).optional(),
  status: z.enum(["pending", "decided"]).default("pending"),
})
export type ImportReviewListQuery = z.infer<typeof importReviewListQuerySchema>

/** POST `/import-review/refresh` body. */
export const importReviewRefreshRequestSchema = z.object({
  resourceType: z.enum(IMPORT_REVIEW_REFRESH_SCOPES).default("all"),
})
export type ImportReviewRefreshRequest = z.infer<
  typeof importReviewRefreshRequestSchema
>

/** POST `/import-review/[proposalId]/decision` body. */
export const importReviewDecisionRequestSchema = z.object({
  action: z.enum(PROPOSAL_DECISION_ACTIONS),
  confirmation: z.enum(IMPORT_CONFIRMATIONS),
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  confirmOverwriteCanonicalChanges: z.boolean().default(false),
})
export type ImportReviewDecisionRequest = z.infer<
  typeof importReviewDecisionRequestSchema
>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** One `presence_import_proposal` row as the review panel sees it. */
export const importProposalSchema = z.object({
  id: z.string(),
  resourceType: z.enum(PROPOSAL_RESOURCE_TYPES),
  identityKey: z.string(),
  kind: z.enum(PROPOSAL_KINDS),
  fieldKey: z.string().nullable(),
  googlePath: z.string().nullable(),
  sectionLabel: z.string().nullable(),
  itemLabel: z.string().nullable(),
  matchStatus: z.string().nullable(),
  matchConfidence: z.number().nullable(),
  canonicalValue: z.unknown(),
  googleValue: z.unknown(),
  suggestedPatch: z.unknown(),
  warnings: z.array(z.string()),
  status: z.enum(PROPOSAL_STATUSES),
  decision: z.string().nullable(),
  failureCode: z.string().nullable(),
  pinnedCanonicalRevision: z.string(),
  raisedVia: z.enum(RAISE_TRIGGERS),
  observedAt: z.string(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type ImportProposal = z.infer<typeof importProposalSchema>

/** Pending counts for one location, overall and per surface. */
export const importReviewCountsSchema = z.object({
  pending: z.number(),
  profile: z.number(),
  foodMenus: z.number(),
})
export type ImportReviewCounts = z.infer<typeof importReviewCountsSchema>

export const importReviewListResponseSchema = z.object({
  proposals: z.array(importProposalSchema),
  counts: importReviewCountsSchema,
  importReviewEnabled: z.boolean(),
})
export type ImportReviewListResponse = z.infer<
  typeof importReviewListResponseSchema
>

/** Outcome of one raise pass (sweep or manual refresh) for one surface. */
export const raiseOutcomeSchema = z.object({
  raised: z.number(),
  superseded: z.number(),
  skipped: z
    .enum(["disabled", "not_eligible", "core_dirty", "in_sync"])
    .nullable(),
})
export type RaiseOutcome = z.infer<typeof raiseOutcomeSchema>

export const importReviewRefreshResponseSchema = z.object({
  refreshed: z.literal(true),
  outcomes: z.object({
    profile: raiseOutcomeSchema.optional(),
    foodMenus: raiseOutcomeSchema.optional(),
  }),
})
export type ImportReviewRefreshResponse = z.infer<
  typeof importReviewRefreshResponseSchema
>

export const importReviewDecisionResponseSchema = z.object({
  proposal: importProposalSchema,
  canonicalRevision: z.string().nullable(),
})
export type ImportReviewDecisionResponse = z.infer<
  typeof importReviewDecisionResponseSchema
>

/** One row of GET `/api/import-review/counts`: pending proposals per surface. */
export const pendingProposalCountSchema = z.object({
  locationId: z.string(),
  resourceType: z.enum(PROPOSAL_RESOURCE_TYPES),
  pending: z.number(),
})
export type PendingProposalCount = z.infer<typeof pendingProposalCountSchema>

export const importReviewCountsResponseSchema = z.object({
  counts: z.array(pendingProposalCountSchema),
})
export type ImportReviewCountsResponse = z.infer<
  typeof importReviewCountsResponseSchema
>
