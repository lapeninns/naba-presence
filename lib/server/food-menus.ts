import "server-only"

import type { TransactionSql } from "postgres"

import { foodMenuCounts, hashFoodMenus } from "@/lib/domain/food-menus"
import { googleFoodMenusName } from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import {
  ensureCanonicalResource,
  reconcileCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  getGoogleFoodMenus,
  getGoogleLocation,
  GoogleMutationAmbiguousError,
  patchGoogleFoodMenus,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { canPublishLocation, requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

type MenuContext = {
  locationId: string
  locationName: string
  externalLocationId: string
  connectionId: string
  accountName: string
  googleLocationName: string
  canPublish: boolean
}

async function loadContext(sql: TransactionSql, session: Session, locationId: string): Promise<MenuContext> {
  await requireLocationAccess(sql, session, locationId)
  const [row] = await sql<Omit<MenuContext, "canPublish">[]>`
    select l.id::text as "locationId", l.name as "locationName",
      el.id::text as "externalLocationId", el.google_connection_id::text as "connectionId",
      el.google_account_name as "accountName", el.google_location_name as "googleLocationName"
    from location l
    left join location_link ll on ll.location_id = l.id and ll.is_active = true
    left join external_location el on el.id = ll.external_location_id
    where l.id = ${locationId} limit 1
  `
  if (!row) throw new ApiError(404, "location_not_found", "Location not found.")
  if (!row.externalLocationId || !row.connectionId || !row.accountName || !row.googleLocationName) {
    throw new ApiError(409, "google_location_not_linked", "Link this location to Google first.")
  }
  return { ...row, canPublish: await canPublishLocation(sql, session, locationId) }
}

function contextFor(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) => loadContext(sql, session, locationId))
}

function asMenus(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : []
}

