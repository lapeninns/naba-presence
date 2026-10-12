import "server-only"

import type { TransactionSql } from "postgres"

import { googleAttributesMatch } from "@/lib/domain/google-attributes"
import {
  placeActionApplied,
  placeActionState,
  type PlaceActionPlan,
} from "@/lib/domain/bulk-place-actions"
import type { BulkOperationInput } from "@/lib/domain/bulk-merge"
import {
  businessInfoApplied,
  categoryIds,
  sameCategories,
  type BulkBusinessInfoChange,
  type CategoryIds,
} from "@/lib/domain/bulk-business-info"
import {
  lodgingApplied,
  type BulkLodgingInput,
} from "@/lib/domain/bulk-lodging"
import {
  outcomeOfAnsweredWrite,
  outcomeOfThrownWrite,
} from "@/lib/server/bulk-families/shared"
import type {
  DispatchContext,
  DispatchOutcome,
} from "@/lib/server/bulk-families/types"
import { jsonColumn } from "@/lib/server/db"
import type { GbpWriteSurface } from "@/lib/server/env"
import {
  attemptStore,
  idempotencyKey,
  runGbpWrite,
  type AttemptStore,
} from "@/lib/server/gbp-write"
import { stableGoogleHash } from "@/lib/server/gbp-management"
import {
  getGoogleLocation,
  getGoogleLocationAttributes,
  googleLodgingApi,
  listGooglePlaceActionLinks,
} from "@/lib/server/google"
import {
  storeSettle,
  type RecoveryAdapter,
  type RecoveryAttempt,
} from "@/lib/server/mutation-recovery"

/**
 * Attempts of the bulk families whose editors record no receipts
 * (attributes, action links, business information, categories and lodging
 * run reviewed change sets): one row per child write, keyed per child and
 * payload, behind runGbpWrite.
 */
export const bulkWriteAttempts: AttemptStore = attemptStore({
  table: "bulk_listing_write_attempt",
  columns: {
    responseHash: "provider_response_hash",
    startedAt: "started_at",
  },
})

/** What the readback of an attribute write must find. */
export type AttributesIntended = {
  attributes: Array<Record<string, unknown>>
  attributeMask: string[]
}
/** What the readback of an action-link write must find. */
export type PlaceActionIntended = {
  placeActionType: string
  plan: PlaceActionPlan
  /** The link names of the type before the write: a create is a new name. */
  priorNames: string[]
}

/** What the readback of a business-information write must find. */
export type BusinessInfoIntended = { changes: BulkBusinessInfoChange[] }
/** What the readback of a category write must find. */
export type CategoriesIntended = { categories: CategoryIds }
/** What the readback of a lodging write must find (the stamp is not compared). */
export type LodgingIntended = Pick<
  BulkLodgingInput,
  "updateMask" | "clear" | "payload"
>

export type BulkWriteFamily =
  "attributes" | "place_action" | "business_info" | "categories" | "lodging"
type Intended =
  | AttributesIntended
  | PlaceActionIntended
  | BusinessInfoIntended
  | CategoriesIntended
  | LodgingIntended

type BulkAttempt = RecoveryAttempt & {
  externalLocationId: string | null
  googleLocationName: string
  family: BulkWriteFamily
  intended: Intended
}

/** The location fields a business-information or category readback compares. */
export const BUSINESS_LOCATION_FIELDS = [
  "websiteUri",
  "profile",
  "labels",
  "openInfo",
  "categories",
  "storefrontAddress",
  "serviceArea",
  "languageCode",
] as const

/** Whether a location shows a business-information or category write. */
export function locationWriteApplied(
  family: "business_info" | "categories",
  intended: BusinessInfoIntended | CategoriesIntended,
  location: unknown
) {
  return family === "categories"
    ? sameCategories(
        categoryIds(location),
        (intended as CategoriesIntended).categories
      )
    : businessInfoApplied(location, (intended as BusinessInfoIntended).changes)
}

