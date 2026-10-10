import "server-only"

import { NextResponse } from "next/server"

import {
  businessInformationPatchSchema,
  type BusinessInformationPatchBody,
} from "@/lib/contracts/location-business-information"
import { publishFoodMenusSchema } from "@/lib/contracts/location-food-menus"
import { publishHoursBodySchema } from "@/lib/contracts/location-hours"
import {
  industryMutationSchema,
  type SupportedIndustryMutation,
} from "@/lib/contracts/location-industry"
import {
  mediaCreateRequestSchema,
  mediaDeleteRequestSchema,
  mediaUpdateRequestSchema,
} from "@/lib/contracts/location-media"
import {
  placeActionCreateRequestSchema,
  placeActionDeleteRequestSchema,
  placeActionUpdateRequestSchema,
} from "@/lib/contracts/location-place-actions"
import { profileOperationBodySchema } from "@/lib/contracts/location-profile"
import type {
  ListingChangeDecisionResponse,
  ListingChangeKind,
} from "@/lib/contracts/listing-changes"
import {
  updateBusinessAttributes,
  updateBusinessInformation,
} from "@/lib/server/business-information"
import { publishFoodMenus } from "@/lib/server/food-menus"
import { publishCanonicalHours } from "@/lib/server/hours"
import { ApiError } from "@/lib/server/http"
import { mutateIndustryManagement } from "@/lib/server/industry-management"
import {
  approveListingChange,
  parkListingChange,
  rejectListingChange,
  type ListingChangeDecision,
  type ListingChangeEntry,
  type ListingChangeSubmit,
} from "@/lib/server/listing-changes"
import { createMedia, removeMedia, updateMedia } from "@/lib/server/media"
import {
  createPlaceAction,
  removePlaceAction,
  updatePlaceAction,
} from "@/lib/server/place-actions"
import { publishProfileToGoogle } from "@/lib/server/profile"
import { withTenant } from "@/lib/server/db"

/**
 * Every listing write that parks for approval in two-person mode
 * (lib/server/listing-changes.ts), and the surface call that sends it. The
 * routes call `submitListingChange` instead of the surface function, so the
 * request a person makes and the request an approver later sends go through
 * the same code; an approval dispatches the frozen body through the same
 * entry.
 */

function entry<TBody, TResult>(
  definition: ListingChangeEntry<TBody, TResult>
): ListingChangeEntry<TBody, TResult> {
  return definition
}

function requireTarget(target: string | null): string {
  if (!target) {
    throw new ApiError(
      409,
      "change_request_invalid",
      "This change no longer names what it was about. Make it again."
    )
  }
  return target
}

type AttributesUpdate = Extract<
  BusinessInformationPatchBody,
  { operation: "update_attributes" }
>

