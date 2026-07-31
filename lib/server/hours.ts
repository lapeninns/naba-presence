import "server-only"

import type { TransactionSql } from "postgres"

import {
  buildGoogleHoursPatch,
  classifyHoursDrift,
  hashHours,
  normalizeGoogleHours,
  type GoogleLocationHours,
  type HoursDriftStatus,
  type NormalizedHours,
} from "@/lib/domain/hours"
import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import {
  ensureCanonicalResource,
  reconcileCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  getGoogleLocation,
  GoogleMutationAmbiguousError,
  patchGoogleLocationHours,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { canPublishLocation, requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

const HOURS_READ_MASK = [
  "name",
  "title",
  "regularHours",
  "specialHours",
  "moreHours",
  "categories",
  "metadata",
] as const

type HoursContext = {
  locationId: string
  locationName: string
  timezone: string
  externalLocationId: string
  googleLocationName: string
  googleConnectionId: string
  canPublish: boolean
}

export type HoursState = {
  location: {
    id: string
    name: string
    googleLocationName: string
    timezone: string
  }
  canonicalResource: {
    revision: string
    updatedAt: string
  }
  status: HoursDriftStatus
  canonical: NormalizedHours
  google: NormalizedHours
  canonicalHash: string
  googleHash: string
  updateMask: GoogleHoursUpdateMask[]
  warnings: string[]
  canPublish: boolean
  writesEnabled: boolean
  lastReconciledAt: string | null
  latestAttempt: {
    id: string
    status: string
    createdAt: string
    finishedAt: string | null
  } | null
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value))
}

async function loadContext(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<HoursContext> {
  await requireLocationAccess(sql, session, locationId)
  const [row] = await sql<Omit<HoursContext, "canPublish">[]>`
    select
      l.id::text as "locationId",
      l.name as "locationName",
      l.timezone,
      e.id::text as "externalLocationId",
      e.google_location_name as "googleLocationName",
      e.google_connection_id::text as "googleConnectionId"
    from location l
    left join location_link ll
      on ll.location_id = l.id and ll.is_active = true
    left join external_location e on e.id = ll.external_location_id
    where l.id = ${locationId}
    limit 1
  `
  if (!row) {
    throw new ApiError(404, "location_not_found", "The requested location was not found.")
  }
  if (!row.externalLocationId || !row.googleLocationName || !row.googleConnectionId) {
    throw new ApiError(
      409,
      "google_location_not_linked",
      "Link this location to Google before managing hours."
    )
  }
  return { ...row, canPublish: await canPublishLocation(sql, session, locationId) }
}

function contextFor(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) =>
    loadContext(sql, session, locationId)
  )
}

async function readLiveHours(session: Session, locationId: string) {
  const context = await contextFor(session, locationId)
  const accessToken = await connectionAccessToken(
    getDatabase(),
    session.organisationId,
    context.googleConnectionId
  )
  const googleLocation = (await getGoogleLocation(
    accessToken,
    context.googleLocationName,
    [...HOURS_READ_MASK],
    { connectionKey: context.googleConnectionId }
  )) as GoogleLocationHours
  const google = normalizeGoogleHours(googleLocation)
  const resource = await withTenant(session.organisationId, (sql) =>
    ensureCanonicalResource<NormalizedHours>({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "hours",
      initialPayload: google,
      actorUserId: session.userId,
    })
  )
  const canonical = resource.payload
  const patch = buildGoogleHoursPatch({ canonical, googleLocation })
  const canonicalHash = hashHours(canonical)
  const googleHash = hashHours(google)
  return {
    context,
    accessToken,
    googleLocation,
    google,
    resource,
    canonical,
    canonicalHash,
    googleHash,
    patch,
    status: classifyHoursDrift({
      canonicalHash,
      googleHash,
      baselineCanonicalHash: resource.baselineCanonicalHash,
      baselineGoogleHash: resource.baselineGoogleHash,
    }),
  }
}

