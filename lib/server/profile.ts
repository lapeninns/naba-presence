import "server-only"

import type { TransactionSql } from "postgres"
import { additionalPhonesMatch } from "@/lib/domain/business-information"

import {
  buildGoogleProfilePatch,
  hashGoogleProfile,
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
import type { ProfileState } from "@/lib/contracts/location-profile"
import { writeAudit } from "@/lib/server/audit"
import {
  ensureCanonicalResource,
  readCanonicalResource,
  reconcileCanonicalResource,
  updateCanonicalResource,
  type CanonicalResource,
} from "@/lib/server/canonical-resources"
import { sha256 } from "@/lib/server/crypto"
import { assertContentChecks } from "@/lib/server/content-checks"
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
import { withGoogleWriteSession } from "@/lib/server/google-write-session"
import {
  getGoogleLocation,
  patchGoogleLocationProfile,
} from "@/lib/server/google"
import { shouldReadLive } from "@/lib/server/editor-freshness"
import {
  forgetObservedGooglePayload,
  readObservedGooglePayload,
  recordResourceObservation,
} from "@/lib/server/resource-observations"
import { ApiError } from "@/lib/server/http"
import { operationSummary } from "@/lib/server/mutation-operations"
import {
  storeSettle,
  type RecoveryAdapter,
  type RecoveryAttempt,
} from "@/lib/server/mutation-recovery"
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
  /** Google's value hash at the field's latest observation. */
  googleHash: string | null
}

/** The GET response shape is owned by the wire contract; re-exported for server callers. */
export type { ProfileState }

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
  return withTenant(organisationId, (sql) => readStoredStates(sql, locationId))
}

