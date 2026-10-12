import "server-only"

import type { TransactionSql } from "postgres"

import type {
  FoodMenu,
  FoodMenusState,
  PublishFoodMenusResult,
  SaveFoodMenusResult,
} from "@/lib/contracts/location-food-menus"
import { foodMenuCounts, hashFoodMenus } from "@/lib/domain/food-menus"
import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import { compareMenuReplacement } from "@/lib/locations/menu-diff"
import { googleFoodMenusName } from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import {
  ensureCanonicalResource,
  reconcileCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { jsonColumn, withSessionConnection, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import type { GbpLocationContext } from "@/lib/server/gbp-management"
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
import { recordResourceObservation } from "@/lib/server/resource-observations"
import { ApiError } from "@/lib/server/http"
import { operationSummary } from "@/lib/server/mutation-operations"
import {
  storeSettle,
  type RecoveryAdapter,
  type RecoveryAttempt,
} from "@/lib/server/mutation-recovery"
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
  attemptedAt: Date
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
        ${jsonColumn(sql, input.googleMenus)}, ${input.attemptedAt}, now() + interval '30 days'
      ) on conflict (organisation_id, location_id) do update set
        eligible = excluded.eligible, canonical_revision = excluded.canonical_revision,
        canonical_hash = excluded.canonical_hash, google_hash = excluded.google_hash,
        canonical_payload = excluded.canonical_payload, google_payload = excluded.google_payload,
        observed_at = excluded.observed_at, expires_at = excluded.expires_at
      where excluded.observed_at > food_menus_state.observed_at
    `
  })
}

export async function readLiveFoodMenus(session: Session, locationId: string) {
  const context = await linkedFoodMenusLocation(session, locationId)
  const attemptedAt = new Date()
  let token: string
  let fetched: Awaited<ReturnType<typeof fetchGoogleFoodMenus>>
  try {
    token = await context.accessToken()
    fetched = await fetchGoogleFoodMenus(context, token)
  } catch (error) {
    await withTenant(session.organisationId, (sql) =>
      recordResourceObservation(sql, {
        organisationId: session.organisationId,
        locationId,
        resource: "foodMenus",
        attemptedAt,
        errorCode:
          error instanceof ApiError ? error.code : "google_menu_read_failed",
      })
    )
    throw error
  }
  const { eligible, name, googleMenus } = fetched
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
    attemptedAt,
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
  await withTenant(session.organisationId, (sql) =>
    recordResourceObservation(sql, {
      organisationId: session.organisationId,
      locationId,
      resource: "foodMenus",
      attemptedAt,
    })
  )
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
  if (
    !compareMenuReplacement({
      draft: live.state.canonicalMenus,
      google: live.state.googleMenus,
    }).publishable
  ) {
    throw new ApiError(
      409,
      "food_menus_unresolved",
      "Some menu entries cannot be matched reliably. Resolve the comparison before publishing."
    )
  }
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

const FOOD_MENUS_PAUSED = {
  code: "food_menus_paused",
  message: "Food Menu publishing is paused.",
}

/** The advisory lock key every Food Menus writer to Google takes for a location. */
export function foodMenusLockKey(organisationId: string, locationId: string) {
  return `${organisationId}:${locationId}:food_menus`
}

/**
 * Sends the live snapshot's canonical menus as a full replacement through
 * runGbpWrite (food_menus_sync_attempt, receipt, readback, recovery). The
 * key pins the canonical revision and both hashes, as the editor's publish
 * always has.
 */
function sendFoodMenus(
  live: LiveFoodMenus,
  input: {
    session: Session
    locationId: string
    requestId: string
    /** A worker's intent (a bulk child); defaults to the request's. */
    intentId?: string
    approvalRef?: string
  }
) {
  const options = { connectionKey: live.context.googleConnectionId }
  const revision = live.canonicalResource.revision
  const canonicalHash = live.state.canonicalHash
  const googleHash = live.state.googleHash
  return runGbpWrite<Record<string, unknown>, Record<string, unknown>>({
    surface: "foodMenus",
    paused: FOOD_MENUS_PAUSED,
    organisationId: input.session.organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: foodMenusAttempts,
    key: idempotencyKey([
      input.session.organisationId,
      input.locationId,
      "food_menus_publish",
      revision,
      canonicalHash,
      googleHash,
    ]),
    intent: {
      location_id: input.locationId,
      external_location_id: live.context.externalLocationId,
      expected_canonical_revision: revision,
      expected_canonical_hash: canonicalHash,
      expected_google_hash: googleHash,
      intended_payload: (sql: TransactionSql) =>
        jsonColumn(sql, live.state.canonicalMenus),
    },
    inProgress: {
      code: "food_menus_publish_in_progress",
      message: "This menu publish already has an active attempt.",
    },
    failureCode: "food_menus_publish_failed",
    ...(input.intentId !== undefined ? { intentId: input.intentId } : {}),
    operation: {
      surface: "food_menus",
      action: "publish",
      locationId: input.locationId,
      targetType: "location",
      targetRef: live.name,
      payloadHash: idempotencyKey([revision, canonicalHash, googleHash]),
      expectedRevision: revision,
      googleConnectionId: live.context.googleConnectionId,
      ...(input.approvalRef ? { approvalRef: input.approvalRef } : {}),
    },
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
        canonicalHash,
        googleHash: ctx.readbackHash ?? canonicalHash,
      }),
    audit: (ctx) => ({
      action: "food_menus.published",
      subjectType: "location",
      subjectId: input.locationId,
      metadata: {
        attemptId: ctx.attemptId,
        canonicalRevision: revision,
        ...(input.approvalRef ? { approvalRef: input.approvalRef } : {}),
      },
    }),
  })
}

/**
 * The editor's publish. Holds the location's Food Menus lock
 * (`foodMenusLockKey`) across its live read, the snapshot checks, the
 * replacement and its readback, so it never interleaves with a bulk menu
 * child (lib/server/bulk-families/food-menus.ts) or another publish.
 */
export async function publishFoodMenus(
  input: PublishFoodMenusInput
): Promise<PublishFoodMenusResult> {
  requireGbpWrite(getServerEnv(), "foodMenus", FOOD_MENUS_PAUSED)
  return withSessionConnection((connection) =>
    connection.begin(async (lock) => {
      await lock`select pg_advisory_xact_lock(hashtextextended(${foodMenusLockKey(input.session.organisationId, input.locationId)}, 0))`
      const live = await readLiveFoodMenus(input.session, input.locationId)
      assertFoodMenusPublishable(live, input)
      if (live.state.status === "in_sync")
        return { status: "in_sync" as const, idempotent: true }
      const result = await sendFoodMenus(live, input)
      return {
        status: "published" as const,
        attemptId: result.attemptId,
        idempotent: result.idempotent,
        operation: operationSummary(result),
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Bulk menu changes (lib/server/bulk-families/food-menus.ts)
// ---------------------------------------------------------------------------

/**
 * Read only, for a bulk preview: Google's menus (when the listing can have
 * them) and the saved (canonical) menus, or null when none are saved yet.
 * Writes nothing: no canonical row is started and no observation recorded.
 */
export async function readFoodMenusForPlan(linked: GbpLocationContext) {
  const fetched = await fetchGoogleFoodMenus(linked, await linked.accessToken())
  const [saved] = await withTenant(
    linked.organisationId,
    (sql) => sql<{ payload: unknown }[]>`
      select payload from presence_canonical_resource
      where organisation_id = ${linked.organisationId}
        and location_id = ${linked.locationId} and resource_type = 'food_menus'`
  )
  return {
    eligible: fetched.eligible,
    googleMenus: fetched.googleMenus,
    savedMenus: saved ? asMenus(saved.payload) : null,
  }
}

/** The canonical revision a bulk change saved, and the menus it replaced. */
export type FoodMenusRestore = { revision: string; payload: Menus }

/**
 * Puts back the menus a bulk change replaced, only while the revision that
 * change saved is still current: a later edit wins. Returns whether it did.
 */
export async function restoreFoodMenusRevision(
  sql: TransactionSql,
  input: {
    organisationId: string
    locationId: string
    restore: FoodMenusRestore
  }
): Promise<boolean> {
  try {
    await updateCanonicalResource<Menus>({
      sql,
      organisationId: input.organisationId,
      locationId: input.locationId,
      resourceType: "food_menus",
      expectedRevision: input.restore.revision,
      payload: input.restore.payload,
    })
    return true
  } catch (stale) {
    if (!(stale instanceof ApiError)) throw stale
    return false
  }
}

export type FoodMenusChange = {
  session: Session
  locationId: string
  /** The listing's menus after the change, from the menus Google holds now. */
  apply: (
    google: Menus
  ) => { ok: true; menus: Menus } | { ok: false; reason: string }
  /** Google's menus hash when the change was previewed. */
  expectedGoogleHash: string
  intentId: string
  approvalRef: string
  requestId: string
  /** Asked once more just before anything is saved or sent. */
  stillOpen: () => boolean
  /** Called in the transaction that saves the change, before anything is sent. */
  recordRestore?: (
    sql: TransactionSql,
    restore: FoodMenusRestore
  ) => Promise<unknown>
}

export type FoodMenusChangeResult = { googleHash: string } & (
  | { status: "applied" | "conflict" | "closed" }
  | { status: "refused"; reason: string }
  | { status: "published"; outcome: OperationOutcome }
)

/**
 * Publishes an approved bulk menu change through the editor's own path, so
 * the saved (canonical) menus and Google stay in step: the change is saved
 * as a new canonical revision, then published as the full replacement the
 * editor sends, under the caller's intent, with its receipt, readback and
 * recovery (food_menus_sync_attempt). The caller holds `foodMenusLockKey`.
 *
 *   - Google already shows the result: the saved menus are brought in line
 *     unless they hold an unpublished edit (`refused`), nothing is sent
 *     (`applied`).
 *   - Google's menus changed since the preview, or the saved menus hold an
 *     unpublished edit (neither Google's menus nor this change's result):
 *     nothing is saved or sent (`conflict`).
 *   - A write that definitely did not apply puts the saved menus back. An
 *     uncertain one keeps them, with the restore point the caller recorded,
 *     until recovery reads it back.
 */
export async function publishFoodMenusChangeLocked(
  change: FoodMenusChange
): Promise<FoodMenusChangeResult> {
  requireGbpWrite(getServerEnv(), "foodMenus", FOOD_MENUS_PAUSED)
  const { session, locationId } = change
  const live = await readLiveFoodMenus(session, locationId)
  requirePublishGrant(live.context, {
    code: "publish_not_allowed",
    message: "You cannot publish for this location.",
  })
  const googleHash = live.state.googleHash
  if (!live.state.eligible)
    return { status: "refused", reason: "food_menus_not_eligible", googleHash }
  const target = change.apply(live.state.googleMenus)
  if (!target.ok)
    return { status: "refused", reason: target.reason, googleHash }
  const targetHash = hashFoodMenus(target.menus)
  const canonicalHash = live.state.canonicalHash
  const saveTarget = (restorable: boolean) =>
    withTenant(session.organisationId, async (sql) => {
      const updated = await updateCanonicalResource<Menus>({
        sql,
        organisationId: session.organisationId,
        locationId,
        resourceType: "food_menus",
        expectedRevision: live.canonicalResource.revision,
        payload: target.menus,
      })
      if (restorable)
        await change.recordRestore?.(sql, {
          revision: updated.revision,
          payload: live.state.canonicalMenus,
        })
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "food_menus.canonical.updated",
        subjectType: "location",
        subjectId: locationId,
        requestId: change.requestId,
        metadata: {
          revision: updated.revision,
          counts: foodMenuCounts(target.menus),
          approvalRef: change.approvalRef,
        },
      })
      return updated
    })
  // An unpublished menu edit is the editor's to publish or discard; a bulk
  // change never overwrites it. The preview only offered listings whose
  // saved menus matched Google's (`expectedGoogleHash`), so saved menus that
  // are now neither that nor this change's result were edited since.
  const localEdit =
    canonicalHash !== change.expectedGoogleHash && canonicalHash !== targetHash
  if (googleHash === targetHash) {
    if (canonicalHash === targetHash) return { status: "applied", googleHash }
    if (localEdit)
      return {
        status: "refused",
        reason: "food_menus_local_changes",
        googleHash,
      }
    await saveTarget(false)
    return { status: "applied", googleHash }
  }
  if (googleHash !== change.expectedGoogleHash)
    return { status: "conflict", googleHash }
  if (localEdit)
    return { status: "refused", reason: "food_menus_local_changes", googleHash }
  if (!change.stillOpen()) return { status: "closed", googleHash }
  // Saved menus already at this change's result are this change's own
  // earlier save (a re-claim after a claim that saved, then stopped before
  // a receipt; the claim cleared its restore point). The menus that save
  // replaced matched the preview's Google menus, which Google still shows,
  // so they are recorded again as the restore point.
  let saved: Awaited<ReturnType<typeof saveTarget>> | null = null
  let restore: FoodMenusRestore
  if (canonicalHash === targetHash) {
    restore = {
      revision: live.canonicalResource.revision,
      payload: live.state.googleMenus,
    }
    const { recordRestore } = change
    if (recordRestore)
      await withTenant(session.organisationId, (sql) =>
        recordRestore(sql, restore)
      )
  } else {
    saved = await saveTarget(true)
    restore = { revision: saved.revision, payload: live.state.canonicalMenus }
  }
  const published: LiveFoodMenus = saved
    ? {
        ...live,
        canonicalResource: saved,
        state: {
          ...live.state,
          canonicalResource: {
            revision: saved.revision,
            updatedAt: saved.updatedAt.toISOString(),
          },
          canonicalMenus: target.menus,
          canonicalHash: targetHash,
          canonicalCounts: foodMenuCounts(target.menus),
          status: "drift",
        },
      }
    : live
  try {
    const result = await sendFoodMenus(published, {
      session,
      locationId,
      requestId: change.requestId,
      intentId: change.intentId,
      approvalRef: change.approvalRef,
    })
    return { status: "published", outcome: result.outcome, googleHash }
  } catch (error) {
    await withTenant(session.organisationId, async (sql) => {
      const [receipt] = await sql<{ state: string }[]>`
        select state from mutation_operation
        where organisation_id = ${session.organisationId} and intent_id = ${change.intentId}`
      if (receipt && !["failed", "rejected"].includes(receipt.state)) return
      await restoreFoodMenusRevision(sql, {
        organisationId: session.organisationId,
        locationId,
        restore,
      })
    })
    throw error
  }
}

// ---------------------------------------------------------------------------
// Recovery (lib/server/mutation-recovery.ts)
// ---------------------------------------------------------------------------

type FoodMenusRecoveryAttempt = RecoveryAttempt & {
  externalLocationId: string
  expectedCanonicalHash: string
}

/**
 * Reads an uncertain menu replacement back: it landed when Google's menus
 * hash to the canonical hash the attempt pinned (the publish's own
 * comparison). Any other menu set is a replacement that did not apply.
 */
export const foodMenusRecoveryAdapter: RecoveryAdapter<FoodMenusRecoveryAttempt> =
  {
    surface: "food_menus",
    attemptTable: "food_menus_sync_attempt",
    async load(sql, attemptId) {
      const [row] = await sql<FoodMenusRecoveryAttempt[]>`
        select
          id::text as id,
          status as "rawStatus",
          started_at as "startedAt",
          last_error_code as "errorCode",
          external_location_id::text as "externalLocationId",
          expected_canonical_hash as "expectedCanonicalHash"
        from food_menus_sync_attempt
        where id = ${attemptId}
      `
      return row ?? null
    },
    async readback({ attempt, link }) {
      if (attempt.externalLocationId !== link.externalLocationId) {
        return { kind: "unverifiable", errorCode: "target_changed" }
      }
      const readback = await getGoogleFoodMenus(
        await link.accessToken(),
        googleFoodMenusName(link.googleAccountName, link.googleLocationName),
        { connectionKey: link.googleConnectionId }
      )
      const hash = hashFoodMenus(asMenus(readback.menus))
      return hash === attempt.expectedCanonicalHash
        ? { kind: "landed", confirmed: true, response: readback }
        : { kind: "not_landed", errorCode: "google_readback_mismatch" }
    },
    settle: storeSettle(foodMenusAttempts),
  }