async function loadAttempt(
  sql: Parameters<RecoveryAdapter<BulkAttempt>["load"]>[0],
  attemptId: string
) {
  const [row] = await sql<BulkAttempt[]>`
    select id::text as id, status as "rawStatus", started_at as "startedAt",
      provider_error_code as "errorCode", external_location_id::text as "externalLocationId",
      google_location_name as "googleLocationName", family, intended
    from bulk_listing_write_attempt
    where id = ${attemptId}`
  return row ?? null
}

/** The write went to a Google location the link no longer points at. */
const moved = (
  attempt: BulkAttempt,
  link: { externalLocationId: string; googleLocationName: string }
) =>
  attempt.externalLocationId !== link.externalLocationId ||
  attempt.googleLocationName !== link.googleLocationName

/**
 * Reads an uncertain bulk attribute write back with the same comparison its
 * dispatch used (`googleAttributesMatch`: an omitted masked name is a clear,
 * `[false]` is an answer).
 */
export const bulkAttributesRecoveryAdapter: RecoveryAdapter<BulkAttempt> = {
  surface: "attributes",
  attemptTable: "bulk_listing_write_attempt",
  load: loadAttempt,
  async readback({ attempt, link }) {
    if (moved(attempt, link))
      return { kind: "unverifiable", errorCode: "target_changed" }
    const intended = attempt.intended as AttributesIntended
    const observed = await getGoogleLocationAttributes(
      await link.accessToken(),
      link.googleLocationName,
      { connectionKey: link.googleConnectionId }
    )
    return googleAttributesMatch(
      observed,
      intended.attributes,
      intended.attributeMask
    )
      ? {
          kind: "landed",
          confirmed: true,
          responseHash: stableGoogleHash(observed),
        }
      : { kind: "not_landed", errorCode: "google_readback_mismatch" }
  },
  settle: storeSettle(bulkWriteAttempts),
}

/**
 * Reads an uncertain bulk action-link write back by stable identity: an
 * update or delete by the link's Google name, a create as a new link name
 * of the type carrying the intended link.
 */
export const bulkPlaceActionRecoveryAdapter: RecoveryAdapter<BulkAttempt> = {
  surface: "place_actions",
  attemptTable: "bulk_listing_write_attempt",
  load: loadAttempt,
  async readback({ attempt, link }) {
    if (moved(attempt, link))
      return { kind: "unverifiable", errorCode: "target_changed" }
    const intended = attempt.intended as PlaceActionIntended
    const collection = await listGooglePlaceActionLinks(
      await link.accessToken(),
      link.googleLocationName,
      { connectionKey: link.googleConnectionId }
    )
    const links = placeActionState(collection.links, intended.placeActionType)
    return placeActionApplied(links, intended.plan, intended.priorNames)
      ? {
          kind: "landed",
          confirmed: true,
          responseHash: stableGoogleHash(links),
        }
      : { kind: "not_landed", errorCode: "google_readback_mismatch" }
  },
  settle: storeSettle(bulkWriteAttempts),
}

/**
 * Reads an uncertain bulk business-information or category write back
 * field by field: only the fields the change named (a clear is an empty
 * field), or the categories by stable ID.
 */
export const bulkBusinessInfoRecoveryAdapter: RecoveryAdapter<BulkAttempt> = {
  surface: "business_info",
  attemptTable: "bulk_listing_write_attempt",
  load: loadAttempt,
  async readback({ attempt, link }) {
    if (moved(attempt, link))
      return { kind: "unverifiable", errorCode: "target_changed" }
    if (attempt.family !== "business_info" && attempt.family !== "categories")
      return { kind: "unverifiable", errorCode: "family_mismatch" }
    const observed = await getGoogleLocation(
      await link.accessToken(),
      link.googleLocationName,
      [...BUSINESS_LOCATION_FIELDS],
      { connectionKey: link.googleConnectionId }
    )
    return locationWriteApplied(
      attempt.family,
      attempt.intended as BusinessInfoIntended | CategoriesIntended,
      observed
    )
      ? {
          kind: "landed",
          confirmed: true,
          responseHash: stableGoogleHash(observed),
        }
      : { kind: "not_landed", errorCode: "google_readback_mismatch" }
  },
  settle: storeSettle(bulkWriteAttempts),
}

