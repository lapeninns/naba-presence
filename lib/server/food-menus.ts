import "server-only"

import type { TransactionSql } from "postgres"

import type {
  FoodMenu,
  FoodMenusState,
  PublishFoodMenusResult,
  SaveFoodMenusResult,
} from "@/lib/contracts/location-food-menus"
import { foodMenuCounts, hashFoodMenus } from "@/lib/domain/food-menus"
import { googleFoodMenusName } from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import {
  ensureCanonicalResource,
  reconcileCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  attemptStore,
  idempotencyKey,
  loadLinkedLocation,
  requireGbpWrite,
  requirePublishGrant,
  runGbpWrite,
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import {
  getGoogleFoodMenus,
  getGoogleLocation,
  GoogleMutationAmbiguousError,
  patchGoogleFoodMenus,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

type Menus = FoodMenu[]

/**
 * food_menus_sync_attempt as an AttemptStore. Its CHECK constraint knows
 * validating/publishing/succeeded/failed/ambiguous; there is no validateOnly
 * phase for Food Menus, so `validated` is never written. A settled failure is
 * retried with a fresh row keyed `${key}:${requestId}` (the module's
 * historical behaviour). `started_at` (0036) is what lets an interrupted
 * publish be recovered by readback instead of blocking the same menu for the
 * 180 days its row is retained.
 */
const foodMenusAttempts = attemptStore({
  table: "food_menus_sync_attempt",
  columns: {
    errorCode: "last_error_code",
    response: "provider_response",
    startedAt: "started_at",
  },
  retry: "insert",
})

function linkedFoodMenusLocation(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    loadLinkedLocation(sql, session, locationId)
  )
}

function asMenus(value: unknown): Menus {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item))
      )
    : []
}

async function fetchGoogleFoodMenus(context: LinkedLocation, token: string) {
  const options = { connectionKey: context.googleConnectionId }
  const googleLocation = await getGoogleLocation(
    token,
    context.googleLocationName,
    ["metadata"],
    options
  )
  const metadata =
    googleLocation.metadata && typeof googleLocation.metadata === "object"
      ? (googleLocation.metadata as Record<string, unknown>)
      : {}
  const eligible = metadata.canHaveFoodMenus === true
  const name = googleFoodMenusName(
    context.googleAccountName,
    context.googleLocationName
  )
  const googleResource = eligible
    ? await getGoogleFoodMenus(token, name, options)
    : { name, menus: [] }
  return { eligible, name, googleMenus: asMenus(googleResource.menus) }
}

async function recordFoodMenusState(input: {
  session: Session
  locationId: string
  externalLocationId: string
  eligible: boolean
  canonicalRevision: string
  canonicalHash: string
  googleHash: string
  canonicalMenus: Menus
  googleMenus: Menus
}) {
  await withTenant(input.session.organisationId, async (sql) => {
    await sql`
      insert into food_menus_state (
        organisation_id, location_id, external_location_id, eligible,
        canonical_revision, canonical_hash, google_hash,
        canonical_payload, google_payload, observed_at, expires_at
      ) values (
        ${input.session.organisationId}, ${input.locationId}, ${input.externalLocationId}, ${input.eligible},
        ${input.canonicalRevision}, ${input.canonicalHash}, ${input.googleHash},
        ${jsonColumn(sql, input.canonicalMenus)},
        ${jsonColumn(sql, input.googleMenus)}, now(), now() + interval '30 days'
      ) on conflict (organisation_id, location_id) do update set
        eligible = excluded.eligible, canonical_revision = excluded.canonical_revision,
        canonical_hash = excluded.canonical_hash, google_hash = excluded.google_hash,
        canonical_payload = excluded.canonical_payload, google_payload = excluded.google_payload,
        observed_at = now(), expires_at = excluded.expires_at
    `
  })
}

export async function readLiveFoodMenus(session: Session, locationId: string) {
  const context = await linkedFoodMenusLocation(session, locationId)
  const token = await context.accessToken()
  const { eligible, name, googleMenus } = await fetchGoogleFoodMenus(
    context,
    token
  )
  const canonicalResource = await withTenant(session.organisationId, (sql) =>
    ensureCanonicalResource<Menus>({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "food_menus",
      initialPayload: googleMenus,
      actorUserId: session.userId,
    })
  )
  const canonicalMenus = asMenus(canonicalResource.payload)
  const canonicalHash = hashFoodMenus(canonicalMenus)
  const googleHash = hashFoodMenus(googleMenus)
  const env = getServerEnv()
  const state = {
    location: {
      id: context.locationId,
      name: context.locationName,
      googleLocationName: context.googleLocationName,
    },
    canonicalResource: {
      revision: canonicalResource.revision,
      updatedAt: canonicalResource.updatedAt.toISOString(),
    },
    eligible,
    status:
      canonicalHash === googleHash ? ("in_sync" as const) : ("drift" as const),
    canonicalMenus,
    googleMenus,
    canonicalHash,
    googleHash,
    canonicalCounts: foodMenuCounts(canonicalMenus),
    googleCounts: foodMenuCounts(googleMenus),
    canPublish: context.canPublish,
    writesEnabled: env.PUBLISH_ENABLED && env.GBP_FOOD_MENUS_ENABLED,
  } satisfies FoodMenusState
  await recordFoodMenusState({
    session,
    locationId,
    externalLocationId: context.externalLocationId,
    eligible,
    canonicalRevision: canonicalResource.revision,
    canonicalHash,
    googleHash,
    canonicalMenus,
    googleMenus,
  })
  return { state, context, token, name, canonicalResource }
}