async function readStoredStates(sql: TransactionSql, locationId: string) {
  const rows = await sql<StoredFieldState[]>`
    select field_key as "fieldKey", baseline_canonical_hash as "baselineCanonicalHash",
      baseline_google_hash as "baselineGoogleHash", last_reconciled_at as "lastReconciledAt",
      google_hash as "googleHash"
    from profile_field_state where location_id = ${locationId}
  `
  return new Map(rows.map((row) => [row.fieldKey, row]))
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

async function persistObservedFields(
  sql: TransactionSql,
  input: {
    organisationId: string
    context: ProfileContext
    canonicalRevision: string
    fields: ReturnType<typeof fieldComparisons>
    attemptedAt: Date
  }
) {
  for (const field of input.fields) {
    const establishBaseline = field.status === "in_sync"
    await sql`
      insert into profile_field_state (
        organisation_id, location_id, external_location_id, field_key, policy, status,
        canonical_value, google_value, canonical_hash, google_hash,
        baseline_canonical_hash, baseline_google_hash, canonical_revision, last_reconciled_at, observed_at
      ) values (
        ${input.organisationId}, ${input.context.locationId}, ${input.context.externalLocationId},
        ${field.key}, ${field.policy}, ${field.status},
        ${jsonColumn(sql, { value: field.canonicalValue })}, ${jsonColumn(sql, { value: field.googleValue })},
        ${field.canonicalHash}, ${field.googleHash},
        ${establishBaseline ? field.canonicalHash : null},
        ${establishBaseline ? field.googleHash : null}, ${input.canonicalRevision},
        ${establishBaseline ? new Date() : null}, ${input.attemptedAt}
      ) on conflict (organisation_id, location_id, field_key) do update set
        policy = excluded.policy, status = excluded.status,
        canonical_value = excluded.canonical_value, google_value = excluded.google_value,
        canonical_hash = excluded.canonical_hash, google_hash = excluded.google_hash,
        baseline_canonical_hash = coalesce(profile_field_state.baseline_canonical_hash, excluded.baseline_canonical_hash),
        baseline_google_hash = coalesce(profile_field_state.baseline_google_hash, excluded.baseline_google_hash),
        canonical_revision = excluded.canonical_revision, observed_at = excluded.observed_at,
        snapshot_expires_at = now() + interval '30 days',
        last_reconciled_at = coalesce(profile_field_state.last_reconciled_at, excluded.last_reconciled_at)
      where excluded.observed_at > profile_field_state.observed_at
    `
  }
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

const LINKED_PROFILE_LOCATION = {
  notLinked: {
    message: "Link this location to Google before managing its profile.",
  },
}

async function readLiveProfile(
  session: Session,
  locationId: string,
  /** Already loaded (and authorized) in this request. */
  loaded?: LinkedLocation
) {
  const context =
    loaded ??
    (await withTenant(session.organisationId, (sql) =>
      loadLinkedLocation(sql, session, locationId, LINKED_PROFILE_LOCATION)
    ))
  const attemptedAt = new Date()
  let accessToken: string
  let googleLocation: GoogleLocationProfile
  try {
    accessToken = await context.accessToken()
    googleLocation = await fetchGoogleProfile(context, accessToken)
  } catch (error) {
    await withTenant(session.organisationId, (sql) =>
      recordResourceObservation(sql, {
        organisationId: session.organisationId,
        locationId,
        resource: "profile",
        attemptedAt,
        errorCode:
          error instanceof ApiError ? error.code : "google_profile_read_failed",
      })
    )
    throw error
  }
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
    attemptedAt,
    context,
    accessToken,
    googleLocation,
    google,
    resource,
    canonical,
    canonicalHash: hashProfile(canonical),
    googleHash: hashGoogleProfile(googleLocation, google),
  }
}

type LiveProfile = Awaited<ReturnType<typeof readLiveProfile>>

/**
 * What a successful profile read keeps for the editor (the observation's
 * `observed_google_payload`): Google's location as read, and when.
 */
type ObservedProfilePayload = {
  observedAt: string
  location: GoogleLocationProfile
}

type ProfileReadOptions = {
  /** Read Google now, past the staleness budget. */
  refresh?: boolean
  /** The staleness budget; `Infinity` serves any valid stored read. */
  maxAgeMs?: number
}

type LatestProfileAttempt = {
  id: string
  direction: string
  status: string
  selectedFields: string[]
  createdAt: Date
  finishedAt: Date | null
}

async function latestProfileAttempt(sql: TransactionSql, locationId: string) {
  const [row] = await sql<LatestProfileAttempt[]>`
    select id::text as id, direction, status, selected_fields as "selectedFields",
      created_at as "createdAt", finished_at as "finishedAt"
    from profile_sync_attempt where location_id = ${locationId}
    order by created_at desc limit 1
  `
  return row ?? null
}

/**
 * The editor's profile, served from the latest observation within the
 * staleness budget, read from Google (and recorded) otherwise. Publishing
 * and imports always read Google themselves.
 */
export async function getProfileState(
  session: Session,
  locationId: string,
  options: ProfileReadOptions = {}
): Promise<ProfileState> {
  return (await readProfileStateBundle(session, locationId, options)).state
}

/**
 * Same as getProfileState but also returns the location context, so callers
 * that need external ids (the import-review raiser) avoid a second
 * context+Google round-trip.
 *
 * Within the staleness budget (`readStoredProfile`) this is ONE read-only
 * tenant transaction and no Google call (W0-04, W3-2). A live read (stale,
 * `refresh`, or nothing usable stored) records what it observed, field
 * states and observation together, in one transaction.
 */
export async function readProfileStateBundle(
  session: Session,
  locationId: string,
  options: ProfileReadOptions = {}
): Promise<{ state: ProfileState; context: ProfileContext }> {
  const read = options.refresh
    ? null
    : await readStoredProfile(session, locationId, options.maxAgeMs)
  if (read?.stored) return read.stored
  const live = await readLiveProfile(session, locationId, read?.linked)
  const observed = await withTenant(session.organisationId, async (sql) => {
    const stored = await readStoredStates(sql, locationId)
    const fields = fieldComparisons({
      canonical: live.canonical,
      google: live.google,
      stored,
    })
    await persistObservedFields(sql, {
      organisationId: session.organisationId,
      context: live.context,
      canonicalRevision: live.resource.revision,
      attemptedAt: live.attemptedAt,
      fields,
    })
    await recordResourceObservation(sql, {
      organisationId: session.organisationId,
      locationId,
      resource: "profile",
      attemptedAt: live.attemptedAt,
      googlePayload: {
        observedAt: live.attemptedAt.toISOString(),
        location: live.googleLocation,
      } satisfies ObservedProfilePayload,
    })
    return { fields, attempt: await latestProfileAttempt(sql, locationId) }
  })
  return {
    state: profileState({
      context: live.context,
      resource: live.resource,
      googleLocation: live.googleLocation,
      canonicalHash: live.canonicalHash,
      googleHash: live.googleHash,
      fields: observed.fields,
      latestAttempt: observed.attempt,
      observedAt: live.attemptedAt,
      source: "live",
    }),
    context: live.context,
  }
}

/**
 * The editor's profile from the latest observation, in ONE read-only tenant
 * transaction and no Google call. `stored` is null when Google must be read
 * (the `linked` location loaded here is reused for it):
 *   - no saved profile or observed payload yet, or the payload is past the
 *     budget;
 *   - a read or the sweep failed since (an open retries Google);
 *   - a field's stored Google hash is not the payload's (another writer
 *     changed the field states since), or a field in sync still lacks its
 *     baseline, which only a recorded (live) read establishes.
 * Google writers to the location's profile fields drop the payload
 * (`forgetObservedGooglePayload`), so a later open reads what they left.
 */
async function readStoredProfile(
  session: Session,
  locationId: string,
  maxAgeMs?: number
) {
  return withTenant(session.organisationId, async (sql) => {
    const linked = await loadLinkedLocation(
      sql,
      session,
      locationId,
      LINKED_PROFILE_LOCATION
    )
    const [resource, observation, stored] = await Promise.all([
      readCanonicalResource<NormalizedProfile>({
        sql,
        organisationId: session.organisationId,
        locationId,
        resourceType: "profile",
      }),
      readObservedGooglePayload(sql, {
        organisationId: session.organisationId,
        locationId,
        resource: "profile",
      }),
      readStoredStates(sql, locationId),
    ])
    const payload = observation?.payload as ObservedProfilePayload | null
    if (
      !resource ||
      !observation ||
      observation.failed ||
      !payload?.location ||
      shouldReadLive({ observedAt: payload.observedAt, maxAgeMs })
    )
      return { linked, stored: null }
    const google = normalizeGoogleProfile(payload.location)
    const fields = fieldComparisons({
      canonical: resource.payload,
      google,
      stored,
    })
    const consistent = fields.every((field) => {
      const row = stored.get(field.key)
      return (
        row?.googleHash === field.googleHash &&
        (field.status !== "in_sync" ||
          (row.baselineCanonicalHash !== null &&
            row.baselineGoogleHash !== null))
      )
    })
    if (!consistent) return { linked, stored: null }
    return {
      linked,
      stored: {
        state: profileState({
          context: linked,
          resource,
          googleLocation: payload.location,
          canonicalHash: hashProfile(resource.payload),
          googleHash: hashGoogleProfile(payload.location, google),
          fields,
          latestAttempt: await latestProfileAttempt(sql, locationId),
          observedAt: new Date(payload.observedAt),
          source: "stored",
        }),
        context: linked,
      },
    }
  })
}

function profileState(input: {
  context: ProfileContext
  resource: CanonicalResource<NormalizedProfile>
  googleLocation: GoogleLocationProfile
  canonicalHash: string
  googleHash: string
  fields: ReturnType<typeof fieldComparisons>
  latestAttempt: LatestProfileAttempt | null
  observedAt: Date
  source: ProfileState["source"]
}): ProfileState {
  const { latestAttempt } = input
  const primaryCategory =
    input.googleLocation.categories?.primaryCategory?.displayName ??
    input.googleLocation.categories?.primaryCategory?.name ??
    null
  const additionalCategories =
    input.googleLocation.categories?.additionalCategories?.flatMap(
      (category) => category.displayName ?? category.name ?? []
    ) ?? []
  return {
    location: {
      id: input.context.locationId,
      name: input.context.locationName,
      googleLocationName: input.context.googleLocationName,
    },
    canonicalResource: {
      revision: input.resource.revision,
      updatedAt: input.resource.updatedAt.toISOString(),
    },
    canonicalHash: input.canonicalHash,
    googleHash: input.googleHash,
    canPublish: input.context.canPublish,
    googleWritesEnabled: gbpWritesEnabled(getServerEnv(), "profileWrites"),
    fields: input.fields,
    googleDetails: { primaryCategory, additionalCategories },
    latestAttempt: latestAttempt
      ? {
          ...latestAttempt,
          createdAt: latestAttempt.createdAt.toISOString(),
          finishedAt: latestAttempt.finishedAt?.toISOString() ?? null,
        }
      : null,
    observedAt: input.observedAt.toISOString(),
    source: input.source,
  }
}

function assertSelectedFields(
  selectedFields: ProfileFieldKey[],
  direction: "to_google" | "from_google"
) {
  const selected = [...new Set(selectedFields)]
  if (!selected.length)
    throw new ApiError(
      400,
      "profile_fields_required",
      "Select at least one profile field."
    )
  for (const field of selected) {
    const policy = PROFILE_FIELD_POLICIES[field]
    if (
      policy === "google_read_only" ||
      (direction === "to_google" && policy !== "bidirectional")
    ) {
      throw new ApiError(
        409,
        "profile_field_direction_unsupported",
        `${field} cannot be changed in that direction.`
      )
    }
  }
  return selected
}

function assertSnapshotFresh(
  live: LiveProfile,
  expected: {
    expectedCanonicalRevision: string
    expectedCanonicalHash: string
    expectedGoogleHash: string
  }
) {
  if (
    live.resource.revision !== expected.expectedCanonicalRevision ||
    live.canonicalHash !== expected.expectedCanonicalHash ||
    live.googleHash !== expected.expectedGoogleHash
  )
    throw new ApiError(
      409,
      "profile_snapshot_stale",
      "The profile changed after review. Refresh first."
    )
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
  const stored = await loadStoredStates(
    input.session.organisationId,
    input.locationId
  )
  const comparisons = fieldComparisons({
    canonical: input.live.canonical,
    google: input.live.google,
    stored,
  })
  const needsConfirmation = comparisons.some(
    (field) =>
      input.selected.includes(field.key) &&
      input.dirtyStatuses.includes(field.status)
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
  contentWarningAcknowledgement?: string
  requestId: string
}) {
  // NabaPresence's own copy only: no Google read (a save works while Google
  // is unreachable, as hours does). Publishing reads Google itself.
  const allowed = new Set(
    PROFILE_FIELD_KEYS.filter(
      (key) => PROFILE_FIELD_POLICIES[key] === "bidirectional"
    )
  )
  const updated = await withTenant(
    input.session.organisationId,
    async (sql) => {
      const linked = await loadLinkedLocation(
        sql,
        input.session,
        input.locationId,
        LINKED_PROFILE_LOCATION
      )
      if (!linked.canPublish)
        throw new ApiError(
          403,
          "canonical_edit_permission_required",
          "You cannot edit this location."
        )
      const current = await readCanonicalResource<NormalizedProfile>({
        sql,
        organisationId: input.session.organisationId,
        locationId: input.locationId,
        resourceType: "profile",
      })
      if (current?.revision !== input.expectedCanonicalRevision) {
        throw new ApiError(
          409,
          "canonical_resource_stale",
          "The profile changed after it was loaded."
        )
      }
      const canonical = { ...current.payload }
      for (const [key, value] of Object.entries(input.values) as Array<
        [ProfileFieldKey, string | null]
      >) {
        if (allowed.has(key))
          canonical[key] =
            typeof value === "string" ? value.trim() || null : null
      }
      if (Object.hasOwn(input.values, "description")) {
        await assertContentChecks(sql, {
          kind: "description",
          body: canonical.description ?? "",
          contentWarningAcknowledgement: input.contentWarningAcknowledgement,
        })
      }
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
        metadata: {
          revision: resource.revision,
          fields: Object.keys(input.values),
        },
      })
      return resource
    }
  )
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
  if (!live.context.canPublish)
    throw new ApiError(
      403,
      "canonical_edit_permission_required",
      "You cannot edit this location."
    )
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
      message:
        "NabaPresence changed independently. Confirm the selected overwrite.",
    },
  })
  const canonical = { ...live.canonical }
  for (const field of selected) canonical[field] = live.google[field]
  const updated = await withTenant(
    input.session.organisationId,
    async (sql) => {
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
    }
  )
  return {
    status: "imported" as const,
    revision: updated.revision,
    idempotent: false,
  }
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
  contentWarningAcknowledgement?: string
  session: Session
  locationId: string
  selectedFields: ProfileFieldKey[]
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  confirmOverwriteGoogleChanges: boolean
  requestId: string
  /**
   * Epoch ms by which the Google sequence must end (a request deadline);
   * absent, the write session derives one from the route's maxDuration.
   */
  deadline?: number
}