/**
 * Reads an uncertain bulk lodging write back over its mask: a cleared path
 * holds nothing, a set path its value (`false` is a value).
 */
export const bulkLodgingRecoveryAdapter: RecoveryAdapter<BulkAttempt> = {
  surface: "lodging",
  attemptTable: "bulk_listing_write_attempt",
  load: loadAttempt,
  async readback({ attempt, link }) {
    if (moved(attempt, link))
      return { kind: "unverifiable", errorCode: "target_changed" }
    const observed = await googleLodgingApi(
      await link.accessToken(),
      { locationName: link.googleLocationName, operation: "get" },
      { connectionKey: link.googleConnectionId }
    )
    return lodgingApplied(observed, attempt.intended as LodgingIntended)
      ? {
          kind: "landed",
          confirmed: true,
          responseHash: stableGoogleHash(observed),
        }
      : { kind: "not_landed", errorCode: "google_readback_mismatch" }
  },
  settle: storeSettle(bulkWriteAttempts),
}

/**
 * One bulk attribute, action-link, business-information, category or
 * lodging write through runGbpWrite: the attempt
 * row and the receipt (under the child's intent) are recorded before the
 * provider call, the result is read back, and an uncertain write is left to
 * `mutation_recover` with the adapters above. The key is per child and
 * payload, so a later claim of the same child finds an uncertain earlier
 * write and reads it back before sending again.
 */
export async function runBulkWrite<TResponse, TReadback>(
  context: DispatchContext<BulkOperationInput>,
  spec: {
    family: BulkWriteFamily
    surface: "attributes" | "place_actions" | "business_info" | "lodging"
    action: string
    writeSurface: GbpWriteSurface
    intended: Intended
    /** Google's validateOnly call, when the surface has one; a refusal settles failed. */
    validate?: () => Promise<unknown>
    mutate: () => Promise<TResponse>
    read: () => Promise<TReadback>
    verify: (readback: TReadback) => boolean
  }
): Promise<DispatchOutcome> {
  const payloadHash = stableGoogleHash(spec.intended)
  try {
    const result = await runGbpWrite<TResponse, TReadback>({
      surface: spec.writeSurface,
      organisationId: context.organisationId,
      actorUserId: context.session.userId,
      requestId: context.requestId,
      store: bulkWriteAttempts,
      key: idempotencyKey([
        context.organisationId,
        context.childId,
        `bulk_${spec.family}`,
        payloadHash,
      ]),
      intent: {
        child_id: context.childId,
        location_id: context.locationId,
        family: spec.family,
        external_location_id: context.linked.externalLocationId,
        google_location_name: context.linked.googleLocationName,
        intended: (sql: TransactionSql) => jsonColumn(sql, spec.intended),
      },
      inProgress: {
        code: "bulk_write_in_progress",
        message: "This listing's change is already being sent.",
      },
      failureCode: "google_bulk_write_failed",
      intentId: context.intentId,
      operation: {
        surface: spec.surface,
        action: spec.action,
        locationId: context.locationId,
        targetType: "location",
        targetRef: context.linked.googleLocationName,
        payloadHash,
        googleConnectionId: context.linked.connectionId,
        approvalRef: context.approvalRef,
      },
      ...(spec.validate ? { validate: spec.validate } : {}),
      mutate: spec.mutate,
      onAmbiguous: "readback",
      readback: {
        read: spec.read,
        verify: ({ readback }) => spec.verify(readback),
        hash: (readback) => stableGoogleHash(readback),
      },
      audit: (success) => ({
        action: "bulk_listing.child_applied",
        subjectType: "bulk_listing_child",
        subjectId: context.childId,
        metadata: {
          operationId: context.operationId,
          family: spec.family,
          attemptId: success.attemptId,
        },
      }),
    })
    return outcomeOfAnsweredWrite(result.outcome)
  } catch (error) {
    return outcomeOfThrownWrite(context.organisationId, context.intentId, error)
  }
}
