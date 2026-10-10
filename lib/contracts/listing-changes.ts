/**
 * Listing change requests: two-person approval for direct listing writes
 * (plan P02-S2b, lib/server/listing-changes.ts).
 *
 * With the organisation's two-person policy on and its
 * `listing_change_approvals` feature switched on, a publisher's write to
 * Google from a listing editor is not sent. The route answers 202 with the
 * frozen request (`listingChangeParkedResponseSchema`), and a different
 * publisher approves or rejects that exact request through
 * `POST /api/locations/{id}/change-requests/{changeId}`.
 *
 * Client-safe: no `server-only`, no `lib/server` imports.
 */
import { z } from "zod"

import {
  operationOutcomeSchema,
  operationSummarySchema,
} from "@/lib/contracts/mutation-operations"

/** Every listing write that parks for approval in two-person mode. */
export const LISTING_CHANGE_KINDS = [
  "hours_publish",
  "profile_publish",
  "business_information_update",
  "business_attributes_update",
  "industry_update",
  "food_menus_publish",
  "media_create",
  "media_update",
  "media_delete",
  "place_action_create",
  "place_action_update",
  "place_action_delete",
] as const

export const listingChangeKindSchema = z.enum(LISTING_CHANGE_KINDS)
export type ListingChangeKind = z.infer<typeof listingChangeKindSchema>

/** The editor a change request belongs to, for the panel each editor shows. */
export const LISTING_CHANGE_EDITORS = [
  "hours",
  "profile",
  "menus",
  "photos",
  "booking",
] as const
export type ListingChangeEditor = (typeof LISTING_CHANGE_EDITORS)[number]

export const LISTING_CHANGE_EDITOR: Record<
  ListingChangeKind,
  ListingChangeEditor
> = {
  hours_publish: "hours",
  profile_publish: "profile",
  business_information_update: "profile",
  business_attributes_update: "profile",
  industry_update: "profile",
  food_menus_publish: "menus",
  media_create: "photos",
  media_update: "photos",
  media_delete: "photos",
  place_action_create: "booking",
  place_action_update: "booking",
  place_action_delete: "booking",
}

/** What the approver is asked about, in sentence case. */
export const LISTING_CHANGE_LABEL: Record<ListingChangeKind, string> = {
  hours_publish: "Publish opening hours",
  profile_publish: "Publish profile fields",
  business_information_update: "Update business information",
  business_attributes_update: "Update attributes",
  industry_update: "Update industry details",
  food_menus_publish: "Publish food menus",
  media_create: "Add a photo or video",
  media_update: "Change a photo's category",
  media_delete: "Delete a photo or video",
  place_action_create: "Add a booking link",
  place_action_update: "Change a booking link",
  place_action_delete: "Delete a booking link",
}

/**
 * The error code the API client raises for a 202 that parked a write
 * (lib/api/client.ts), so every editor's error path can tell "sent for
 * approval" from a failure.
 */
export const LISTING_CHANGE_AWAITING_APPROVAL =
  "listing_change_awaiting_approval"

/**
 * One value the approver reads before deciding: a content field of the
 * frozen request, or what its target (a photo, a booking link) holds now
 * (lib/domain/listing-change-details.ts).
 */
export const listingChangeDetailSchema = z.object({
  label: z.string(),
  value: z.string(),
})
export type ListingChangeDetail = z.infer<typeof listingChangeDetailSchema>

export const listingChangeRequestSchema = z.object({
  /** The receipt id: GET /api/mutations/{id} answers for it too. */
  id: z.string(),
  intentId: z.string(),
  kind: listingChangeKindSchema,
  label: z.string(),
  locationId: z.string().nullable(),
  /** The media item or booking link the change is about, if any. */
  target: z.string().nullable(),
  /** The fields the change writes. */
  fieldMask: z.array(z.string()),
  /**
   * Every value the request sends, derived from the same stored body the
   * payload hash covers, so the approver approves what they read.
   */
  details: z.array(listingChangeDetailSchema),
  /** What an approval must name: sha256 of the frozen request. */
  payloadHash: z.string(),
  outcome: operationOutcomeSchema,
  errorCode: z.string().nullable(),
  author: z.object({ id: z.string().nullable(), name: z.string().nullable() }),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** True when the viewer wrote this request. */
  isOwn: z.boolean(),
  /** True when the viewer may approve it: a publisher who did not write it. */
  canDecide: z.boolean(),
})
export type ListingChangeRequest = z.infer<typeof listingChangeRequestSchema>

/** `GET /api/locations/{id}/change-requests`: the pending requests. */
export const listingChangeListResponseSchema = z.object({
  changeRequests: z.array(listingChangeRequestSchema),
})
export type ListingChangeListResponse = z.infer<
  typeof listingChangeListResponseSchema
>

/** The 202 a listing write route answers with when it parked the write. */
export const listingChangeParkedResponseSchema = z.object({
  status: z.literal("awaiting_approval"),
  changeRequest: listingChangeRequestSchema,
  operation: operationSummarySchema,
})
export type ListingChangeParkedResponse = z.infer<
  typeof listingChangeParkedResponseSchema
>

export const listingChangeDecisionBodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
  /** The `payloadHash` of the request the decider was shown. */
  payloadHash: z.string().min(16).max(128),
})
export type ListingChangeDecisionBody = z.infer<
  typeof listingChangeDecisionBodySchema
>

/**
 * The decision's answer: the change request as it now stands, and its
 * receipt. After an approval `operation.outcome` is the dispatch's outcome.
 */
export const listingChangeDecisionResponseSchema = z.object({
  changeRequest: listingChangeRequestSchema,
  operation: operationSummarySchema,
})
export type ListingChangeDecisionResponse = z.infer<
  typeof listingChangeDecisionResponseSchema
>

export const listingChangeParamsSchema = z.object({
  id: z.uuid(),
  changeId: z.uuid(),
})
