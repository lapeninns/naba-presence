import "server-only"

import type { TransactionSql } from "postgres"

import type {
  GoogleChange,
  GoogleChangesResponse,
  GoogleWatchAlertMode,
  GoogleWatchSettingsInput,
  GoogleWatchSettingsResponse,
  WireWatchedValue,
} from "@/lib/contracts/google-change-watch"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import {
  DEFAULT_PROTECTED_FIELDS,
  WATCHED_FIELDS,
  WATCHED_FIELD_LABELS,
  categoryMovement,
  detectGoogleChanges,
  googleChangeSubjectId,
  hoursFieldMovement,
  planLedger,
  profileFieldMovement,
  type DetectedGoogleChange,
  type FieldObservation,
  type GoogleChangeResolution,
  type GoogleChangeStatus,
  type WatchedField,
  type WatchedValue,
  watchedValueHash,
} from "@/lib/domain/google-change-watch"
import {
  hashHours,
  hoursPartHashes,
  normalizeGoogleHours,
  type GoogleLocationHours,
  type HoursComparisonParts,
  type NormalizedHours,
} from "@/lib/domain/hours"
import {
  hashProfileValue,
  type GoogleLocationProfile,
  type NormalizedProfile,
} from "@/lib/domain/profile"
import { writeAudit } from "@/lib/server/audit"
import { readCanonicalResource } from "@/lib/server/canonical-resources"
import { jsonColumn, withTenant } from "@/lib/server/db"
import { secondApproverSatisfied } from "@/lib/server/authz/approval-policy"
import { readHoursObservation } from "@/lib/server/hours-observations"
import { ApiError } from "@/lib/server/http"
import { queueDeliveries } from "@/lib/server/notifications/evaluate"
import { loadNotificationMembers } from "@/lib/server/notifications/recipients"
import {
  grantsFor,
  isManagerialRole,
  requireLocationAccess,
  requireLocationAction,
} from "@/lib/server/permissions"
import { readObservedGooglePayload } from "@/lib/server/resource-observations"
import type { Session } from "@/lib/server/session"

/**
 * The Google change watch (S5). When a protected listing field changes on
 * Google and moves off the value we last published, it records the change
 * (one listing_google_change row per field and Google value) and alerts the
 * listing's watch recipients. It never writes to Google: "Put ours back" and
 * "Accept Google's" (lib/server/google-change-watch-actions.ts) are decisions
 * a person makes, through the existing reviewed-change paths.
 *
 * Detection is DB-only. It reads the observations the existing Google reads
 * already record (the presence sweep every ten minutes, an editor opening, or
 * "Check Google now"): profile_field_state, the profile and hours observed
 * payloads and their baselines. A field whose observation is missing or no
 * longer matches its stored hash is "not observed" this run and is left as
 * it is.
 */

export const GOOGLE_CHANGE_KIND = "listing_google_changed" as const

/** One detection (or settings save) per listing at a time. */
export const watchLockKey = (locationId: string) =>
  `google-change-watch:${locationId}`

const LOCATION_NOT_FOUND = {
  code: "location_not_found",
  message: "Listing not found.",
}

/**
 * Visibility plus existence: owners and admins are granted every id, so a
 * listing from another organisation (or none) must still answer 404.
 */
async function requireListing(
  sql: TransactionSql,
  session: Session,
  locationId: string
) {
  await requireLocationAccess(sql, session, locationId, LOCATION_NOT_FOUND)
  const [row] = await sql<{ id: string }[]>`
    select id from location
    where id = ${locationId} and organisation_id = ${session.organisationId}
  `
  if (!row)
    throw new ApiError(404, LOCATION_NOT_FOUND.code, LOCATION_NOT_FOUND.message)
}

const PROFILE_FIELDS = ["name", "description", "phone", "website"] as const

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type WatchRow = {
  protectedFields: WatchedField[]
  alertMode: GoogleWatchAlertMode
  categoryBaseline: string | null
  categoryBaselineLabel: string | null
  categoryBaselineAt: Date | null
  updatedAt: Date | null
  updatedBy: string | null
}

const DEFAULT_WATCH: WatchRow = {
  protectedFields: [...DEFAULT_PROTECTED_FIELDS],
  alertMode: "managers",
  categoryBaseline: null,
  categoryBaselineLabel: null,
  categoryBaselineAt: null,
  updatedAt: null,
  updatedBy: null,
}

function knownFields(fields: readonly string[]): WatchedField[] {
  return WATCHED_FIELDS.filter((field) => fields.includes(field))
}