export async function getHoursState(
  session: Session,
  locationId: string
): Promise<HoursState> {
  const live = await readLiveHours(session, locationId)
  const latestAttempt = await withTenant(session.organisationId, async (sql) => {
    const [attempt] = await sql<{
      id: string
      status: string
      createdAt: Date
      finishedAt: Date | null
    }[]>`
      select
        id::text as id,
        status,
        created_at as "createdAt",
        finished_at as "finishedAt"
      from hours_sync_attempt
      where location_id = ${locationId}
      order by created_at desc
      limit 1
    `
    return attempt ?? null
  })
  return {
    location: {
      id: live.context.locationId,
      name: live.context.locationName,
      googleLocationName: live.context.googleLocationName,
      timezone: live.context.timezone,
    },
    canonicalResource: {
      revision: live.resource.revision,
      updatedAt: live.resource.updatedAt.toISOString(),
    },
    status: live.status,
    canonical: live.canonical,
    google: live.google,
    canonicalHash: live.canonicalHash,
    googleHash: live.googleHash,
    updateMask: live.patch.updateMask,
    warnings: live.patch.warnings,
    canPublish: live.context.canPublish,
    writesEnabled: getServerEnv().GBP_PROFILE_WRITES_ENABLED,
    lastReconciledAt: live.resource.lastReconciledAt?.toISOString() ?? null,
    latestAttempt: latestAttempt
      ? {
          ...latestAttempt,
          createdAt: latestAttempt.createdAt.toISOString(),
          finishedAt: latestAttempt.finishedAt?.toISOString() ?? null,
        }
      : null,
  }
}

export async function saveCanonicalHours(input: {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  hours: NormalizedHours
  requestId: string
}) {
  const context = await contextFor(input.session, input.locationId)
  if (!context.canPublish) {
    throw new ApiError(403, "canonical_edit_permission_required", "You cannot edit this location.")
  }
  const resource = await withTenant(input.session.organisationId, async (sql) => {
    const updated = await updateCanonicalResource({
      sql,
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      resourceType: "hours",
      expectedRevision: input.expectedCanonicalRevision,
      payload: input.hours,
    })
    await writeAudit(sql, {
      organisationId: input.session.organisationId,
      actorUserId: input.session.userId,
      action: "hours.canonical.updated",
      subjectType: "location",
      subjectId: input.locationId,
      requestId: input.requestId,
      metadata: { revision: updated.revision, canonicalHash: hashHours(input.hours) },
    })
    return updated
  })
  return { saved: true as const, revision: resource.revision }
}

async function settleFailure(input: {
  organisationId: string
  attemptId: string
  status: "failed" | "ambiguous" | "stale"
  code: string
}) {
  await withTenant(input.organisationId, (sql) => sql`
    update hours_sync_attempt
    set status = ${input.status}, provider_error_code = ${input.code}, finished_at = now()
    where id = ${input.attemptId}
  `)
}

