import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

const proposalSchema = z.object({
  id: z.string(),
  resourceType: z.enum(["profile", "food_menus"]),
  identityKey: z.string(),
  kind: z.enum([
    "field_changed",
    "item_changed",
    "item_added_on_google",
    "item_missing_from_google",
    "section_added_on_google",
    "section_missing_from_google",
    "structure_changed",
  ]),
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
  status: z.enum(["pending", "processing", "applied", "ignored", "failed", "superseded"]),
  decision: z.string().nullable(),
  failureCode: z.string().nullable(),
  pinnedCanonicalRevision: z.string(),
  raisedVia: z.enum(["sweep", "manual"]),
  observedAt: z.string(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
})

export type ImportProposal = z.infer<typeof proposalSchema>

const listSchema = z.object({
  proposals: z.array(proposalSchema),
  counts: z.object({
    pending: z.number(),
    profile: z.number(),
    foodMenus: z.number(),
  }),
  importReviewEnabled: z.boolean(),
})

export type ImportReviewList = z.infer<typeof listSchema>

export function fetchImportReview(
  id: string,
  resourceType?: "profile" | "food_menus",
  options?: RequestOptions
): Promise<ImportReviewList> {
  const query = resourceType ? `?resourceType=${resourceType}` : ""
  return apiFetch(`/api/locations/${id}/import-review${query}`, {
    schema: listSchema,
    ...options,
  })
}

export function refreshImportReview(
  id: string,
  resourceType: "profile" | "food_menus" | "all" = "all"
) {
  return apiFetch(`/api/locations/${id}/import-review/refresh`, {
    method: "POST",
    body: { resourceType },
    schema: z.object({ refreshed: z.literal(true) }).loose(),
  })
}

export type DecideProposalInput = {
  action: "apply" | "ignore" | "delete_local" | "keep_local"
  resourceType: "profile" | "food_menus"
  expectedCanonicalRevision: string
  confirmOverwriteCanonicalChanges?: boolean
}

export function decideImportProposal(
  id: string,
  proposalId: string,
  input: DecideProposalInput
) {
  return apiFetch(`/api/locations/${id}/import-review/${proposalId}/decision`, {
    method: "POST",
    body: {
      action: input.action,
      confirmation:
        input.resourceType === "profile"
          ? "import_google_profile_to_nabapresence"
          : "import_google_food_menus_to_nabapresence",
      expectedCanonicalRevision: input.expectedCanonicalRevision,
      confirmOverwriteCanonicalChanges:
        input.confirmOverwriteCanonicalChanges ?? false,
    },
    schema: z.object({
      proposal: proposalSchema,
      canonicalRevision: z.string().nullable(),
    }),
  })
}

const countsSchema = z.object({
  counts: z.array(
    z.object({
      locationId: z.string(),
      resourceType: z.enum(["profile", "food_menus"]),
      pending: z.number(),
    })
  ),
})

export function fetchImportReviewCounts(options?: RequestOptions) {
  return apiFetch("/api/import-review/counts", { schema: countsSchema, ...options })
}