export const LISTING_CHANGE_ENTRIES = {
  hours_publish: entry({
    kind: "hours_publish",
    surface: "hours",
    gbpSurface: "profileWrites",
    action: () => "publish",
    body: publishHoursBodySchema,
    fieldMask: (body) => [...body.approvedUpdateMask],
    expectedRevision: (body) => `canonical:${body.expectedCanonicalRevision}`,
    dispatch: ({ session, locationId, body, requestId }) =>
      publishCanonicalHours({
        session,
        locationId,
        expectedCanonicalRevision: body.expectedCanonicalRevision,
        expectedCanonicalHash: body.expectedCanonicalHash,
        expectedGoogleHash: body.expectedGoogleHash,
        approvedUpdateMask: body.approvedUpdateMask,
        confirmOverwriteGoogleChanges: body.confirmOverwriteGoogleChanges,
        selection: body.selection,
        requestId,
      }),
  }),
  profile_publish: entry({
    kind: "profile_publish",
    surface: "profile",
    gbpSurface: "profileWrites",
    action: () => "publish",
    body: profileOperationBodySchema,
    fieldMask: (body) => [...body.selectedFields],
    expectedRevision: (body) => `canonical:${body.expectedCanonicalRevision}`,
    dispatch: ({ session, locationId, body, requestId }) => {
      if (body.direction !== "to_google") {
        throw new ApiError(
          409,
          "change_request_invalid",
          "Only a publish to Google needs approval."
        )
      }
      return publishProfileToGoogle({
        session,
        locationId,
        selectedFields: body.selectedFields,
        expectedCanonicalRevision: body.expectedCanonicalRevision,
        expectedCanonicalHash: body.expectedCanonicalHash,
        expectedGoogleHash: body.expectedGoogleHash,
        confirmOverwriteGoogleChanges: body.confirmOverwriteGoogleChanges,
        requestId,
      })
    },
  }),
  business_information_update: entry({
    kind: "business_information_update",
    surface: "business_information",
    gbpSurface: "profileWrites",
    action: () => "update_location",
    body: businessInformationPatchSchema,
    fieldMask: (body) =>
      body.operation === "update_location" ? [...body.updateMask] : [],
    expectedRevision: (body) => `google:${body.expectedGoogleHash}`,
    dispatch: ({ session, locationId, body, requestId }) => {
      if (body.operation !== "update_location") {
        throw new ApiError(
          409,
          "change_request_invalid",
          "Make the change again."
        )
      }
      return updateBusinessInformation({
        session,
        locationId,
        payload: body.payload,
        updateMask: body.updateMask,
        expectedGoogleHash: body.expectedGoogleHash,
        requestId,
      })
    },
  }),
  business_attributes_update: entry({
    kind: "business_attributes_update",
    surface: "business_information",
    gbpSurface: "profileWrites",
    action: () => "update_attributes",
    body: businessInformationPatchSchema,
    fieldMask: (body) =>
      body.operation === "update_attributes"
        ? [...(body as AttributesUpdate).attributeMask]
        : [],
    expectedRevision: (body) => `google:${body.expectedGoogleHash}`,
    dispatch: ({ session, locationId, body, requestId }) => {
      if (body.operation !== "update_attributes") {
        throw new ApiError(
          409,
          "change_request_invalid",
          "Make the change again."
        )
      }
      return updateBusinessAttributes({
        session,
        locationId,
        attributes: body.attributes,
        attributeMask: body.attributeMask,
        expectedGoogleHash: body.expectedGoogleHash,
        requestId,
      })
    },
  }),
  industry_update: entry({
    kind: "industry_update",
    surface: "industry",
    gbpSurface: "profileWrites",
    action: (body) => body.operation,
    body: industryMutationSchema,
    fieldMask: (body) =>
      "updateMask" in body ? [...(body.updateMask as readonly string[])] : [],
    expectedRevision: (body) =>
      body.operation === "update_lodging"
        ? `google:${body.expectedGoogleHash}`
        : null,
    dispatch: ({ session, locationId, body, requestId }) => {
      if (
        body.operation !== "update_lodging" &&
        body.operation !== "update_healthcare_services"
      ) {
        throw new ApiError(
          409,
          "change_request_invalid",
          "Make the change again."
        )
      }
      const supported = body as SupportedIndustryMutation
      return mutateIndustryManagement({
        session,
        locationId,
        operation: supported.operation,
        payload: supported.payload as Record<string, unknown>,
        updateMask: [...supported.updateMask],
        expectedGoogleHash:
          supported.operation === "update_lodging"
            ? supported.expectedGoogleHash
            : undefined,
        requestId,
      })
    },
  }),
  food_menus_publish: entry({
    kind: "food_menus_publish",
    surface: "food_menus",
    gbpSurface: "foodMenus",
    action: () => "publish",
    body: publishFoodMenusSchema,
    fieldMask: () => ["foodMenus"],
    expectedRevision: (body) => `canonical:${body.expectedCanonicalRevision}`,
    dispatch: ({ session, locationId, body, requestId }) =>
      publishFoodMenus({
        session,
        locationId,
        expectedCanonicalRevision: body.expectedCanonicalRevision,
        expectedCanonicalHash: body.expectedCanonicalHash,
        expectedGoogleHash: body.expectedGoogleHash,
        confirmFullReplacement: body.confirmFullReplacement,
        requestId,
      }),
  }),
  media_create: entry({
    kind: "media_create",
    surface: "media",
    gbpSurface: "media",
    action: () => "create",
    body: mediaCreateRequestSchema,
    fieldMask: (body) => [
      "sourceUrl",
      "category",
      ...(body.description ? ["description"] : []),
    ],
    expectedRevision: () => null,
    dispatch: ({ session, locationId, body, requestId }) =>
      createMedia({
        organisationId: session.organisationId,
        session,
        locationId,
        payload: {
          mediaFormat: body.mediaFormat,
          category: body.category,
          sourceUrl: body.sourceUrl,
          description: body.description,
        },
        requestId,
      }),
  }),
  media_update: entry({
    kind: "media_update",
    surface: "media",
    gbpSurface: "media",
    action: () => "update",
    body: mediaUpdateRequestSchema,
    fieldMask: () => ["category"],
    expectedRevision: (body) => `google:${body.expectedGoogleHash}`,
    dispatch: ({ session, locationId, target, body, requestId }) =>
      updateMedia({
        organisationId: session.organisationId,
        session,
        locationId,
        mediaId: requireTarget(target),
        category: body.category,
        expectedGoogleHash: body.expectedGoogleHash,
        requestId,
      }),
  }),
  media_delete: entry({
    kind: "media_delete",
    surface: "media",
    gbpSurface: "media",
    action: () => "delete",
    body: mediaDeleteRequestSchema,
    fieldMask: () => ["media"],
    expectedRevision: (body) => `google:${body.expectedGoogleHash}`,
    dispatch: ({ session, locationId, target, body, requestId }) =>
      removeMedia({
        organisationId: session.organisationId,
        session,
        locationId,
        mediaId: requireTarget(target),
        expectedGoogleHash: body.expectedGoogleHash,
        requestId,
      }),
  }),
  place_action_create: entry({
    kind: "place_action_create",
    surface: "place_action",
    gbpSurface: "placeActions",
    action: () => "create",
    body: placeActionCreateRequestSchema,
    fieldMask: () => ["uri", "placeActionType", "isPreferred"],
    expectedRevision: () => null,
    dispatch: ({ session, locationId, body, requestId }) =>
      createPlaceAction({
        organisationId: session.organisationId,
        session,
        locationId,
        payload: {
          uri: body.uri,
          placeActionType: body.placeActionType,
          isPreferred: body.isPreferred,
        },
        requestId,
      }),
  }),
  place_action_update: entry({
    kind: "place_action_update",
    surface: "place_action",
    gbpSurface: "placeActions",
    action: () => "update",
    body: placeActionUpdateRequestSchema,
    fieldMask: () => ["uri", "placeActionType", "isPreferred"],
    expectedRevision: (body) => `google:${body.expectedGoogleHash}`,
    dispatch: ({ session, locationId, target, body, requestId }) =>
      updatePlaceAction({
        organisationId: session.organisationId,
        session,
        locationId,
        linkId: requireTarget(target),
        payload: {
          uri: body.uri,
          placeActionType: body.placeActionType,
          isPreferred: body.isPreferred,
        },
        expectedGoogleHash: body.expectedGoogleHash,
        requestId,
      }),
  }),
  place_action_delete: entry({
    kind: "place_action_delete",
    surface: "place_action",
    gbpSurface: "placeActions",
    action: () => "delete",
    body: placeActionDeleteRequestSchema,
    fieldMask: () => ["placeActionLink"],
    expectedRevision: (body) => `google:${body.expectedGoogleHash}`,
    dispatch: ({ session, locationId, target, body, requestId }) =>
      removePlaceAction({
        organisationId: session.organisationId,
        session,
        locationId,
        linkId: requireTarget(target),
        expectedGoogleHash: body.expectedGoogleHash,
        requestId,
      }),
  }),
} satisfies Record<ListingChangeKind, unknown>