export async function readLiveFoodMenus(session: Session, locationId: string) {
  const context = await contextFor(session, locationId)
  const token = await connectionAccessToken(getDatabase(), session.organisationId, context.connectionId)
  const googleLocation = await getGoogleLocation(token, context.googleLocationName, ["metadata"], { connectionKey: context.connectionId })
  const metadata = googleLocation.metadata && typeof googleLocation.metadata === "object"
    ? googleLocation.metadata as Record<string, unknown>
    : {}
  const eligible = metadata.canHaveFoodMenus === true
  const name = googleFoodMenusName(context.accountName, context.googleLocationName)
  const googleResource = eligible
    ? await getGoogleFoodMenus(token, name, { connectionKey: context.connectionId })
    : { name, menus: [] }
  const googleMenus = asMenus(googleResource.menus)
  const canonicalResource = await withTenant(session.organisationId, (sql) =>
    ensureCanonicalResource<Array<Record<string, unknown>>>({
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
    location: { id: context.locationId, name: context.locationName, googleLocationName: context.googleLocationName },
    canonicalResource: {
      revision: canonicalResource.revision,
      updatedAt: canonicalResource.updatedAt.toISOString(),
    },
    eligible,
    status: canonicalHash === googleHash ? "in_sync" as const : "drift" as const,
    canonicalMenus,
    googleMenus,
    canonicalHash,
    googleHash,
    canonicalCounts: foodMenuCounts(canonicalMenus),
    googleCounts: foodMenuCounts(googleMenus),
    canPublish: context.canPublish,
    writesEnabled: env.PUBLISH_ENABLED && env.GBP_FOOD_MENUS_ENABLED,
  }
  await withTenant(session.organisationId, async (sql) => {
    await sql`
      insert into food_menus_state (
        organisation_id, location_id, external_location_id, eligible,
        canonical_revision, canonical_hash, google_hash,
        canonical_payload, google_payload, observed_at, expires_at
      ) values (
        ${session.organisationId}, ${locationId}, ${context.externalLocationId}, ${eligible},
        ${canonicalResource.revision}, ${canonicalHash}, ${googleHash},
        ${sql.json(JSON.parse(JSON.stringify(canonicalMenus)))},
        ${sql.json(JSON.parse(JSON.stringify(googleMenus)))}, now(), now() + interval '30 days'
      ) on conflict (organisation_id, location_id) do update set
        eligible = excluded.eligible, canonical_revision = excluded.canonical_revision,
        canonical_hash = excluded.canonical_hash, google_hash = excluded.google_hash,
        canonical_payload = excluded.canonical_payload, google_payload = excluded.google_payload,
        observed_at = now(), expires_at = excluded.expires_at
    `
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
  menus: Array<Record<string, unknown>>
  requestId: string
}) {
  const context = await contextFor(input.session, input.locationId)
  if (!context.canPublish) throw new ApiError(403, "canonical_edit_permission_required", "You cannot edit this location.")
  const updated = await withTenant(input.session.organisationId, async (sql) => {
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
      metadata: { revision: resource.revision, counts: foodMenuCounts(input.menus) },
    })
    return resource
  })
  return { saved: true as const, revision: updated.revision }
}

export async function publishFoodMenus(input: {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmFullReplacement: boolean
  requestId: string
}) {
  const env = getServerEnv()
  if (!env.PUBLISH_ENABLED || !env.GBP_FOOD_MENUS_ENABLED) {
    throw new ApiError(503, "food_menus_paused", "Food Menu publishing is paused.")
  }
  const live = await readLiveFoodMenus(input.session, input.locationId)
  if (!live.state.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
  if (!live.state.eligible) throw new ApiError(409, "food_menus_not_eligible", "Google reports that this location cannot have Food Menus.")
  if (!input.confirmFullReplacement) throw new ApiError(409, "food_menus_confirmation_required", "Confirm the full Google Food Menus replacement.")
  if (
    live.canonicalResource.revision !== input.expectedCanonicalRevision ||
    live.state.canonicalHash !== input.expectedCanonicalHash ||
    live.state.googleHash !== input.expectedGoogleHash
  ) throw new ApiError(409, "food_menus_stale", "The menu changed after review. Refresh before publishing.")
  if (live.state.status === "in_sync") return { status: "in_sync" as const, idempotent: true }
  const baseKey = `${input.locationId}:${input.expectedCanonicalRevision}:${input.expectedCanonicalHash}:${input.expectedGoogleHash}`
  const attempt = await withTenant(input.session.organisationId, async (sql) => {
    const [old] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status from food_menus_sync_attempt where idempotency_key = ${baseKey}
    `
    if (old?.status === "succeeded") return { ...old, idempotent: true }
    if (old && (old.status === "validating" || old.status === "publishing")) {
      throw new ApiError(409, "food_menus_publish_in_progress", "This menu publish already has an active attempt.")
    }
    const idempotencyKey = old ? `${baseKey}:${input.requestId}` : baseKey
    const [created] = await sql<{ id: string; status: string }[]>`
      insert into food_menus_sync_attempt (
        organisation_id, location_id, external_location_id, actor_user_id,
        status, idempotency_key, expected_canonical_revision,
        expected_canonical_hash, expected_google_hash, intended_payload
      ) values (
        ${input.session.organisationId}, ${input.locationId}, ${live.context.externalLocationId},
        ${input.session.userId}, 'validating', ${idempotencyKey}, ${input.expectedCanonicalRevision},
        ${input.expectedCanonicalHash}, ${input.expectedGoogleHash},
        ${sql.json(JSON.parse(JSON.stringify(live.state.canonicalMenus)))}
      ) returning id::text as id, status
    `
    return { ...created, idempotent: false }
  })
  if (attempt.idempotent) return { status: "published" as const, attemptId: attempt.id, idempotent: true }
  try {
    await withTenant(input.session.organisationId, (sql) => sql`
      update food_menus_sync_attempt set status = 'publishing' where id = ${attempt.id}
    `)
    try {
      await patchGoogleFoodMenus(live.token, { name: live.name, menus: live.state.canonicalMenus }, { connectionKey: live.context.connectionId })
    } catch (error) {
      if (!(error instanceof GoogleMutationAmbiguousError)) throw error
    }
    const readback = await getGoogleFoodMenus(live.token, live.name, { connectionKey: live.context.connectionId })
    const readbackMenus = asMenus(readback.menus)
    const readbackHash = hashFoodMenus(readbackMenus)
    if (readbackHash !== live.state.canonicalHash) {
      throw new GoogleMutationAmbiguousError("Google Food Menus read-back did not match NabaPresence.")
    }
    await withTenant(input.session.organisationId, async (sql) => {
      await sql`
        update food_menus_sync_attempt set status = 'succeeded',
          provider_response = ${sql.json(JSON.parse(JSON.stringify(readback)))}, finished_at = now()
        where id = ${attempt.id}
      `
      await reconcileCanonicalResource({
        sql,
        organisationId: input.session.organisationId,
        locationId: input.locationId,
        resourceType: "food_menus",
        canonicalHash: live.state.canonicalHash,
        googleHash: readbackHash,
      })
      await writeAudit(sql, {
        organisationId: input.session.organisationId,
        actorUserId: input.session.userId,
        action: "food_menus.published",
        subjectType: "location",
        subjectId: input.locationId,
        requestId: input.requestId,
        metadata: { attemptId: attempt.id, canonicalRevision: live.canonicalResource.revision },
      })
    })
    return { status: "published" as const, attemptId: attempt.id, idempotent: false }
  } catch (error) {
    const ambiguous = error instanceof GoogleMutationAmbiguousError
    await withTenant(input.session.organisationId, (sql) => sql`
      update food_menus_sync_attempt set status = ${ambiguous ? "ambiguous" : "failed"},
        last_error_code = ${error instanceof ApiError ? error.code : "food_menus_publish_failed"},
        finished_at = now() where id = ${attempt.id}
    `)
    throw error
  }
}
