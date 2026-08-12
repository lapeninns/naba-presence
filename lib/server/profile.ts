import "server-only"

import type { TransactionSql } from "postgres"

import {
  buildGoogleProfilePatch,
  classifyProfileField,
  hashProfile,
  hashProfileValue,
  normalizeGoogleProfile,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELD_POLICIES,
  type GoogleLocationProfile,
  type NormalizedProfile,
  type ProfileFieldKey,
} from "@/lib/domain/profile"
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
  patchGoogleLocationProfile,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { canPublishLocation, requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

const PROFILE_READ_MASK = [
  "name",
  "title",
  "phoneNumbers",
  "profile",
  "storefrontAddress",
  "websiteUri",
  "categories",
  "metadata",
] as const

export type ProfileContext = {
  locationId: string
  locationName: string
  externalLocationId: string
  googleLocationName: string
  googleConnectionId: string
  canPublish: boolean
}

type StoredFieldState = {
  fieldKey: ProfileFieldKey
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
  lastReconciledAt: Date | null
}

export type ProfileState = {
  location: { id: string; name: string; googleLocationName: string }
  canonicalResource: { revision: string; updatedAt: string }
  canonicalHash: string
  googleHash: string
  canPublish: boolean
  googleWritesEnabled: boolean
  fields: Array<{
    key: ProfileFieldKey
    policy: (typeof PROFILE_FIELD_POLICIES)[ProfileFieldKey]
    status: ReturnType<typeof classifyProfileField>
    canonicalValue: string | null
    googleValue: string | null
    canonicalHash: string
    googleHash: string
    lastReconciledAt: string | null
  }>
  googleDetails: { primaryCategory: string | null; additionalCategories: string[] }
  latestAttempt: {
    id: string
    direction: string
    status: string
    selectedFields: string[]
    createdAt: string
    finishedAt: string | null
  } | null
}

async function loadContext(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<ProfileContext> {
  await requireLocationAccess(sql, session, locationId)
  const [row] = await sql<Omit<ProfileContext, "canPublish">[]>`
    select
      l.id::text as "locationId",
      l.name as "locationName",
      e.id::text as "externalLocationId",
      e.google_location_name as "googleLocationName",
      e.google_connection_id::text as "googleConnectionId"
    from location l
    left join location_link ll on ll.location_id = l.id and ll.is_active = true
    left join external_location e on e.id = ll.external_location_id
    where l.id = ${locationId}
    limit 1
  `
  if (!row) throw new ApiError(404, "location_not_found", "Location not found.")
  if (!row.externalLocationId || !row.googleLocationName || !row.googleConnectionId) {
    throw new ApiError(409, "google_location_not_linked", "Link this location to Google before managing its profile.")
  }
  return { ...row, canPublish: await canPublishLocation(sql, session, locationId) }
}

function contextFor(session: Session, locationId: string) {
  return withTenant(session.organisationId, (sql) => loadContext(sql, session, locationId))
}

async function loadStoredStates(organisationId: string, locationId: string) {
  return withTenant(organisationId, async (sql) => {
    const rows = await sql<StoredFieldState[]>`
      select field_key as "fieldKey", baseline_canonical_hash as "baselineCanonicalHash",
        baseline_google_hash as "baselineGoogleHash", last_reconciled_at as "lastReconciledAt"
      from profile_field_state where location_id = ${locationId}
    `
    return new Map(rows.map((row) => [row.fieldKey, row]))
  })
}

function fieldComparisons(input: {
  canonical: NormalizedProfile
  google: NormalizedProfile
  stored: Map<ProfileFieldKey, StoredFieldState>
}) {
  return PROFILE_FIELD_KEYS.map((key) => {
    const stored = input.stored.get(key)
    const canonicalHash = hashProfileValue(input.canonical[key])
    const googleHash = hashProfileValue(input.google[key])
    return {
      key,
      policy: PROFILE_FIELD_POLICIES[key],
      status: classifyProfileField({
        canonicalHash,
        googleHash,
        baselineCanonicalHash: stored?.baselineCanonicalHash ?? null,
        baselineGoogleHash: stored?.baselineGoogleHash ?? null,
      }),
      canonicalValue: input.canonical[key],
      googleValue: input.google[key],
      canonicalHash,
      googleHash,
      lastReconciledAt: stored?.lastReconciledAt?.toISOString() ?? null,
    }
  })
}

async function persistObservedFields(input: {
  organisationId: string
  context: ProfileContext
  canonicalRevision: string
  fields: ReturnType<typeof fieldComparisons>
}) {
  await withTenant(input.organisationId, async (sql) => {
    for (const field of input.fields) {
      const establishBaseline = field.status === "in_sync"
      await sql`
        insert into profile_field_state (
          organisation_id, location_id, external_location_id, field_key, policy, status,
          canonical_value, google_value, canonical_hash, google_hash,
          baseline_canonical_hash, baseline_google_hash, canonical_revision, last_reconciled_at
        ) values (
          ${input.organisationId}, ${input.context.locationId}, ${input.context.externalLocationId},
          ${field.key}, ${field.policy}, ${field.status},
          ${sql.json({ value: field.canonicalValue })}, ${sql.json({ value: field.googleValue })},
          ${field.canonicalHash}, ${field.googleHash},
          ${establishBaseline ? field.canonicalHash : null},
          ${establishBaseline ? field.googleHash : null}, ${input.canonicalRevision},
          ${establishBaseline ? new Date() : null}
        ) on conflict (organisation_id, location_id, field_key) do update set
          policy = excluded.policy, status = excluded.status,
          canonical_value = excluded.canonical_value, google_value = excluded.google_value,
          canonical_hash = excluded.canonical_hash, google_hash = excluded.google_hash,
          baseline_canonical_hash = coalesce(profile_field_state.baseline_canonical_hash, excluded.baseline_canonical_hash),
          baseline_google_hash = coalesce(profile_field_state.baseline_google_hash, excluded.baseline_google_hash),
          canonical_revision = excluded.canonical_revision, observed_at = now(),
          snapshot_expires_at = now() + interval '30 days',
          last_reconciled_at = coalesce(profile_field_state.last_reconciled_at, excluded.last_reconciled_at)
      `
    }
  })
}

async function readLiveProfile(session: Session, locationId: string) {
  const context = await contextFor(session, locationId)
  const accessToken = await connectionAccessToken(
    getDatabase(), session.organisationId, context.googleConnectionId
  )
  const googleLocation = (await getGoogleLocation(
    accessToken,
    context.googleLocationName,
    [...PROFILE_READ_MASK],
    { connectionKey: context.googleConnectionId }
  )) as GoogleLocationProfile
  const google = normalizeGoogleProfile(googleLocation)
  const resource = await withTenant(session.organisationId, (sql) =>
    ensureCanonicalResource<NormalizedProfile>({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "profile",
      initialPayload: google,
      actorUserId: session.userId,
    })
  )
  const canonical = resource.payload
  return {
    context,
    accessToken,
    googleLocation,
    google,
    resource,
    canonical,
    canonicalHash: hashProfile(canonical),
    googleHash: hashProfile(google),
  }
}

export async function getProfileState(session: Session, locationId: string): Promise<ProfileState> {
  return (await readProfileStateBundle(session, locationId)).state
}

/**
 * Same as getProfileState but also returns the location context, so callers
 * that need external ids (the import-review raiser) avoid a second
 * context+Google round-trip.
 */
export async function readProfileStateBundle(
  session: Session,
  locationId: string
): Promise<{ state: ProfileState; context: ProfileContext }> {
  const [live, stored] = await Promise.all([
    readLiveProfile(session, locationId),
    loadStoredStates(session.organisationId, locationId),
  ])
  const fields = fieldComparisons({ canonical: live.canonical, google: live.google, stored })
  await persistObservedFields({
    organisationId: session.organisationId,
    context: live.context,
    canonicalRevision: live.resource.revision,
    fields,
  })
  const latestAttempt = await withTenant(session.organisationId, async (sql) => {
    const [row] = await sql<{
      id: string
      direction: string
      status: string
      selectedFields: string[]
      createdAt: Date
      finishedAt: Date | null
    }[]>`
      select id::text as id, direction, status, selected_fields as "selectedFields",
        created_at as "createdAt", finished_at as "finishedAt"
      from profile_sync_attempt where location_id = ${locationId}
      order by created_at desc limit 1
    `
    return row ?? null
  })
  const primaryCategory = live.googleLocation.categories?.primaryCategory?.displayName
    ?? live.googleLocation.categories?.primaryCategory?.name ?? null
  const additionalCategories = live.googleLocation.categories?.additionalCategories?.flatMap(
    (category) => category.displayName ?? category.name ?? []
  ) ?? []
  const state: ProfileState = {
    location: { id: live.context.locationId, name: live.context.locationName, googleLocationName: live.context.googleLocationName },
    canonicalResource: { revision: live.resource.revision, updatedAt: live.resource.updatedAt.toISOString() },
    canonicalHash: live.canonicalHash,
    googleHash: live.googleHash,
    canPublish: live.context.canPublish,
    googleWritesEnabled: getServerEnv().PUBLISH_ENABLED,
    fields,
    googleDetails: { primaryCategory, additionalCategories },
    latestAttempt: latestAttempt ? {
      ...latestAttempt,
      createdAt: latestAttempt.createdAt.toISOString(),
      finishedAt: latestAttempt.finishedAt?.toISOString() ?? null,
    } : null,
  }
  return { state, context: live.context }
}

function assertSelectedFields(selectedFields: ProfileFieldKey[], direction: "to_google" | "from_google") {
  const selected = [...new Set(selectedFields)]
  if (!selected.length) throw new ApiError(400, "profile_fields_required", "Select at least one profile field.")
  for (const field of selected) {
    const policy = PROFILE_FIELD_POLICIES[field]
    if (policy === "google_read_only" || (direction === "to_google" && policy !== "bidirectional")) {
      throw new ApiError(409, "profile_field_direction_unsupported", `${field} cannot be changed in that direction.`)
    }
  }
  return selected
}

export async function saveCanonicalProfile(input: {
  session: Session
  locationId: string
  expectedCanonicalRevision: string
  values: Partial<NormalizedProfile>
  requestId: string
}) {
  const live = await readLiveProfile(input.session, input.locationId)
  if (!live.context.canPublish) throw new ApiError(403, "canonical_edit_permission_required", "You cannot edit this location.")
  if (live.resource.revision !== input.expectedCanonicalRevision) {
    throw new ApiError(409, "canonical_resource_stale", "The profile changed after it was loaded.")
  }
  const allowed = new Set(PROFILE_FIELD_KEYS.filter((key) => PROFILE_FIELD_POLICIES[key] === "bidirectional"))
  const canonical = { ...live.canonical }
  for (const [key, value] of Object.entries(input.values) as Array<[ProfileFieldKey, string | null]>) {
    if (allowed.has(key)) canonical[key] = typeof value === "string" ? value.trim() || null : null
  }
  const updated = await withTenant(input.session.organisationId, async (sql) => {
    const resource = await updateCanonicalResource({
      sql,
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      resourceType: "profile",
      expectedRevision: input.expectedCanonicalRevision,
      payload: canonical,
    })
    await writeAudit(sql, {
      organisationId: input.session.organisationId,
      actorUserId: input.session.userId,
      action: "profile.canonical.updated",
      subjectType: "location",
      subjectId: input.locationId,
      requestId: input.requestId,
      metadata: { revision: resource.revision, fields: Object.keys(input.values) },
    })
    return resource
  })
  return { saved: true as const, revision: updated.revision }
}

export async function importProfileFromGoogle(input: {
  session: Session
  locationId: string
  selectedFields: ProfileFieldKey[]
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmOverwriteCanonicalChanges: boolean
  requestId: string
}) {
  const selected = assertSelectedFields(input.selectedFields, "from_google")
  const live = await readLiveProfile(input.session, input.locationId)
  if (!live.context.canPublish) throw new ApiError(403, "canonical_edit_permission_required", "You cannot edit this location.")
  if (
    live.resource.revision !== input.expectedCanonicalRevision ||
    live.canonicalHash !== input.expectedCanonicalHash ||
    live.googleHash !== input.expectedGoogleHash
  ) throw new ApiError(409, "profile_snapshot_stale", "The profile changed after review. Refresh first.")
  const stored = await loadStoredStates(input.session.organisationId, input.locationId)
  const comparisons = fieldComparisons({ canonical: live.canonical, google: live.google, stored })
  if (comparisons.some((field) => selected.includes(field.key) && ["core_dirty", "conflict"].includes(field.status)) && !input.confirmOverwriteCanonicalChanges) {
    throw new ApiError(409, "canonical_overwrite_confirmation_required", "NabaPresence changed independently. Confirm the selected overwrite.")
  }
  const canonical = { ...live.canonical }
  for (const field of selected) canonical[field] = live.google[field]
  const updated = await withTenant(input.session.organisationId, async (sql) => {
    const resource = await updateCanonicalResource({
      sql,
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      resourceType: "profile",
      expectedRevision: input.expectedCanonicalRevision,
      payload: canonical,
    })
    await writeAudit(sql, {
      organisationId: input.session.organisationId,
      actorUserId: input.session.userId,
      action: "profile.google.imported",
      subjectType: "location",
      subjectId: input.locationId,
      requestId: input.requestId,
      metadata: { revision: resource.revision, selectedFields: selected },
    })
    return resource
  })
  return { status: "imported" as const, revision: updated.revision, idempotent: false }
}

async function failAttempt(input: {
  organisationId: string
  attemptId: string
  status: "failed" | "ambiguous"
  code: string
}) {
  await withTenant(input.organisationId, (sql) => sql`
    update profile_sync_attempt set status = ${input.status}, provider_error_code = ${input.code}, finished_at = now()
    where id = ${input.attemptId}
  `)
}

export async function publishProfileToGoogle(input: {
  session: Session
  locationId: string
  selectedFields: ProfileFieldKey[]
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmOverwriteGoogleChanges: boolean
  requestId: string
}) {
  const env = getServerEnv()
  if (!env.PUBLISH_ENABLED) {
    throw new ApiError(409, "profile_publishing_disabled", "Profile publishing is currently disabled.")
  }
  const selected = assertSelectedFields(input.selectedFields, "to_google")
  const live = await readLiveProfile(input.session, input.locationId)
  if (!live.context.canPublish) throw new ApiError(403, "publish_permission_required", "You cannot publish this location.")
  if (
    live.resource.revision !== input.expectedCanonicalRevision ||
    live.canonicalHash !== input.expectedCanonicalHash ||
    live.googleHash !== input.expectedGoogleHash
  ) throw new ApiError(409, "profile_snapshot_stale", "The profile changed after review. Refresh first.")
  const stored = await loadStoredStates(input.session.organisationId, input.locationId)
  const comparisons = fieldComparisons({ canonical: live.canonical, google: live.google, stored })
  if (comparisons.some((field) => selected.includes(field.key) && ["google_dirty", "conflict"].includes(field.status)) && !input.confirmOverwriteGoogleChanges) {
    throw new ApiError(409, "profile_overwrite_confirmation_required", "Google changed independently. Confirm the selected overwrite.")
  }
  const patch = buildGoogleProfilePatch({ canonical: live.canonical, selectedFields: selected })
  if (!patch.updateMask.length) throw new ApiError(409, "profile_patch_empty", "The selected fields do not produce a Google patch.")
  const idempotencyKey = sha256([
    input.session.organisationId,
    live.context.externalLocationId,
    "profile_to_google",
    live.resource.revision,
    live.googleHash,
    sha256(JSON.stringify(patch.payload)),
  ].join(":"))
  const attempt = await withTenant(input.session.organisationId, async (sql) => {
    const [existing] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status from profile_sync_attempt where idempotency_key = ${idempotencyKey} limit 1
    `
    if (existing?.status === "succeeded") return { ...existing, idempotent: true }
    if (existing && ["validating", "validated", "publishing"].includes(existing.status)) {
      throw new ApiError(409, "profile_operation_in_progress", "This profile publish is already in progress.")
    }
    const [row] = existing
      ? await sql<{ id: string; status: string }[]>`
          update profile_sync_attempt set status = 'validating', actor_user_id = ${input.session.userId},
            started_at = now(), finished_at = null, provider_error_code = null
          where id = ${existing.id} returning id::text as id, status
        `
      : await sql<{ id: string; status: string }[]>`
          insert into profile_sync_attempt (
            organisation_id, location_id, external_location_id, actor_user_id,
            operation, direction, status, idempotency_key, pinned_canonical_revision,
            pinned_canonical_hash, pinned_google_hash, selected_fields, update_mask, intended_payload
          ) values (
            ${input.session.organisationId}, ${input.locationId}, ${live.context.externalLocationId},
            ${input.session.userId}, 'publish_google', 'to_google', 'validating', ${idempotencyKey},
            ${live.resource.revision}, ${live.canonicalHash}, ${live.googleHash}, ${selected},
            ${patch.updateMask}, ${sql.json(JSON.parse(JSON.stringify(patch.payload)))}
          ) returning id::text as id, status
        `
    return { ...row, idempotent: false }
  })
  if (attempt.idempotent) return { status: "published" as const, attemptId: attempt.id, idempotent: true }
  let phase: "validating" | "publishing" = "validating"
  try {
    await patchGoogleLocationProfile(live.accessToken, {
      locationName: live.context.googleLocationName,
      updateMask: patch.updateMask,
      validateOnly: true,
      payload: patch.payload,
    }, { connectionKey: live.context.googleConnectionId })
    await withTenant(input.session.organisationId, (sql) => sql`
      update profile_sync_attempt set status = 'publishing', validated_at = now() where id = ${attempt.id}
    `)
    phase = "publishing"
    await patchGoogleLocationProfile(live.accessToken, {
      locationName: live.context.googleLocationName,
      updateMask: patch.updateMask,
      validateOnly: false,
      payload: patch.payload,
    }, { connectionKey: live.context.googleConnectionId })
  } catch (error) {
    await failAttempt({
      organisationId: input.session.organisationId,
      attemptId: attempt.id,
      status: error instanceof GoogleMutationAmbiguousError && phase === "publishing" ? "ambiguous" : "failed",
      code: error instanceof ApiError ? error.code : "google_profile_failed",
    })
    throw error
  }
  const readBack = normalizeGoogleProfile((await getGoogleLocation(
    live.accessToken,
    live.context.googleLocationName,
    [...PROFILE_READ_MASK],
    { connectionKey: live.context.googleConnectionId, maxAttempts: 3 }
  )) as GoogleLocationProfile)
  if (!selected.every((key) => hashProfileValue(live.canonical[key]) === hashProfileValue(readBack[key]))) {
    await failAttempt({ organisationId: input.session.organisationId, attemptId: attempt.id, status: "failed", code: "google_readback_mismatch" })
    throw new ApiError(502, "google_readback_mismatch", "Google accepted the patch but read-back did not match.")
  }
  const readBackHash = hashProfile(readBack)
  await withTenant(input.session.organisationId, async (sql) => {
    await sql`
      update profile_sync_attempt set status = 'succeeded', provider_http_status = 200,
        provider_error_code = null, provider_response_hash = ${readBackHash}, finished_at = now()
      where id = ${attempt.id}
    `
    for (const key of selected) {
      const canonicalHash = hashProfileValue(live.canonical[key])
      const googleHash = hashProfileValue(readBack[key])
      await sql`
        update profile_field_state set status = 'in_sync',
          canonical_value = ${sql.json({ value: live.canonical[key] })},
          google_value = ${sql.json({ value: readBack[key] })},
          canonical_hash = ${canonicalHash}, google_hash = ${googleHash},
          baseline_canonical_hash = ${canonicalHash}, baseline_google_hash = ${googleHash},
          canonical_revision = ${live.resource.revision}, observed_at = now(),
          snapshot_expires_at = now() + interval '30 days', last_reconciled_at = now()
        where organisation_id = ${input.session.organisationId}
          and location_id = ${input.locationId} and field_key = ${key}
      `
    }
    await reconcileCanonicalResource({
      sql,
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      resourceType: "profile",
      canonicalHash: live.canonicalHash,
      googleHash: readBackHash,
    })
    await writeAudit(sql, {
      organisationId: input.session.organisationId,
      actorUserId: input.session.userId,
      action: "profile.publish.succeeded",
      subjectType: "profile_sync_attempt",
      subjectId: attempt.id,
      requestId: input.requestId,
      metadata: { locationId: input.locationId, selectedFields: selected, canonicalRevision: live.resource.revision },
    })
  })
  return { status: "published" as const, attemptId: attempt.id, idempotent: false }
}