type Entries = typeof LISTING_CHANGE_ENTRIES
type BodyOf<K extends ListingChangeKind> =
  Entries[K] extends ListingChangeEntry<infer B, unknown> ? B : never
type ResultOf<K extends ListingChangeKind> =
  Entries[K] extends ListingChangeEntry<never, infer R> ? R : never

function entryFor<K extends ListingChangeKind>(
  kind: K
): ListingChangeEntry<BodyOf<K>, ResultOf<K>> {
  return LISTING_CHANGE_ENTRIES[kind] as unknown as ListingChangeEntry<
    BodyOf<K>,
    ResultOf<K>
  >
}

/**
 * What a listing write route calls instead of the surface function: the
 * write parks (a 202 with the change request) when two-person approval
 * applies, and is sent exactly as before otherwise.
 */
export async function submitListingChange<K extends ListingChangeKind>(
  kind: K,
  input: ListingChangeSubmit<BodyOf<K>>
): Promise<ResultOf<K> | NextResponse> {
  const definition = entryFor(kind)
  const parked = await parkListingChange(definition, input)
  if (parked) return NextResponse.json(parked, { status: 202 })
  return definition.dispatch({ ...input, target: input.target ?? null })
}

/**
 * Approves (and dispatches) or rejects one change request. The kind is read
 * from the stored request, never from the caller.
 */
export async function decideListingChange(
  input: ListingChangeDecision
): Promise<ListingChangeDecisionResponse> {
  if (input.decision === "reject") {
    const { changeRequest } = await rejectListingChange(input)
    return {
      changeRequest,
      operation: {
        operationId: changeRequest.id,
        outcome: changeRequest.outcome,
      },
    }
  }
  const kind = await storedKind(input)
  const { changeRequest } = await approveListingChange(entryFor(kind), input)
  return {
    changeRequest,
    operation: {
      operationId: changeRequest.id,
      outcome: changeRequest.outcome,
    },
  }
}

async function storedKind(
  input: ListingChangeDecision
): Promise<ListingChangeKind> {
  const [row] = await withTenant(
    input.session.organisationId,
    (sql) =>
      sql<{ kind: string | null }[]>`
      select change_request ->> 'kind' as kind
      from mutation_operation
      where organisation_id = ${input.session.organisationId}
        and id = ${input.changeId}
        and change_request is not null
    `
  )
  const kind = row?.kind as ListingChangeKind | undefined
  if (!kind || !(kind in LISTING_CHANGE_ENTRIES)) {
    throw new ApiError(
      404,
      "change_request_not_found",
      "This change request was not found."
    )
  }
  return kind
}