async function loadWatch(
  sql: TransactionSql,
  organisationId: string,
  locationId: string
): Promise<WatchRow & { recipientIds: string[] }> {
  const [row] = await sql<
    (Omit<WatchRow, "protectedFields"> & { protectedFields: string[] })[]
  >`
    select w.protected_fields as "protectedFields", w.alert_mode as "alertMode",
      w.category_baseline as "categoryBaseline",
      w.category_baseline_label as "categoryBaselineLabel",
      w.category_baseline_at as "categoryBaselineAt",
      w.updated_at as "updatedAt", u.display_name as "updatedBy"
    from listing_google_watch w
    left join app_user u on u.id = w.updated_by
    where w.organisation_id = ${organisationId} and w.location_id = ${locationId}
  `
  const recipients = row
    ? await sql<{ userId: string }[]>`
        select user_id::text as "userId" from listing_google_watch_recipient
        where organisation_id = ${organisationId} and location_id = ${locationId}
        order by user_id`
    : []
  return {
    ...(row
      ? { ...row, protectedFields: knownFields(row.protectedFields) }
      : DEFAULT_WATCH),
    recipientIds: recipients.map((recipient) => recipient.userId),
  }
}

/** Everyone in the organisation who can see the listing. */
async function peopleWhoSee(sql: TransactionSql, locationId: string) {
  const members = await loadNotificationMembers(sql)
  return [...members.values()].filter(
    (member) =>
      member.role === "owner" ||
      member.role === "admin" ||
      member.assigned === null ||
      member.assigned.has(locationId)
  )
}

export async function readGoogleWatchSettings(
  session: Session,
  locationId: string
): Promise<GoogleWatchSettingsResponse> {
  return withTenant(session.organisationId, async (sql) => {
    await requireListing(sql, session, locationId)
    const watch = await loadWatch(sql, session.organisationId, locationId)
    const canManage = isManagerialRole(session.role)
    const everyone = await describePeople(sql, locationId)
    // Anyone who can see the listing may see who is alerted about it; only
    // owners and admins get the whole list to choose from.
    const chosen = new Set(
      watch.alertMode === "chosen" ? watch.recipientIds : []
    )
    const people = canManage
      ? everyone
      : everyone.filter((person) => chosen.has(person.userId))
    return {
      settings: {
        protectedFields: watch.protectedFields,
        alertMode: watch.alertMode,
        recipientIds: watch.alertMode === "chosen" ? watch.recipientIds : [],
        updatedAt: watch.updatedAt?.toISOString() ?? null,
        updatedBy: watch.updatedBy,
      },
      canManage,
      people,
    }
  })
}

