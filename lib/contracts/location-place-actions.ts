/**
 * Wire contract for `/api/locations/[id]/place-actions/**`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports. Shared by the
 * routes (request schemas), `lib/api/location-booking.ts` (response schemas)
 * and `lib/server/place-actions.ts` (row types).
 */
import { z } from "zod"

import { GOOGLE_PLACE_ACTION_TYPES } from "@/lib/domain/google-contract"

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** The editable fields of a Place Action link. */
export const placeActionInputSchema = z.object({
  uri: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "Place Action links must use http or https.",
    }),
  placeActionType: z.enum(GOOGLE_PLACE_ACTION_TYPES),
  isPreferred: z.boolean().default(false),
})
export type PlaceActionInput = z.infer<typeof placeActionInputSchema>

const expectedGoogleHash = z.string().length(64)

/** POST `/place-actions` body. */
export const placeActionCreateRequestSchema = placeActionInputSchema.extend({
  confirmation: z.literal("create_google_place_action"),
})
export type PlaceActionCreateRequest = z.infer<
  typeof placeActionCreateRequestSchema
>

/** PATCH `/place-actions/[linkId]` body. */
export const placeActionUpdateRequestSchema = placeActionInputSchema.extend({
  expectedGoogleHash,
  confirmation: z.literal("update_google_place_action"),
})
export type PlaceActionUpdateRequest = z.infer<
  typeof placeActionUpdateRequestSchema
>

/** DELETE `/place-actions/[linkId]` body. */
export const placeActionDeleteRequestSchema = z.object({
  expectedGoogleHash,
  confirmation: z.literal("delete_google_place_action"),
})
export type PlaceActionDeleteRequest = z.infer<
  typeof placeActionDeleteRequestSchema
>

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** One `place_action_link` row (`observedAt` as an ISO string). */
export const placeActionLinkSchema = z.object({
  id: z.string(),
  googleLinkName: z.string(),
  providerType: z.string(),
  isEditable: z.boolean(),
  uri: z.string(),
  placeActionType: z.string(),
  isPreferred: z.boolean(),
  googleHash: z.string(),
  observedAt: z.string(),
})
export type PlaceActionLink = z.infer<typeof placeActionLinkSchema>

/** The most recent `place_action_mutation` row for the location. */
export const placeActionMutationSummarySchema = z.object({
  id: z.string(),
  operation: z.string(),
  status: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type PlaceActionMutationSummary = z.infer<
  typeof placeActionMutationSummarySchema
>

export const placeActionsStateSchema = z.object({
  locationId: z.string(),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  supportedTypes: z.array(z.enum(GOOGLE_PLACE_ACTION_TYPES)).readonly(),
  links: z.array(placeActionLinkSchema),
  latestMutation: placeActionMutationSummarySchema.nullable(),
})
export type PlaceActionsState = z.infer<typeof placeActionsStateSchema>

/** GET `/place-actions`. */
export const placeActionsResponseSchema = z.object({
  placeActions: placeActionsStateSchema,
})
export type PlaceActionsResponse = z.infer<typeof placeActionsResponseSchema>

/** POST (201) / PATCH / DELETE outcome: the attempt row. */
export const placeActionMutationOutcomeSchema = z.object({
  id: z.string(),
  status: z.string(),
  idempotent: z.boolean(),
})
export type PlaceActionMutationOutcome = z.infer<
  typeof placeActionMutationOutcomeSchema
>