const PROFILE_PUBLISHING_DISABLED = {
  status: 409,
  code: "profile_publishing_disabled",
  message: "Profile publishing is currently disabled.",
}

/** Everything before the write pipeline: gates, snapshot checks and the patch. */
async function prepareProfilePublish(input: PublishProfileInput) {
  requireGbpWrite(getServerEnv(), "profileWrites", PROFILE_PUBLISHING_DISABLED)
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
  if (selected.includes("phone") && !live.canonical.phone) {
    throw new ApiError(
      422,
      "primary_phone_required",
      "Google requires a primary phone number. Set a primary number before publishing phone changes."
    )
  }
  const patch = buildGoogleProfilePatch({
    canonical: live.canonical,
    selectedFields: selected,
    googlePhoneNumbers: live.googleLocation.phoneNumbers,
  })
  if (!patch.updateMask.length)
    throw new ApiError(
      409,
      "profile_patch_empty",
      "The selected fields do not produce a Google patch."
    )
  return { selected, live, patch }
}

/**
 * Publishes the selected canonical fields. The live read, the snapshot and
 * overwrite checks, the PATCH and its readback all run under the location's
 * business-information lock (`<org>:<location>:business_info`), the key the
 * business-information editor and bulk business-information and category
 * children take (lib/server/bulk-listing-runner.ts): a bulk website or
 * description write cannot land between this publish's read and its PATCH,
 * and this publish waits for a running bulk child (up to the write session's
 * lock budget, then 409 `google_write_busy`), then reads what it left.
 */
