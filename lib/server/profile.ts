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
import { jsonColumn, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  attemptStore,
  idempotencyKey,
  loadLinkedLocation,
  requireGbpWrite,
  requirePublishGrant,
  runGbpWrite,
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import { getGoogleLocation, patchGoogleLocationProfile } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
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

/**
 * The location context callers see (import-review reads `externalLocationId`
 * off it). A projection of gbp-write's `LinkedLocation`; kept as its own
 * exported name so consumers stay stable.
 */
export type ProfileContext = Pick<
  LinkedLocation,
  | "locationId"
  | "locationName"
  | "externalLocationId"
  | "googleLocationName"
  | "googleConnectionId"
  | "canPublish"
>

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

/** profile_sync_attempt behind the shared AttemptStore interface. */
const profileAttempts = attemptStore({
  table: "profile_sync_attempt",
  columns: {
    httpStatus: "provider_http_status",
    responseHash: "provider_response_hash",
    validatedAt: "validated_at",
    startedAt: "started_at",
  },
})

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
          ${jsonColumn(sql, { value: field.canonicalValue })}, ${jsonColumn(sql, { value: field.googleValue })},
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

async function fetchGoogleProfile(
  linked: LinkedLocation,
  accessToken: string,
  options: { maxAttempts?: number } = {}
) {
  return (await getGoogleLocation(
    accessToken,
    linked.googleLocationName,
    [...PROFILE_READ_MASK],
    { connectionKey: linked.googleConnectionId, ...options }
  )) as GoogleLocationProfile
}

async function readLiveProfile(session: Session, locationId: string) {
  const context = await withTenant(session.organisationId, (sql) =>
    loadLinkedLocation(sql, session, locationId, {
      notLinked: { message: "Link this location to Google before managing its profile." },
    })
  )
  const accessToken = await context.accessToken()
  const googleLocation = await fetchGoogleProfile(context, accessToken)
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

type LiveProfile = Awaited<ReturnType<typeof readLiveProfile>>

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
    googleWritesEnabled: gbpWritesEnabled(getServerEnv(), "profileWrites"),
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

function assertSnapshotFresh(
  live: LiveProfile,
  expected: { expectedCanonicalRevision: string; expectedCanonicalHash: string; expectedGoogleHash: string }
) {
  if (
    live.resource.revision !== expected.expectedCanonicalRevision ||
    live.canonicalHash !== expected.expectedCanonicalHash ||
    live.googleHash !== expected.expectedGoogleHash
  ) throw new ApiError(409, "profile_snapshot_stale", "The profile changed after review. Refresh first.")
}

/**
 * The "other side changed independently" guard shared by import (canonical
 * side dirty) and publish (Google side dirty).
 */
async function assertOverwriteConfirmed(input: {
  session: Session
  locationId: string
  live: LiveProfile
  selected: ProfileFieldKey[]
  dirtyStatuses: readonly string[]
  confirmed: boolean
  error: { code: string; message: string }
}) {
  const stored = await loadStoredStates(input.session.organisationId, input.locationId)
  const comparisons = fieldComparisons({ canonical: input.live.canonical, google: input.live.google, stored })
  const needsConfirmation = comparisons.some(
    (field) => input.selected.includes(field.key) && input.dirtyStatuses.includes(field.status)
  )
  if (needsConfirmation && !input.confirmed) {
    throw new ApiError(409, input.error.code, input.error.message)
  }
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
  assertSnapshotFresh(live, input)
  await assertOverwriteConfirmed({
    session: input.session,
    locationId: input.locationId,
    live,
    selected,
    dirtyStatuses: ["core_dirty", "conflict"],
    confirmed: input.confirmOverwriteCanonicalChanges,
    error: {
      code: "canonical_overwrite_confirmation_required",
      message: "NabaPresence changed independently. Confirm the selected overwrite.",
    },
  })
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

/**
 * Settle-transaction work after a verified publish: the selected fields
 * become in_sync with fresh baselines and the canonical resource records the
 * new Google hash.
 */
async function markFieldsPublished(
  sql: TransactionSql,
  input: {
    organisationId: string
    locationId: string
    live: LiveProfile
    selected: ProfileFieldKey[]
    readback: NormalizedProfile
    readbackHash: string
  }
) {
  for (const key of input.selected) {
    const canonicalHash = hashProfileValue(input.live.canonical[key])
    const googleHash = hashProfileValue(input.readback[key])
    await sql`
      update profile_field_state set status = 'in_sync',
        canonical_value = ${jsonColumn(sql, { value: input.live.canonical[key] })},
        google_value = ${jsonColumn(sql, { value: input.readback[key] })},
        canonical_hash = ${canonicalHash}, google_hash = ${googleHash},
        baseline_canonical_hash = ${canonicalHash}, baseline_google_hash = ${googleHash},
        canonical_revision = ${input.live.resource.revision}, observed_at = now(),
        snapshot_expires_at = now() + interval '30 days', last_reconciled_at = now()
      where organisation_id = ${input.organisationId}
        and location_id = ${input.locationId} and field_key = ${key}
    `
  }
  await reconcileCanonicalResource({
    sql,
    organisationId: input.organisationId,
    locationId: input.locationId,
    resourceType: "profile",
    canonicalHash: input.live.canonicalHash,
    googleHash: input.readbackHash,
  })
}

type PublishProfileInput = {
  session: Session
  locationId: string
  selectedFields: ProfileFieldKey[]
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmOverwriteGoogleChanges: boolean
  requestId: string
}

/** Everything before the write pipeline: gates, snapshot checks and the patch. */
async function prepareProfilePublish(input: PublishProfileInput) {
  requireGbpWrite(getServerEnv(), "profileWrites", {
    status: 409,
    code: "profile_publishing_disabled",
    message: "Profile publishing is currently disabled.",
  })
  const selected = assertSelectedFields(input.selectedFields, "to_google")
  const live = await readLiveProfile(input.session, input.locationId)
  requirePublishGrant(live.context, {
    code: "publish_permission_required",
    message: "You cannot publish this location.",
  })
  assertSnapshotFresh(live, input)
  await assertOverwriteConfirmed({
    session: input.session,
    locationId: input.locationId,
    live,
    selected,
    dirtyStatuses: ["google_dirty", "conflict"],
    confirmed: input.confirmOverwriteGoogleChanges,
    error: {
      code: "profile_overwrite_confirmation_required",
      message: "Google changed independently. Confirm the selected overwrite.",
    },
  })
  const patch = buildGoogleProfilePatch({ canonical: live.canonical, selectedFields: selected })
  if (!patch.updateMask.length) throw new ApiError(409, "profile_patch_empty", "The selected fields do not produce a Google patch.")
  return { selected, live, patch }
}

export async function publishProfileToGoogle(input: PublishProfileInput) {
  const { selected, live, patch } = await prepareProfilePublish(input)
  const organisationId = input.session.organisationId
  const patchGoogle = (validateOnly: boolean) =>
    patchGoogleLocationProfile(live.accessToken, {
      locationName: live.context.googleLocationName,
      updateMask: patch.updateMask,
      validateOnly,
      payload: patch.payload,
    }, { connectionKey: live.context.googleConnectionId })

  const result = await runGbpWrite({
    organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: profileAttempts,
    key: idempotencyKey([
      organisationId,
      live.context.externalLocationId,
      "profile_to_google",
      live.resource.revision,
      live.googleHash,
      sha256(JSON.stringify(patch.payload)),
    ]),
    intent: {
      location_id: input.locationId,
      external_location_id: live.context.externalLocationId,
      operation: "publish_google",
      direction: "to_google",
      pinned_canonical_revision: live.resource.revision,
      pinned_canonical_hash: live.canonicalHash,
      pinned_google_hash: live.googleHash,
      selected_fields: selected,
      update_mask: patch.updateMask,
      intended_payload: (sql: TransactionSql) => jsonColumn(sql, patch.payload),
    },
    inProgress: { code: "profile_operation_in_progress", message: "This profile publish is already in progress." },
    failureCode: "google_profile_failed",
    validate: async () => {
      await patchGoogle(true)
    },
    mutate: () => patchGoogle(false),
    // Profile keeps "fail" for now; hours uses "readback" and convergence on "readback" is intended.
    onAmbiguous: "fail",
    readback: {
      read: async () =>
        normalizeGoogleProfile(await fetchGoogleProfile(live.context, live.accessToken, { maxAttempts: 3 })),
      verify: ({ readback }) =>
        selected.every((key) => hashProfileValue(live.canonical[key]) === hashProfileValue(readback[key])),
      hash: hashProfile,
      mismatch: { code: "google_readback_mismatch", message: "Google accepted the patch but read-back did not match." },
    },
    onSuccess: (sql, ctx) =>
      markFieldsPublished(sql, {
        organisationId,
        locationId: input.locationId,
        live,
        selected,
        readback: ctx.readback as NormalizedProfile,
        readbackHash: ctx.readbackHash as string,
      }),
    audit: (ctx) => ({
      action: "profile.publish.succeeded",
      subjectType: "profile_sync_attempt",
      subjectId: ctx.attemptId,
      metadata: { locationId: input.locationId, selectedFields: selected, canonicalRevision: live.resource.revision },
    }),
  })
  return { status: "published" as const, attemptId: result.attemptId, idempotent: result.idempotent }
}