export async function getFoodMenusState(session: Session, locationId: string) {
  return (await readLiveFoodMenus(session, locationId)).state
}

export async function saveCanonicalFoodMenus(input: {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  menus: Menus
  requestId: string
}): Promise<SaveFoodMenusResult> {
  const context = await linkedFoodMenusLocation(input.session, input.locationId)
  requirePublishGrant(context, {
    code: "canonical_edit_permission_required",
    message: "You cannot edit this location.",
  })
  const updated = await withTenant(
    input.session.organisationId,
    async (sql) => {
      const resource = await updateCanonicalResource({
        sql,
        organisationId: input.session.organisationId,
        locationId: input.locationId,
        resourceType: "food_menus",
        expectedRevision: input.expectedCanonicalRevision,
        payload: input.menus,
      })
      await writeAudit(sql, {
        organisationId: input.session.organisationId,
        actorUserId: input.session.userId,
        action: "food_menus.canonical.updated",
        subjectType: "location",
        subjectId: input.locationId,
        requestId: input.requestId,
        metadata: {
          revision: resource.revision,
          counts: foodMenuCounts(input.menus),
        },
      })
      return resource
    }
  )
  return { saved: true as const, revision: updated.revision }
}

type LiveFoodMenus = Awaited<ReturnType<typeof readLiveFoodMenus>>

type PublishFoodMenusInput = {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmFullReplacement: boolean
  requestId: string
}

/** Pre-flight: grant, eligibility, confirmation and the stale-snapshot check. */
function assertFoodMenusPublishable(
  live: LiveFoodMenus,
  input: PublishFoodMenusInput
) {
  requirePublishGrant(live.context, {
    code: "publish_not_allowed",
    message: "You cannot publish for this location.",
  })
  if (!live.state.eligible)
    throw new ApiError(
      409,
      "food_menus_not_eligible",
      "Google reports that this location cannot have Food Menus."
    )
  if (!input.confirmFullReplacement)
    throw new ApiError(
      409,
      "food_menus_confirmation_required",
      "Confirm the full Google Food Menus replacement."
    )
  if (
    live.canonicalResource.revision !== input.expectedCanonicalRevision ||
    live.state.canonicalHash !== input.expectedCanonicalHash ||
    live.state.googleHash !== input.expectedGoogleHash
  )
    throw new ApiError(
      409,
      "food_menus_stale",
      "The menu changed after review. Refresh before publishing."
    )
}

/**
 * Food Menus keeps its historical classification: a read-back that does not
 * match is settled `ambiguous` (thrown as GoogleMutationAmbiguousError), not
 * `failed` with google_readback_mismatch.
 */
function foodMenusReadback(
  live: LiveFoodMenus,
  options: { connectionKey: string }
) {
  const readbackHash = (readback: Record<string, unknown>) =>
    hashFoodMenus(asMenus(readback.menus))
  return {
    read: () => getGoogleFoodMenus(live.token, live.name, options),
    verify: ({ readback }: { readback: Record<string, unknown> }) => {
      if (readbackHash(readback) !== live.state.canonicalHash) {
        throw new GoogleMutationAmbiguousError(
          "Google Food Menus read-back did not match NabaPresence."
        )
      }
      return true
    },
    hash: readbackHash,
  }
}

export async function publishFoodMenus(
  input: PublishFoodMenusInput
): Promise<PublishFoodMenusResult> {
  requireGbpWrite(getServerEnv(), "foodMenus", {
    code: "food_menus_paused",
    message: "Food Menu publishing is paused.",
  })
  const live = await readLiveFoodMenus(input.session, input.locationId)
  assertFoodMenusPublishable(live, input)
  if (live.state.status === "in_sync")
    return { status: "in_sync" as const, idempotent: true }

  const options = { connectionKey: live.context.googleConnectionId }
  const result = await runGbpWrite<
    Record<string, unknown>,
    Record<string, unknown>
  >({
    organisationId: input.session.organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: foodMenusAttempts,
    key: idempotencyKey([
      input.session.organisationId,
      input.locationId,
      "food_menus_publish",
      input.expectedCanonicalRevision,
      input.expectedCanonicalHash,
      input.expectedGoogleHash,
    ]),
    intent: {
      location_id: input.locationId,
      external_location_id: live.context.externalLocationId,
      expected_canonical_revision: input.expectedCanonicalRevision,
      expected_canonical_hash: input.expectedCanonicalHash,
      expected_google_hash: input.expectedGoogleHash,
      intended_payload: (sql: TransactionSql) =>
        jsonColumn(sql, live.state.canonicalMenus),
    },
    inProgress: {
      code: "food_menus_publish_in_progress",
      message: "This menu publish already has an active attempt.",
    },
    failureCode: "food_menus_publish_failed",
    mutate: () =>
      patchGoogleFoodMenus(
        live.token,
        { name: live.name, menus: live.state.canonicalMenus },
        options
      ),
    onAmbiguous: "readback",
    readback: foodMenusReadback(live, options),
    onSuccess: (sql, ctx) =>
      reconcileCanonicalResource({
        sql,
        organisationId: input.session.organisationId,
        locationId: input.locationId,
        resourceType: "food_menus",
        canonicalHash: live.state.canonicalHash,
        googleHash: ctx.readbackHash ?? live.state.canonicalHash,
      }),
    audit: (ctx) => ({
      action: "food_menus.published",
      subjectType: "location",
      subjectId: input.locationId,
      metadata: {
        attemptId: ctx.attemptId,
        canonicalRevision: live.canonicalResource.revision,
      },
    }),
  })
  return {
    status: "published" as const,
    attemptId: result.attemptId,
    idempotent: result.idempotent,
  }
}