export async function publishCanonicalHours(input: {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  approvedUpdateMask: GoogleHoursUpdateMask[]
  confirmOverwriteGoogleChanges: boolean
  requestId: string
}) {
  const env = getServerEnv()
  if (!env.GBP_PROFILE_WRITES_ENABLED || !env.PUBLISH_ENABLED) {
    throw new ApiError(409, "hours_publishing_disabled", "Hours publishing is currently disabled.")
  }
  const live = await readLiveHours(input.session, input.locationId)
  if (!live.context.canPublish) {
    throw new ApiError(403, "publish_permission_required", "You cannot publish this location.")
  }
  const approvedMask = [...new Set(input.approvedUpdateMask)].sort()
  if (
    live.resource.revision !== input.expectedCanonicalRevision ||
    live.canonicalHash !== input.expectedCanonicalHash ||
    live.googleHash !== input.expectedGoogleHash ||
    approvedMask.join(",") !== [...live.patch.updateMask].sort().join(",")
  ) {
    throw new ApiError(409, "hours_snapshot_stale", "The schedule changed after review. Refresh first.")
  }
  if (live.status === "in_sync") return { status: "in_sync" as const, idempotent: true }
  if (["google_dirty", "conflict"].includes(live.status) && !input.confirmOverwriteGoogleChanges) {
    throw new ApiError(
      409,
      "google_hours_overwrite_confirmation_required",
      "Google changed independently. Confirm that NabaPresence should overwrite it."
    )
  }
  const payloadHash = sha256(JSON.stringify(live.patch.payload))
  const idempotencyKey = sha256([
    input.session.organisationId,
    live.context.externalLocationId,
    "hours_publish",
    live.resource.revision,
    live.googleHash,
    payloadHash,
  ].join(":"))
  const attempt = await withTenant(input.session.organisationId, async (sql) => {
    const [existing] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status from hours_sync_attempt
      where idempotency_key = ${idempotencyKey} limit 1
    `
    if (existing?.status === "succeeded") return { ...existing, idempotent: true }
    if (existing && ["validating", "validated", "publishing"].includes(existing.status)) {
      throw new ApiError(409, "hours_publish_in_progress", "This publish is already in progress.")
    }
    const [row] = existing
      ? await sql<{ id: string; status: string }[]>`
          update hours_sync_attempt set status = 'validating', actor_user_id = ${input.session.userId},
            provider_error_code = null, started_at = now(), finished_at = null
          where id = ${existing.id} returning id::text as id, status
        `
      : await sql<{ id: string; status: string }[]>`
          insert into hours_sync_attempt (
            organisation_id, location_id, external_location_id, actor_user_id,
            operation, status, idempotency_key, pinned_canonical_revision,
            pinned_canonical_hash, pinned_google_hash, update_mask, intended_payload, warnings
          ) values (
            ${input.session.organisationId}, ${input.locationId}, ${live.context.externalLocationId},
            ${input.session.userId}, 'publish', 'validating', ${idempotencyKey},
            ${live.resource.revision}, ${live.canonicalHash}, ${live.googleHash},
            ${live.patch.updateMask}, ${sql.json(jsonValue(live.patch.payload))},
            ${sql.json(jsonValue(live.patch.warnings))}
          ) returning id::text as id, status
        `
    return { ...row, idempotent: false }
  })
  if (attempt.idempotent) {
    return { status: "published" as const, attemptId: attempt.id, idempotent: true }
  }

  let phase: "validating" | "publishing" = "validating"
  try {
    await patchGoogleLocationHours(live.accessToken, {
      locationName: live.context.googleLocationName,
      updateMask: live.patch.updateMask,
      validateOnly: true,
      payload: live.patch.payload,
    }, { connectionKey: live.context.googleConnectionId })
    await withTenant(input.session.organisationId, (sql) => sql`
      update hours_sync_attempt set status = 'publishing', validated_at = now()
      where id = ${attempt.id}
    `)
    phase = "publishing"
    await patchGoogleLocationHours(live.accessToken, {
      locationName: live.context.googleLocationName,
      updateMask: live.patch.updateMask,
      validateOnly: false,
      payload: live.patch.payload,
    }, { connectionKey: live.context.googleConnectionId })
  } catch (error) {
    const ambiguous = error instanceof GoogleMutationAmbiguousError && phase === "publishing"
    await settleFailure({
      organisationId: input.session.organisationId,
      attemptId: attempt.id,
      status: ambiguous ? "ambiguous" : "failed",
      code: error instanceof ApiError ? error.code : "google_hours_publish_failed",
    })
    if (!ambiguous) throw error
  }

  const readBack = normalizeGoogleHours((await getGoogleLocation(
    live.accessToken,
    live.context.googleLocationName,
    [...HOURS_READ_MASK],
    { connectionKey: live.context.googleConnectionId, maxAttempts: 3 }
  )) as GoogleLocationHours)
  const readBackHash = hashHours(readBack)
  if (readBackHash !== live.canonicalHash) {
    await settleFailure({
      organisationId: input.session.organisationId,
      attemptId: attempt.id,
      status: "failed",
      code: "google_readback_mismatch",
    })
    throw new ApiError(502, "google_readback_mismatch", "Google read-back did not match NabaPresence.")
  }
  await withTenant(input.session.organisationId, async (sql) => {
    await sql`
      update hours_sync_attempt set status = 'succeeded', provider_http_status = 200,
        provider_error_code = null, provider_response_hash = ${readBackHash}, finished_at = now()
      where id = ${attempt.id}
    `
    await reconcileCanonicalResource({
      sql,
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      resourceType: "hours",
      canonicalHash: live.canonicalHash,
      googleHash: readBackHash,
    })
    await writeAudit(sql, {
      organisationId: input.session.organisationId,
      actorUserId: input.session.userId,
      action: "hours.publish.succeeded",
      subjectType: "hours_sync_attempt",
      subjectId: attempt.id,
      requestId: input.requestId,
      metadata: { locationId: input.locationId, canonicalRevision: live.resource.revision },
    })
  })
  return { status: "published" as const, attemptId: attempt.id, idempotent: false }
}