export async function publishProfileToGoogle(input: PublishProfileInput) {
  return withGoogleWriteSession(
    {
      surface: "profile",
      keys: [
        `${input.session.organisationId}:${input.locationId}:business_info`,
      ],
      deadline: input.deadline,
    },
    () => publishProfileLocked(input)
  )
}

async function publishProfileLocked(input: PublishProfileInput) {
  const { selected, live, patch } = await prepareProfilePublish(input)
  if (selected.includes("description")) {
    await withTenant(input.session.organisationId, (sql) =>
      assertContentChecks(sql, {
        kind: "description",
        body: live.canonical.description ?? "",
        contentWarningAcknowledgement: input.contentWarningAcknowledgement,
      })
    )
  }
  // Whatever the write's outcome, the stored read predates it; a verified
  // success records its readback as the new one (onSuccess).
  await forgetObservedGooglePayload({
    organisationId: input.session.organisationId,
    locationId: input.locationId,
    // The business-information editor shows the same location fields.
    resources: ["profile", "businessInformation"],
  })
  const organisationId = input.session.organisationId
  const patchGoogle = (validateOnly: boolean) =>
    patchGoogleLocationProfile(
      live.accessToken,
      {
        locationName: live.context.googleLocationName,
        updateMask: patch.updateMask,
        validateOnly,
        payload: patch.payload,
      },
      { connectionKey: live.context.googleConnectionId }
    )

  const result = await runGbpWrite({
    surface: "profileWrites",
    paused: PROFILE_PUBLISHING_DISABLED,
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
    inProgress: {
      code: "profile_operation_in_progress",
      message: "This profile publish is already in progress.",
    },
    failureCode: "google_profile_failed",
    operation: {
      surface: "profile",
      action: "publish",
      locationId: input.locationId,
      targetType: "location",
      targetRef: live.context.googleLocationName,
      payloadHash: idempotencyKey([
        selected,
        sha256(JSON.stringify(patch.payload)),
      ]),
      expectedRevision: live.resource.revision,
      googleConnectionId: live.context.googleConnectionId,
    },
    validate: async () => {
      await patchGoogle(true)
    },
    mutate: async () => {
      if (selected.includes("description")) {
        await withTenant(organisationId, (sql) =>
          assertContentChecks(sql, {
            kind: "description",
            body: live.canonical.description ?? "",
            contentWarningAcknowledgement: input.contentWarningAcknowledgement,
          })
        )
      }
      return patchGoogle(false)
    },
    // An ambiguous PATCH is settled by the field-hash readback below, as hours
    // does: a match proves it landed, a mismatch that it did not.
    onAmbiguous: "readback",
    readback: {
      read: async () => {
        const location = await fetchGoogleProfile(
          live.context,
          live.accessToken,
          { maxAttempts: 3 }
        )
        return { location, profile: normalizeGoogleProfile(location) }
      },
      verify: ({ readback }) =>
        selected.every(
          (key) =>
            hashProfileValue(live.canonical[key]) ===
            hashProfileValue(readback.profile[key])
        ) &&
        (!selected.includes("phone") ||
          additionalPhonesMatch(
            readback.location.phoneNumbers?.additionalPhones,
            live.googleLocation.phoneNumbers?.additionalPhones ?? []
          )),
      hash: (readback) =>
        hashGoogleProfile(readback.location, readback.profile),
      mismatch: {
        code: "google_readback_mismatch",
        message: "Google accepted the patch but read-back did not match.",
      },
    },
    onSuccess: async (sql, ctx) => {
      if (!ctx.readback)
        throw new Error("Profile publication requires independent readback.")
      await markFieldsPublished(sql, {
        organisationId,
        locationId: input.locationId,
        live,
        selected,
        readback: ctx.readback.profile,
        readbackHash: ctx.readbackHash as string,
      })
      // The readback is a full profile read: the editor's next open is
      // served from it instead of reading Google a third time.
      const observedAt = new Date()
      await recordResourceObservation(sql, {
        organisationId,
        locationId: input.locationId,
        resource: "profile",
        attemptedAt: observedAt,
        googlePayload: {
          observedAt: observedAt.toISOString(),
          location: ctx.readback.location,
        } satisfies ObservedProfilePayload,
      })
    },
    audit: (ctx) => ({
      action: "profile.publish.succeeded",
      subjectType: "profile_sync_attempt",
      subjectId: ctx.attemptId,
      metadata: {
        locationId: input.locationId,
        selectedFields: selected,
        canonicalRevision: live.resource.revision,
      },
    }),
  })
  return {
    status: "published" as const,
    attemptId: result.attemptId,
    idempotent: result.idempotent,
    operation: operationSummary(result),
  }
}