async function describePeople(sql: TransactionSql, locationId: string) {
  const visible = await peopleWhoSee(sql, locationId)
  if (visible.length === 0) return []
  const rows = await sql<{ userId: string; name: string }[]>`
    select id::text as "userId", coalesce(nullif(display_name, ''), email) as name
    from app_user where id in ${sql(visible.map((member) => member.userId))}`
  const names = new Map(rows.map((row) => [row.userId, row.name]))
  return visible
    .map((member) => ({
      userId: member.userId,
      name: names.get(member.userId) ?? "Unknown person",
      role: member.role,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Saves which fields are protected and who is alerted (owners and admins).
 * Chosen people must be able to see the listing. A field switched off stops
 * being watched: its live change is resolved as unwatched.
 */
export async function updateGoogleWatchSettings(input: {
  session: Session
  locationId: string
  settings: GoogleWatchSettingsInput
  requestId: string
}): Promise<GoogleWatchSettingsResponse> {
  const { session, locationId, settings } = input
  if (!isManagerialRole(session.role)) {
    throw new ApiError(
      403,
      "permission_denied",
      "Only owners and admins can change what is watched on Google."
    )
  }
  const protectedFields = knownFields(settings.protectedFields)
  const recipientIds =
    settings.alertMode === "chosen" ? [...new Set(settings.recipientIds)] : []
  await withTenant(session.organisationId, async (sql) => {
    await requireListing(sql, session, locationId)
    const [location] = await sql<{ id: string }[]>`
      select id::text as id from location
      where id = ${locationId} and organisation_id = ${session.organisationId}
    `
    if (!location) {
      throw new ApiError(
        404,
        LOCATION_NOT_FOUND.code,
        LOCATION_NOT_FOUND.message
      )
    }
    // Not while a detection for this listing runs on the old settings.
    await sql`select pg_advisory_xact_lock(hashtextextended(${watchLockKey(locationId)}, 0))`
    const visible = new Set(
      (await peopleWhoSee(sql, locationId)).map((member) => member.userId)
    )
    if (recipientIds.some((id) => !visible.has(id))) {
      throw new ApiError(
        400,
        "recipient_not_allowed",
        "Some people you chose can no longer see this listing. Remove them and save again."
      )
    }
    await sql`
      insert into listing_google_watch (
        organisation_id, location_id, protected_fields, alert_mode, updated_by
      ) values (
        ${session.organisationId}, ${locationId}, ${protectedFields}::text[],
        ${settings.alertMode}, ${session.userId}
      )
      on conflict (organisation_id, location_id) do update set
        protected_fields = excluded.protected_fields,
        alert_mode = excluded.alert_mode,
        updated_by = excluded.updated_by
    `
    await sql`
      delete from listing_google_watch_recipient
      where organisation_id = ${session.organisationId} and location_id = ${locationId}
    `
    if (recipientIds.length) {
      await sql`
        insert into listing_google_watch_recipient (organisation_id, location_id, user_id)
        select ${session.organisationId}, ${locationId}, unnest(${recipientIds}::uuid[])
      `
    }
    const unwatched = await sql<{ id: string }[]>`
      update listing_google_change
      set status = 'resolved', resolution = 'unwatched', last_seen_at = now()
      where organisation_id = ${session.organisationId}
        and location_id = ${locationId}
        and status in ('open', 'reverting')
        and not (field = any(${protectedFields}::text[]))
      returning id::text as id
    `
    await resolveIncidents(sql, {
      organisationId: session.organisationId,
      locationId,
      changeIds: unwatched.map((row) => row.id),
    })
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "listing.google_watch.updated",
      subjectType: "location",
      subjectId: locationId,
      requestId: input.requestId,
      metadata: {
        protectedFields,
        alertMode: settings.alertMode,
        recipientCount: recipientIds.length,
      },
    })
  })
  return readGoogleWatchSettings(session, locationId)
}

// ---------------------------------------------------------------------------
// Observations (DB only)
// ---------------------------------------------------------------------------

type ProfileFieldRow = {
  fieldKey: (typeof PROFILE_FIELDS)[number]
  googleValue: { value?: string | null } | null
  googleHash: string
  baselineCanonicalHash: string | null
  baselineGoogleHash: string | null
  lastReconciledAt: Date | null
}

type ObservedProfilePayload = { location?: GoogleLocationProfile }
type ObservedHoursPayload = { location?: GoogleLocationHours }

type Observed = {
  observations: FieldObservation[]
  observedFields: WatchedField[]
  /** A new category baseline: first sight, or a category we published since. */
  seedCategory: { name: string; label: string | null; at: Date } | null
}

type PublishedValue = { value: WatchedValue; at: Date }

const MASK_FIELD = {
  title: "name",
  profile: "description",
  phoneNumbers: "phone",
  websiteUri: "website",
  categories: "primaryCategory",
} as const satisfies Record<string, WatchedField>

/**
 * What this app last sent to Google for each business-information field, and
 * when: the newest successful reviewed business-information write per field
 * (the business-information editor, bulk changes, "Put ours back"). Those
 * writes do not move the profile baselines, so without this our own publish
 * would read as Google changing the field.
 */
async function publishedBusinessInfo(
  sql: TransactionSql,
  organisationId: string,
  locationId: string
): Promise<Map<WatchedField, PublishedValue>> {
  const rows = await sql<
    {
      mask: keyof typeof MASK_FIELD
      payload: Record<string, unknown>
      at: Date
    }[]
  >`
    select distinct on (mask) mask, m.requested_payload as payload, m.created_at as at
    from gbp_management_mutation m
    cross join lateral unnest(m.update_mask) as mask
    where m.organisation_id = ${organisationId}
      and m.location_id = ${locationId}
      and m.resource_type = 'business_info'
      and m.status = 'succeeded'
      and mask in ${sql(Object.keys(MASK_FIELD))}
    order by mask, m.created_at desc
  `
  const published = new Map<WatchedField, PublishedValue>()
  for (const row of rows) {
    const payload = (row.payload ?? {}) as {
      title?: string
      profile?: { description?: string }
      phoneNumbers?: { primaryPhone?: string }
      websiteUri?: string
      categories?: { primaryCategory?: { name?: string } }
    }
    const field = MASK_FIELD[row.mask]
    const value: WatchedValue | null =
      field === "name"
        ? { field, value: payload.title ?? null }
        : field === "description"
          ? { field, value: payload.profile?.description ?? null }
          : field === "phone"
            ? { field, value: payload.phoneNumbers?.primaryPhone ?? null }
            : field === "website"
              ? { field, value: payload.websiteUri ?? null }
              : payload.categories?.primaryCategory?.name
                ? {
                    field: "primaryCategory",
                    value: {
                      name: payload.categories.primaryCategory.name,
                      displayName: null,
                    },
                  }
                : null
    if (value) published.set(field, { value, at: new Date(row.at) })
  }
  return published
}

async function profileObservations(
  sql: TransactionSql,
  organisationId: string,
  locationId: string,
  published: Map<WatchedField, PublishedValue>
): Promise<Pick<Observed, "observations" | "observedFields">> {
  const resource = await readCanonicalResource<NormalizedProfile>({
    sql,
    organisationId,
    locationId,
    resourceType: "profile",
  })
  if (!resource) return { observations: [], observedFields: [] }
  const rows = await sql<ProfileFieldRow[]>`
    select field_key as "fieldKey", google_value as "googleValue",
      google_hash as "googleHash",
      baseline_canonical_hash as "baselineCanonicalHash",
      baseline_google_hash as "baselineGoogleHash",
      last_reconciled_at as "lastReconciledAt"
    from profile_field_state
    where organisation_id = ${organisationId} and location_id = ${locationId}
      and field_key in ${sql([...PROFILE_FIELDS])}
  `
  const observations: FieldObservation[] = []
  const observedFields: WatchedField[] = []
  for (const row of rows) {
    const canonical = resource.payload[row.fieldKey] ?? null
    const googleText = row.googleValue?.value ?? null
    // The stored value is what the stored hash was taken from; anything else
    // is a half-written row and is not an observation.
    if (hashProfileValue(googleText) !== row.googleHash) continue
    observedFields.push(row.fieldKey)
    const google: WatchedValue = { field: row.fieldKey, value: googleText }
    const write = published.get(row.fieldKey)
    if (
      write &&
      (!row.lastReconciledAt || write.at > new Date(row.lastReconciledAt))
    ) {
      // A business-information write since the profile's baseline is the
      // value we last published.
      observations.push({
        ours: write.value,
        google,
        movement: {
          googleMoved:
            watchedValueHash(google) !== watchedValueHash(write.value),
          oursMoved: false,
        },
      })
      continue
    }
    observations.push({
      ours: { field: row.fieldKey, value: canonical },
      google,
      movement: profileFieldMovement({
        canonicalHash: hashProfileValue(canonical),
        googleHash: row.googleHash,
        baselineCanonicalHash: row.baselineCanonicalHash,
        baselineGoogleHash: row.baselineGoogleHash,
      }),
    })
  }
  return { observations, observedFields }
}

async function categoryObservation(
  sql: TransactionSql,
  organisationId: string,
  locationId: string,
  watch: WatchRow,
  published: Map<WatchedField, PublishedValue>
): Promise<Pick<Observed, "observations" | "observedFields" | "seedCategory">> {
  const empty = { observations: [], observedFields: [], seedCategory: null }
  const observed = await readObservedGooglePayload(sql, {
    organisationId,
    locationId,
    resource: "profile",
  })
  const location = (observed?.payload as ObservedProfilePayload | null)
    ?.location
  if (!location || observed?.failed) return empty
  const primary = location.categories?.primaryCategory
  const google = primary?.name
    ? { name: primary.name, displayName: primary.displayName ?? null }
    : null
  let baseline = watch.categoryBaseline
  let label = watch.categoryBaselineLabel
  let seedCategory: Observed["seedCategory"] = null
  let seededFromGoogle = false
  const write = published.get("primaryCategory")
  const written =
    write?.value.field === "primaryCategory" ? write.value.value?.name : null
  if (
    written &&
    write &&
    (!watch.categoryBaselineAt || write.at > watch.categoryBaselineAt)
  ) {
    // We published a category since the baseline: that is ours now.
    baseline = written
    label = written === google?.name ? (google?.displayName ?? null) : null
    seedCategory = { name: baseline, label, at: write.at }
  } else if (baseline === null && google) {
    // First sight, nothing published from here: Google's becomes ours,
    // without an alert.
    baseline = google.name
    label = google.displayName
    seedCategory = { name: baseline, label, at: new Date() }
    seededFromGoogle = true
  }
  const { movement } = categoryMovement({
    baseline: seededFromGoogle ? null : baseline,
    google: google?.name ?? null,
  })
  return {
    observations: [
      {
        ours: {
          field: "primaryCategory",
          value: baseline ? { name: baseline, displayName: label } : null,
        },
        google: { field: "primaryCategory", value: google },
        movement,
      },
    ],
    observedFields: ["primaryCategory"],
    seedCategory,
  }
}

/**
 * Our current value of one business-information field, as detection sees
 * it, hashed; null when the listing has none stored. "Put ours back" and
 * "Accept Google's" refuse when it moved since the change was spotted.
 */
export async function currentOursHash(
  sql: TransactionSql,
  input: { organisationId: string; locationId: string; field: WatchedField }
): Promise<string | null> {
  const { organisationId, locationId, field } = input
  const published = await publishedBusinessInfo(sql, organisationId, locationId)
  if (field === "primaryCategory") {
    const watch = await loadWatch(sql, organisationId, locationId)
    const category = await categoryObservation(
      sql,
      organisationId,
      locationId,
      watch,
      published
    )
    const ours = category.observations[0]?.ours
    return ours ? watchedValueHash(ours) : null
  }
  const profile = await profileObservations(
    sql,
    organisationId,
    locationId,
    published
  )
  const ours = profile.observations.find(
    (observation) => observation.ours.field === field
  )?.ours
  return ours ? watchedValueHash(ours) : null
}

async function hoursObservations(
  sql: TransactionSql,
  organisationId: string,
  locationId: string
): Promise<Pick<Observed, "observations" | "observedFields">> {
  const empty = { observations: [], observedFields: [] }
  const [resource, observation] = await Promise.all([
    readCanonicalResource<NormalizedHours>({
      sql,
      organisationId,
      locationId,
      resourceType: "hours",
    }),
    readHoursObservation(sql, { organisationId, locationId }),
  ])
  const location = (observation?.googlePayload as ObservedHoursPayload | null)
    ?.location
  if (!resource || !observation || !location || observation.errorCode) {
    return empty
  }
  const google = normalizeGoogleHours(location)
  // A publish readback moves the hash without a payload: not this one.
  if (hashHours(google) !== observation.googleHash) return empty
  const canonical: NormalizedHours = {
    regular: resource.payload.regular,
    special: resource.payload.special,
    moreHours: resource.payload.moreHours ?? [],
  }
  const canonicalParts = hoursPartHashes(canonical)
  const googleParts = hoursPartHashes(google)
  const whole = {
    canonicalHash: hashHours(canonical),
    googleHash: observation.googleHash,
    baselineCanonicalHash: observation.comparisonCanonicalHash,
    baselineGoogleHash: observation.comparisonGoogleHash,
  }
  const baseline =
    (observation.comparisonParts as HoursComparisonParts | null) ?? null
  const fields = ["regularHours", "specialHours"] as const
  return {
    observedFields: [...fields],
    observations: fields.map((field) => ({
      ours:
        field === "regularHours"
          ? { field, value: canonical.regular }
          : { field, value: canonical.special },
      google:
        field === "regularHours"
          ? { field, value: google.regular }
          : { field, value: google.special },
      movement: hoursFieldMovement({
        field,
        canonicalParts,
        googleParts,
        baseline,
        whole,
      }),
    })),
  }
}

/** Today's date where the listing is, for ignoring special hours that ended. */
export function listingToday(timezone: string | null, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone ?? "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export type WatchOutcome = {
  found: number
  resolved: number
  superseded: number
}

/**
 * Runs the watch for one listing from what is already stored. Call it after
 * a Google read has recorded its observation: the presence sweep, "Check
 * Google now". Never reads or writes Google. The presence sweep
 * (app/api/sync/presence-resources/route.ts) calls it after a location's
 * resources reconcile, in its own try/catch.
 */
export async function watchGoogleChanges(input: {
  organisationId: string
  locationId: string
  now?: Date
}): Promise<WatchOutcome> {
  const now = input.now ?? new Date()
  return withTenant(input.organisationId, (sql) =>
    watchInTransaction(sql, { ...input, now })
  )
}

async function watchInTransaction(
  sql: TransactionSql,
  input: { organisationId: string; locationId: string; now: Date }
): Promise<WatchOutcome> {
  const { organisationId, locationId } = input
  const [location] = await sql<{ name: string; timezone: string | null }[]>`
    select name, timezone from location
    where id = ${locationId} and organisation_id = ${organisationId}
  `
  if (!location) return { found: 0, resolved: 0, superseded: 0 }
  // One detection per listing at a time: two sweeps (or a sweep and a
  // check) must not both insert the same change.
  await sql`select pg_advisory_xact_lock(hashtextextended(${watchLockKey(locationId)}, 0))`
  const watch = await loadWatch(sql, organisationId, locationId)
  const published = await publishedBusinessInfo(sql, organisationId, locationId)
  const [profile, category, hours] = await Promise.all([
    profileObservations(sql, organisationId, locationId, published),
    categoryObservation(sql, organisationId, locationId, watch, published),
    hoursObservations(sql, organisationId, locationId),
  ])
  if (category.seedCategory) {
    await sql`
      insert into listing_google_watch (
        organisation_id, location_id, category_baseline, category_baseline_label,
        category_baseline_at
      ) values (
        ${organisationId}, ${locationId}, ${category.seedCategory.name},
        ${category.seedCategory.label}, ${category.seedCategory.at}
      )
      on conflict (organisation_id, location_id) do update set
        category_baseline = excluded.category_baseline,
        category_baseline_label = excluded.category_baseline_label,
        category_baseline_at = excluded.category_baseline_at
    `
  }
  const detected = detectGoogleChanges({
    protectedFields: watch.protectedFields,
    observations: [
      ...profile.observations,
      ...category.observations,
      ...hours.observations,
    ],
    today: listingToday(location.timezone, input.now),
  })
  await reopenStalledReverts(sql, organisationId, locationId)
  const live = await sql<
    {
      id: string
      field: WatchedField
      googleHash: string
      status: GoogleChangeStatus
      reverted: boolean
    }[]
  >`
    select id::text as id, field, google_hash as "googleHash", status,
      (revert_change_set_id is not null or revert_operation_id is not null) as reverted
    from listing_google_change
    where organisation_id = ${organisationId} and location_id = ${locationId}
      and status in ('open', 'reverting')
    for update
  `
  const plan = planLedger({
    live,
    detected,
    observedFields: [
      ...profile.observedFields,
      ...category.observedFields,
      ...hours.observedFields,
    ],
    protectedFields: watch.protectedFields,
  })
  const reverted = new Set(
    live.filter((row) => row.reverted).map((row) => row.id)
  )
  for (const { id, reason } of plan.resolve) {
    const resolution: GoogleChangeResolution =
      reason === "google_restored" && reverted.has(id) ? "published" : reason
    await sql`
      update listing_google_change
      set status = 'resolved', resolution = ${resolution}, last_seen_at = now()
      where id = ${id}
    `
  }
  if (plan.supersede.length) {
    await sql`
      update listing_google_change set status = 'superseded', last_seen_at = now()
      where id in ${sql(plan.supersede)}
    `
  }
  if (plan.keep.length) {
    await sql`
      update listing_google_change set last_seen_at = now()
      where id in ${sql(plan.keep)}
    `
  }
  await resolveIncidents(sql, {
    organisationId,
    locationId,
    changeIds: [...plan.resolve.map((row) => row.id), ...plan.supersede],
  })
  const inserted: string[] = []
  for (const change of plan.insert) {
    const id = await insertChange(sql, { organisationId, locationId, change })
    inserted.push(id)
    await openAlert(sql, {
      organisationId,
      locationId,
      locationName: location.name,
      changeId: id,
      field: change.field,
      watch,
    })
  }
  if (inserted.length) {
    await writeAudit(sql, {
      organisationId,
      action: "listing.google_change.detected",
      subjectType: "location",
      subjectId: locationId,
      // Field names only: values are listing content, kept on the row.
      metadata: {
        fields: plan.insert.map((change) => change.field),
        changeIds: inserted,
      },
    })
  }
  return {
    found: inserted.length,
    resolved: plan.resolve.length,
    superseded: plan.supersede.length,
  }
}

/**
 * A "Put ours back" that ended without reaching Google (its reviewed change
 * expired unpublished or its publish failed; its change request was
 * rejected, withdrawn, replaced or refused) leaves Google's value live: the
 * change is open again, and its alert (kept open while reverting) still
 * stands.
 */
async function reopenStalledReverts(
  sql: TransactionSql,
  organisationId: string,
  locationId: string
) {
  await sql`
    update listing_google_change c
    set status = 'open', revert_change_set_id = null, revert_operation_id = null,
      decided_by = null, decided_at = null
    where c.organisation_id = ${organisationId} and c.location_id = ${locationId}
      and c.status = 'reverting'
      and (
        exists (
          select 1 from gbp_change_set s
          where s.id = c.revert_change_set_id
            and (
              exists (
                select 1 from gbp_management_mutation m
                where m.change_set_id = s.id and m.status = 'failed'
              )
              or (
                s.approval_expires_at <= now()
                and not exists (
                  select 1 from gbp_management_mutation m where m.change_set_id = s.id
                )
              )
            )
        )
        or exists (
          select 1 from mutation_operation o
          where o.id = c.revert_operation_id and o.state in ('failed', 'rejected')
        )
        -- A decision that claimed the row and never finished (a crash
        -- between the claim and the result).
        or (
          c.revert_change_set_id is null and c.revert_operation_id is null
          and c.decided_at < now() - interval '15 minutes'
        )
      )
  `
}

async function insertChange(
  sql: TransactionSql,
  input: {
    organisationId: string
    locationId: string
    change: DetectedGoogleChange
  }
): Promise<string> {
  const { change } = input
  const [row] = await sql<{ id: string }[]>`
    insert into listing_google_change (
      organisation_id, location_id, field, ours_value, google_value,
      ours_hash, google_hash, local_edits, regular_days, special_dates
    ) values (
      ${input.organisationId}, ${input.locationId}, ${change.field},
      ${jsonColumn(sql, change.ours)}, ${jsonColumn(sql, change.google)},
      ${change.oursHash}, ${change.googleHash}, ${change.localEdits},
      ${change.regularDays}::smallint[], ${change.specialDates}::text[]
    )
    returning id::text as id
  `
  if (!row) throw new Error("listing_google_change insert returned nothing")
  return row.id
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * Opens the change's incident, addressed to the watch's recipients: the
 * people chosen in its settings who can still see the listing, or everyone
 * who can see it. Each person's own notification preferences still decide
 * in-app and email delivery.
 */
async function openAlert(
  sql: TransactionSql,
  input: {
    organisationId: string
    locationId: string
    locationName: string
    changeId: string
    field: WatchedField
    watch: WatchRow & { recipientIds: string[] }
  }
) {
  const members = await peopleWhoSee(sql, input.locationId)
  const visible = members.map((member) => member.userId)
  const managers = members
    .filter((member) => member.role === "owner" || member.role === "admin")
    .map((member) => member.userId)
  const chosen = new Set(input.watch.recipientIds)
  const stillChosen = visible.filter((userId) => chosen.has(userId))
  // Chosen people who can all no longer see the listing would leave the
  // alert with nobody: the owners and admins get it instead.
  const recipients =
    input.watch.alertMode === "chosen" && stillChosen.length > 0
      ? stillChosen
      : input.watch.alertMode === "everyone"
        ? visible
        : managers
  const subjectId = googleChangeSubjectId({
    organisationId: input.organisationId,
    locationId: input.locationId,
    changeId: input.changeId,
  })
  const summary = {
    title: input.locationName,
    locationId: input.locationId,
    changeId: input.changeId,
    field: input.field,
    fieldLabel: WATCHED_FIELD_LABELS[input.field],
  }
  const [incident] = await sql<{ id: string }[]>`
    insert into notification_incident (
      organisation_id, kind, subject_type, subject_id, summary, location_id
    ) values (
      ${input.organisationId}, ${GOOGLE_CHANGE_KIND}, 'google_change', ${subjectId},
      ${sql.json(summary)}, ${input.locationId}
    )
    on conflict (organisation_id, kind, subject_id) where status = 'open'
    do update set last_seen_at = now()
    returning id::text as id
  `
  if (!incident) return
  if (recipients.length) {
    await sql`
      insert into notification_incident_recipient (organisation_id, incident_id, user_id)
      select ${input.organisationId}, ${incident.id}, unnest(${recipients}::uuid[])
      on conflict (incident_id, user_id) do nothing
    `
  }
  await queueDeliveries(sql, input.organisationId, [incident.id])
}

/** Closes the incidents of changes that are no longer waiting for anyone. */
export async function resolveIncidents(
  sql: TransactionSql,
  input: { organisationId: string; locationId: string; changeIds: string[] }
) {
  if (input.changeIds.length === 0) return
  const subjects = input.changeIds.map((changeId) =>
    googleChangeSubjectId({
      organisationId: input.organisationId,
      locationId: input.locationId,
      changeId,
    })
  )
  await sql`
    update notification_incident set status = 'resolved', resolved_at = now()
    where organisation_id = ${input.organisationId}
      and kind = ${GOOGLE_CHANGE_KIND}
      and subject_id in ${sql(subjects)}
      and status = 'open'
  `
}

// ---------------------------------------------------------------------------
// Reading (DB only)
// ---------------------------------------------------------------------------

export type ChangeRow = {
  id: string
  field: WatchedField
  status: GoogleChangeStatus
  resolution: GoogleChangeResolution | null
  oursValue: WatchedValue
  googleValue: WatchedValue
  oursHash: string
  googleHash: string
  localEdits: boolean
  regularDays: number[]
  specialDates: string[]
  detectedAt: Date
  lastSeenAt: Date
  decidedAt: Date | null
  decidedBy: string | null
  revertChangeSetId: string | null
  revertOperationId: string | null
  operationState: string | null
}

export const changeColumns = (sql: TransactionSql) => sql`
  c.id::text as id, c.field, c.status, c.resolution,
  c.ours_value as "oursValue", c.google_value as "googleValue",
  c.ours_hash as "oursHash", c.google_hash as "googleHash",
  c.local_edits as "localEdits", c.regular_days as "regularDays",
  c.special_dates as "specialDates", c.detected_at as "detectedAt",
  c.last_seen_at as "lastSeenAt", c.decided_at as "decidedAt",
  coalesce(nullif(u.display_name, ''), u.email) as "decidedBy",
  c.revert_change_set_id::text as "revertChangeSetId",
  c.revert_operation_id::text as "revertOperationId",
  o.state as "operationState"
`

export const changeJoins = (sql: TransactionSql) => sql`
  left join app_user u on u.id = c.decided_by
  left join mutation_operation o on o.id = c.revert_operation_id
`

type ChangeSetRow = {
  id: string
  locationName: string
  targetResourceName: string
  requestedBy: string
  approvedBy: string | null
  payload: Record<string, unknown>
  payloadHash: string
  baseline: Record<string, unknown>
  baselineHash: string
  updateMask: string[]
  requireTwoPersonApproval: boolean
  approvalExpiresAt: Date
  dispatched: boolean
}

async function loadChangeSets(sql: TransactionSql, ids: string[]) {
  if (ids.length === 0) return new Map<string, ChangeSetRow>()
  const rows = await sql<ChangeSetRow[]>`
    select c.id::text as id, l.name as "locationName",
      c.target_resource_name as "targetResourceName",
      c.requested_by::text as "requestedBy", c.approved_by::text as "approvedBy",
      c.payload, c.payload_hash as "payloadHash", c.baseline,
      c.baseline_hash as "baselineHash", c.update_mask as "updateMask",
      c.require_two_person_approval as "requireTwoPersonApproval",
      c.approval_expires_at as "approvalExpiresAt",
      exists (select 1 from gbp_management_mutation m where m.change_set_id = c.id) as dispatched
    from gbp_change_set c join location l on l.id = c.location_id
    where c.id in ${sql(ids)}
  `
  return new Map(rows.map((row) => [row.id, row]))
}

function projectChangeSet(row: ChangeSetRow, session: Session): GbpChangeSet {
  return {
    id: row.id,
    locationName: row.locationName,
    targetResourceName: row.targetResourceName,
    payloadHash: row.payloadHash,
    baselineHash: row.baselineHash,
    payload: row.payload,
    baseline: row.baseline,
    updateMask: row.updateMask,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    requiresSecondApprover: row.requireTwoPersonApproval,
    canApprove: secondApproverSatisfied(
      row.requireTwoPersonApproval,
      row.requestedBy,
      session.userId
    ),
    expiresAt: row.approvalExpiresAt.toISOString(),
  }
}

export function toWire(
  row: ChangeRow,
  changeSets: Map<string, ChangeSetRow>,
  session: Session,
  canDecide: boolean
): GoogleChange {
  const changeSet = row.revertChangeSetId
    ? changeSets.get(row.revertChangeSetId)
    : undefined
  return {
    id: row.id,
    field: row.field,
    status: row.status,
    resolution: row.resolution,
    ours: row.oursValue as WireWatchedValue,
    google: row.googleValue as WireWatchedValue,
    googleHash: row.googleHash,
    localEdits: row.localEdits,
    regularDays: row.regularDays.map(Number),
    specialDates: row.specialDates,
    detectedAt: row.detectedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy,
    // The reviewed change (its payload and Google baseline) is for the
    // people who may approve and publish it, as the business-information
    // reviews list is; everyone else sees only where it stands.
    revert:
      changeSet && canDecide
        ? {
            kind: "change_set",
            changeSet: projectChangeSet(changeSet, session),
            dispatched: changeSet.dispatched,
          }
        : row.revertOperationId
          ? {
              kind: "change_request",
              operationId: row.revertOperationId,
              outcome: row.operationState ?? "unknown",
            }
          : null,
  }
}

/** Who may put ours back or accept Google's: owners and admins who may publish here. */
export async function canDecideGoogleChanges(
  sql: TransactionSql,
  session: Session,
  locationId: string
) {
  if (!isManagerialRole(session.role)) return false
  const grants = await grantsFor(sql, session, [locationId])
  return grants.get(locationId)?.canPublish ?? false
}

const HISTORY_LIMIT = 20

/** The listing's live changes and recent history. DB only; never reads Google. */
export async function listGoogleChanges(
  session: Session,
  locationId: string
): Promise<GoogleChangesResponse> {
  return withTenant(session.organisationId, async (sql) => {
    await requireListing(sql, session, locationId)
    return readChanges(sql, session, locationId)
  })
}

export async function readChanges(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<GoogleChangesResponse> {
  const rows = await sql<ChangeRow[]>`
    select ${changeColumns(sql)}
    from listing_google_change c
    ${changeJoins(sql)}
    where c.organisation_id = ${session.organisationId} and c.location_id = ${locationId}
    order by
      case c.status when 'open' then 0 when 'reverting' then 1 else 2 end,
      c.detected_at desc, c.id
    limit ${HISTORY_LIMIT + WATCHED_FIELDS.length}
  `
  const changeSets = await loadChangeSets(
    sql,
    rows.flatMap((row) =>
      row.revertChangeSetId ? [row.revertChangeSetId] : []
    )
  )
  const [checked] = await sql<{ lastCheckedAt: Date | null }[]>`
    select case when count(observed_at) = 2 then min(observed_at) end as "lastCheckedAt"
    from presence_resource_reconcile_state
    where organisation_id = ${session.organisationId} and location_id = ${locationId}
      and resource in ('profile', 'hours')
  `
  const canDecide = await canDecideGoogleChanges(sql, session, locationId)
  return {
    changes: rows.map((row) => toWire(row, changeSets, session, canDecide)),
    canDecide,
    lastCheckedAt: checked?.lastCheckedAt?.toISOString() ?? null,
  }
}

/** One change as the wire shows it, inside the caller's tenant transaction. */
export async function readChange(
  sql: TransactionSql,
  session: Session,
  locationId: string,
  changeId: string
): Promise<GoogleChange> {
  const [row] = await sql<ChangeRow[]>`
    select ${changeColumns(sql)}
    from listing_google_change c
    ${changeJoins(sql)}
    where c.organisation_id = ${session.organisationId}
      and c.location_id = ${locationId} and c.id = ${changeId}
  `
  if (!row) {
    throw new ApiError(
      404,
      "google_change_not_found",
      "This change no longer exists. Reload to see the latest."
    )
  }
  const changeSets = await loadChangeSets(
    sql,
    row.revertChangeSetId ? [row.revertChangeSetId] : []
  )
  return toWire(
    row,
    changeSets,
    session,
    await canDecideGoogleChanges(sql, session, locationId)
  )
}

/**
 * The live count for a listing badge, DB only. Visible changes only. The
 * listing overview's `<GoogleChangesBadge>` reads
 * `GET /api/locations/{id}/google-changes` instead; this count is for a
 * board-wide summary, where one GET per listing would be too many.
 */
export async function countOpenGoogleChanges(
  session: Session,
  locationId: string
): Promise<number> {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAction(
      sql,
      session,
      locationId,
      "read",
      LOCATION_NOT_FOUND
    )
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from listing_google_change
      where organisation_id = ${session.organisationId}
        and location_id = ${locationId} and status = 'open'
    `
    return row?.count ?? 0
  })
}