// ---------------------------------------------------------------------------
// Recovery (lib/server/mutation-recovery.ts)
// ---------------------------------------------------------------------------

type ProfileRecoveryAttempt = RecoveryAttempt & {
  externalLocationId: string
  direction: string
  selectedFields: ProfileFieldKey[]
  updateMask: string[]
  intendedPayload: GoogleLocationProfile
}

/** The Google mask entry each publishable field is written under. */
const PROFILE_FIELD_MASK: Partial<Record<ProfileFieldKey, string>> = {
  name: "title",
  description: "profile",
  phone: "phoneNumbers",
  website: "websiteUri",
}

/**
 * Reads an uncertain profile publish back field by field, as the publish's
 * own readback does: every selected field the patch wrote must hash equal
 * to the value the recorded payload carried, after the same normalisation.
 */
export const profileRecoveryAdapter: RecoveryAdapter<ProfileRecoveryAttempt> = {
  surface: "profile",
  attemptTable: "profile_sync_attempt",
  async load(sql, attemptId) {
    const [row] = await sql<ProfileRecoveryAttempt[]>`
      select
        id::text as id,
        status as "rawStatus",
        started_at as "startedAt",
        provider_error_code as "errorCode",
        external_location_id::text as "externalLocationId",
        direction,
        selected_fields as "selectedFields",
        update_mask as "updateMask",
        intended_payload as "intendedPayload"
      from profile_sync_attempt
      where id = ${attemptId}
    `
    return row ?? null
  },
  async readback({ attempt, link }) {
    const written = attempt.selectedFields.filter((key) => {
      const mask = PROFILE_FIELD_MASK[key]
      return mask !== undefined && attempt.updateMask.includes(mask)
    })
    // Nothing a readback can compare: not a publish, or no selected field
    // the patch wrote.
    if (attempt.direction !== "to_google" || written.length === 0) {
      return { kind: "unverifiable", errorCode: "recovery_unsupported" }
    }
    if (attempt.externalLocationId !== link.externalLocationId) {
      return { kind: "unverifiable", errorCode: "target_changed" }
    }
    const location = await fetchGoogleProfile(link, await link.accessToken(), {
      maxAttempts: 3,
    })
    const readback = normalizeGoogleProfile(location)
    const intended = normalizeGoogleProfile(attempt.intendedPayload)
    // As the publish's own readback: a phone write also carries the
    // additional numbers it preserved, which must read back unchanged.
    const landed =
      written.every(
        (key) =>
          hashProfileValue(intended[key]) === hashProfileValue(readback[key])
      ) &&
      (!written.includes("phone") ||
        additionalPhonesMatch(
          location.phoneNumbers?.additionalPhones,
          attempt.intendedPayload.phoneNumbers?.additionalPhones ?? []
        ))
    return landed
      ? {
          kind: "landed",
          confirmed: true,
          responseHash: hashGoogleProfile(location, readback),
        }
      : { kind: "not_landed", errorCode: "google_readback_mismatch" }
  },
  settle: storeSettle(profileAttempts),
}
