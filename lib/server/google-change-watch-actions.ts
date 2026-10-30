import "server-only"

import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"

import type {
  GoogleChangeDecisionInput,
  GoogleChangeDecisionResponse,
} from "@/lib/contracts/google-change-watch"
import { listingChangeParkedResponseSchema } from "@/lib/contracts/listing-changes"
import { publishHoursBodySchema } from "@/lib/contracts/location-hours"
import type { BusinessInformationPayload } from "@/lib/contracts/location-business-information"
import { businessInformationPayloadSchema } from "@/lib/domain/business-information"
import {
  isHoursField,
  upcomingSpecialHours,
  watchedValueHash,
  type WatchedField,
  type WatchedValue,
} from "@/lib/domain/google-change-watch"
import {
  hoursSelectionKeys,
  hoursSelectionMask,
  mergeSelectedHours,
  type HoursSelection,
  type NormalizedHours,
} from "@/lib/domain/hours"
import { hashProfileValue, type NormalizedProfile } from "@/lib/domain/profile"
import { writeAudit } from "@/lib/server/audit"
import {
  loadBusinessInformation,
  previewBusinessInformation,
} from "@/lib/server/business-information"
import {
  readCanonicalResource,
  updateCanonicalResource,
} from "@/lib/server/canonical-resources"
import { withTenant } from "@/lib/server/db"
import {
  canDecideGoogleChanges,
  currentOursHash,
  listingToday,
  readChange,
  resolveIncidents,
  type ChangeRow,
  changeColumns,
  changeJoins,
} from "@/lib/server/google-change-watch"
import { getHoursState, saveCanonicalHours } from "@/lib/server/hours"
import { ApiError } from "@/lib/server/http"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { invalidatePendingListingChanges } from "@/lib/server/listing-changes"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

/**
 * The two decisions on a detected Google change (S5). Neither writes to
 * Google by itself:
 *
 *   "Put ours back"  name, description, phone, website and primary category
 *                    become ONE reviewed business-information change set
 *                    (previewBusinessInformation), bound to the Google read
 *                    it was made from; approving and publishing it is the
 *                    existing path, with the organisation's two-person rule
 *                    and the existing stale-baseline refusals. Hours go
 *                    through the hours publish (submitListingChange
 *                    "hours_publish"), pinned to Google's part hashes: under
 *                    two-person approval it parks for a second person, and a
 *                    Google edit before then makes the dispatch refuse.
 *   "Accept Google's" keeps Google's value as ours: our saved value (and
 *                    its baseline) moves to Google's. Nothing is sent.
 *
 * Only owners and admins who may publish at the listing decide. Every
 * decision names the Google value the person saw; another is a 409.
 */

const LOCATION_NOT_FOUND = {
  code: "location_not_found",
  message: "Listing not found.",
}

const MOVED = () =>
  new ApiError(
    409,
    "google_change_moved",
    "Google changed this field again after it was spotted. Nothing was sent to Google. Check protected fields now, then compare again."
  )

const DECIDED = () =>
  new ApiError(
    409,
    "google_change_decided",
    "Someone has already decided this change. Nothing was sent to Google. Reload to see what they chose."
  )

const OURS_CHANGED = () =>
  new ApiError(
    409,
    "google_change_ours_changed",
    "Your saved value changed after this was spotted. Nothing was sent to Google. Reload to compare again."
  )

const NOTHING_TO_PUT_BACK = () =>
  new ApiError(
    409,
    "google_change_nothing_to_restore",
    "You have no saved value for this field to put back. Nothing was sent to Google. Add it in the listing, then publish it."
  )

const NOTHING_TO_ACCEPT = () =>
  new ApiError(
    409,
    "google_change_nothing_to_accept",
    "Google has no value for this field, so there is nothing to keep. Nothing was changed."
  )

const NOTHING_SAVED = () =>
  new ApiError(
    409,
    "google_change_nothing_saved",
    "This listing has nothing saved here yet. Open it once to load it from Google, then try again."
  )

type Decision = GoogleChangeDecisionInput & {
  session: Session
  locationId: string
  changeId: string
  requestId: string
}

/** Refuses when our value moved since the change was spotted. */
async function requireOursUnchanged(input: Decision, row: ChangeRow) {
  const oursNow = await withTenant(input.session.organisationId, (sql) =>
    currentOursHash(sql, {
      organisationId: input.session.organisationId,
      locationId: input.locationId,
      field: row.field,
    })
  )
  if (oursNow !== row.oursHash) throw OURS_CHANGED()
}

/** Locks the row and checks it is still the open change the person saw. */
async function lockOpenChange(
  sql: TransactionSql,
  input: Decision
): Promise<ChangeRow> {
  const { session, locationId } = input
  await requireLocationAccess(sql, session, locationId, LOCATION_NOT_FOUND)
  if (!(await canDecideGoogleChanges(sql, session, locationId))) {
    throw new ApiError(
      403,
      "publish_not_allowed",
      "Only owners and admins who can publish this listing can decide on changes made on Google."
    )
  }
  const [row] = await sql<ChangeRow[]>`
    select ${changeColumns(sql)}
    from listing_google_change c
    ${changeJoins(sql)}
    where c.organisation_id = ${session.organisationId}
      and c.location_id = ${locationId} and c.id = ${input.changeId}
    for update of c
  `
  if (!row) {
    throw new ApiError(
      404,
      "google_change_not_found",
      "This change no longer exists. Reload to see the latest."
    )
  }
  if (row.status !== "open") throw DECIDED()
  if (row.googleHash !== input.expectedGoogleHash) throw MOVED()
  // Claim it before anything outside this transaction happens (a Google
  // read, a change set, a publish): a second decision now finds it taken.
  // `release` hands it back when the decision fails; a claim that never
  // finishes is reopened by the next detection after 15 minutes.
  await sql`
    update listing_google_change
    set status = 'reverting', decided_by = ${session.userId}, decided_at = now()
    where id = ${row.id}
  `
  return row
}

/** Gives a claimed change back when its decision failed. */
async function release(input: Decision) {
  await withTenant(
    input.session.organisationId,
    (sql) => sql`
    update listing_google_change
    set status = 'open', decided_by = null, decided_at = null
    where organisation_id = ${input.session.organisationId}
      and location_id = ${input.locationId} and id = ${input.changeId}
      and status = 'reverting'
      and revert_change_set_id is null and revert_operation_id is null
  `
  )
}

async function settle(
  sql: TransactionSql,
  input: Decision,
  update: {
    status: "reverting" | "accepted" | "resolved"
    resolution?: "published"
    revertChangeSetId?: string
    revertOperationId?: string
    audit: string
    metadata?: Record<string, unknown>
  }
) {
  const { session, locationId, changeId } = input
  const [row] = await sql<{ field: WatchedField }[]>`
    update listing_google_change set
      status = ${update.status},
      resolution = ${update.resolution ?? null},
      revert_change_set_id = coalesce(${update.revertChangeSetId ?? null}::uuid, revert_change_set_id),
      revert_operation_id = coalesce(${update.revertOperationId ?? null}::uuid, revert_operation_id),
      decided_by = ${session.userId}, decided_at = now()
    where organisation_id = ${session.organisationId}
      and location_id = ${locationId} and id = ${changeId}
      and status = 'reverting'
      and revert_change_set_id is null and revert_operation_id is null
    returning field
  `
  // A detection that ran meanwhile already settled it (Google showed ours,
  // or changed again): what this decision did still stands and is audited.
  const field = row?.field ?? null
  // While ours is only on its way back (a review to approve and publish, a
  // request waiting for a second person), Google's value is still live: the
  // alert stays open until something reaches Google or someone keeps Google's.
  if (update.status !== "reverting") {
    await resolveIncidents(sql, {
      organisationId: session.organisationId,
      locationId,
      changeIds: [changeId],
    })
  }
  await writeAudit(sql, {
    organisationId: session.organisationId,
    actorUserId: session.userId,
    action: update.audit,
    subjectType: "location",
    subjectId: locationId,
    requestId: input.requestId,
    metadata: { changeId, field, ...update.metadata },
  })
}

export async function decideGoogleChange(
  input: Decision
): Promise<GoogleChangeDecisionResponse> {
  const row = await withTenant(input.session.organisationId, (sql) =>
    lockOpenChange(sql, input)
  )
  let outcome: GoogleChangeDecisionResponse["outcome"]
  try {
    outcome =
      input.action === "accept_google"
        ? await acceptGoogles(input, row)
        : isHoursField(row.field)
          ? await putHoursBack(input, row)
          : await putBusinessInfoBack(input, row)
  } catch (error) {
    await release(input)
    throw error
  }
  const change = await withTenant(input.session.organisationId, (sql) =>
    readChange(sql, input.session, input.locationId, input.changeId)
  )
  return { change, outcome }
}

// ---------------------------------------------------------------------------
// Put ours back: business information
// ---------------------------------------------------------------------------

type GoogleLocation = {
  title?: string
  profile?: { description?: string }
  phoneNumbers?: { primaryPhone?: string; additionalPhones?: string[] }
  websiteUri?: string
  categories?: {
    primaryCategory?: { name?: string; displayName?: string }
    additionalCategories?: Array<{ name?: string }>
  }
}

/** Google's value of a business-information field, as the watch compares it. */
function liveValue(
  field: WatchedField,
  location: GoogleLocation
): WatchedValue {
  switch (field) {
    case "name":
      return { field, value: location.title ?? null }
    case "description":
      return { field, value: location.profile?.description ?? null }
    case "phone":
      return { field, value: location.phoneNumbers?.primaryPhone ?? null }
    case "website":
      return { field, value: location.websiteUri ?? null }
    case "primaryCategory": {
      const primary = location.categories?.primaryCategory
      return {
        field,
        value: primary?.name
          ? { name: primary.name, displayName: primary.displayName ?? null }
          : null,
      }
    }
    default:
      throw new Error(`${field} is not a business-information field`)
  }
}

/**
 * The payload and mask that put `ours` back, keeping what Google holds
 * alongside it (additional phones, additional categories).
 */
function restorePayload(
  ours: WatchedValue,
  location: GoogleLocation
): { payload: BusinessInformationPayload; updateMask: string[] } {
  switch (ours.field) {
    case "name":
      if (!ours.value) throw NOTHING_TO_PUT_BACK()
      return { payload: { title: ours.value }, updateMask: ["title"] }
    case "description":
      return {
        payload: { profile: ours.value ? { description: ours.value } : {} },
        updateMask: ["profile"],
      }
    case "phone":
      if (!ours.value) throw NOTHING_TO_PUT_BACK()
      return {
        payload: {
          phoneNumbers: {
            primaryPhone: ours.value,
            additionalPhones: [
              ...(location.phoneNumbers?.additionalPhones ?? []),
            ],
          },
        },
        updateMask: ["phoneNumbers"],
      }
    case "website":
      return {
        payload: { websiteUri: ours.value ?? "" },
        updateMask: ["websiteUri"],
      }
    case "primaryCategory":
      if (!ours.value) throw NOTHING_TO_PUT_BACK()
      return {
        payload: {
          categories: {
            primaryCategory: { name: ours.value.name },
            additionalCategories: (
              location.categories?.additionalCategories ?? []
            )
              .flatMap((category) =>
                category.name ? [{ name: category.name }] : []
              )
              .filter((category) => category.name !== ours.value?.name),
          },
        },
        updateMask: ["categories"],
      }
    default:
      throw new Error(`${ours.field} is not a business-information field`)
  }
}

async function putBusinessInfoBack(
  input: Decision,
  row: ChangeRow
): Promise<GoogleChangeDecisionResponse["outcome"]> {
  await requireOursUnchanged(input, row)
  // A decision reads Google (never a page load): the change set is bound to
  // this read, and the value the person saw must still be Google's.
  const state = await loadBusinessInformation(input.session, input.locationId, {
    refresh: true,
  })
  const location = state.location as GoogleLocation
  if (watchedValueHash(liveValue(row.field, location)) !== row.googleHash) {
    throw MOVED()
  }
  const restore = restorePayload(row.oursValue, location)
  const parsed = businessInformationPayloadSchema.safeParse(restore.payload)
  if (!parsed.success) {
    throw new ApiError(
      409,
      "google_change_restore_invalid",
      "Your saved value can’t be sent to Google as it is. Nothing was sent to Google. Fix it in the listing, then publish it."
    )
  }
  const payload = parsed.data
  const { updateMask } = restore
  const changeSet = await previewBusinessInformation({
    session: input.session,
    locationId: input.locationId,
    payload,
    updateMask,
    expectedGoogleHash: state.locationHash,
    requestId: input.requestId,
  })
  await withTenant(input.session.organisationId, (sql) =>
    settle(sql, input, {
      status: "reverting",
      revertChangeSetId: changeSet.id,
      audit: "listing.google_change.revert_requested",
      metadata: { changeSetId: changeSet.id, updateMask },
    })
  )
  return "review_created"
}

// ---------------------------------------------------------------------------
// Put ours back: hours
// ---------------------------------------------------------------------------

function fieldValue(
  field: "regularHours" | "specialHours",
  hours: NormalizedHours,
  today: string
): WatchedValue {
  return field === "regularHours"
    ? { field, value: hours.regular }
    : { field, value: upcomingSpecialHours(hours.special, today) }
}

function selectionOf(row: ChangeRow): HoursSelection {
  return row.field === "regularHours"
    ? { regularDays: row.regularDays.map(Number) }
    : { specialDates: row.specialDates }
}

async function putHoursBack(
  input: Decision,
  row: ChangeRow
): Promise<GoogleChangeDecisionResponse["outcome"]> {
  const field = row.field as "regularHours" | "specialHours"
  const state = await getHoursState(input.session, input.locationId, {
    refresh: true,
  })
  const today = listingToday(state.location.timezone, new Date())
  if (
    watchedValueHash(fieldValue(field, state.google, today)) !== row.googleHash
  ) {
    throw MOVED()
  }
  if (
    watchedValueHash(fieldValue(field, state.canonical, today)) !== row.oursHash
  ) {
    throw OURS_CHANGED()
  }
  const selection = selectionOf(row)
  const keys = hoursSelectionKeys(selection)
  if (keys.length === 0) throw NOTHING_TO_PUT_BACK()
  const body = publishHoursBodySchema.parse({
    confirmation: "publish_nabapresence_hours_to_google",
    expectedCanonicalRevision: state.canonicalResource.revision,
    expectedCanonicalHash: state.canonicalHash,
    expectedGoogleHash: state.googleHash,
    approvedUpdateMask: hoursSelectionMask(selection),
    confirmOverwriteGoogleChanges: true,
    selection: {
      ...selection,
      expectedGoogleParts: Object.fromEntries(
        keys.map((key) => [key, state.googlePartHashes?.[key] ?? null])
      ),
    },
  })
  const result = await submitListingChange("hours_publish", {
    session: input.session,
    locationId: input.locationId,
    body,
    requestId: input.requestId,
  })
  if (result instanceof NextResponse) {
    const parked = listingChangeParkedResponseSchema.parse(await result.json())
    await withTenant(input.session.organisationId, (sql) =>
      settle(sql, input, {
        status: "reverting",
        revertOperationId: parked.changeRequest.id,
        audit: "listing.google_change.revert_requested",
        metadata: { operationId: parked.changeRequest.id, parts: keys },
      })
    )
    return "awaiting_approval"
  }
  await withTenant(input.session.organisationId, (sql) =>
    settle(sql, input, {
      status: "resolved",
      resolution: "published",
      audit: "listing.google_change.reverted",
      metadata: { parts: keys },
    })
  )
  return "published"
}

// ---------------------------------------------------------------------------
// Accept Google's
// ---------------------------------------------------------------------------

async function acceptGoogles(
  input: Decision,
  row: ChangeRow
): Promise<GoogleChangeDecisionResponse["outcome"]> {
  const { session, locationId } = input
  if (row.field === "regularHours" || row.field === "specialHours") {
    await acceptGoogleHours(input, row)
  } else if (row.field === "primaryCategory") {
    const google = row.googleValue
    if (google.field !== "primaryCategory" || !google.value) {
      throw NOTHING_TO_ACCEPT()
    }
    await withTenant(
      session.organisationId,
      (sql) =>
        sql`
        insert into listing_google_watch (
          organisation_id, location_id, category_baseline,
          category_baseline_label, category_baseline_at
        ) values (
          ${session.organisationId}, ${locationId}, ${google.value!.name},
          ${google.value!.displayName}, now()
        )
        on conflict (organisation_id, location_id) do update set
          category_baseline = excluded.category_baseline,
          category_baseline_label = excluded.category_baseline_label,
          category_baseline_at = excluded.category_baseline_at
      `
    )
  } else {
    await acceptGoogleProfileField(input, row)
  }
  await withTenant(session.organisationId, (sql) =>
    settle(sql, input, {
      status: "accepted",
      audit: "listing.google_change.accepted",
    })
  )
  return "accepted"
}

/**
 * Google's value becomes the saved profile field, with fresh per-field
 * baselines, exactly as accepting a Google suggestion does
 * (lib/server/import-review.ts). Pending profile publishes are withdrawn:
 * they would publish the value this replaced.
 */
async function acceptGoogleProfileField(input: Decision, row: ChangeRow) {
  const { session, locationId } = input
  const field = row.field as "name" | "description" | "phone" | "website"
  await requireOursUnchanged(input, row)
  await withTenant(session.organisationId, async (sql) => {
    const [state] = await sql<
      { googleValue: { value?: string | null } | null }[]
    >`
      select google_value as "googleValue" from profile_field_state
      where organisation_id = ${session.organisationId}
        and location_id = ${locationId} and field_key = ${field}
      for update
    `
    const google = state?.googleValue?.value ?? null
    if (watchedValueHash({ field, value: google }) !== row.googleHash) {
      throw MOVED()
    }
    const resource = await readCanonicalResource<NormalizedProfile>({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "profile",
    })
    if (!resource) throw NOTHING_SAVED()
    const updated = await updateCanonicalResource({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "profile",
      expectedRevision: resource.revision,
      payload: { ...resource.payload, [field]: google },
    })
    const valueHash = hashProfileValue(google)
    await sql`
      update profile_field_state
      set status = 'in_sync',
        canonical_value = ${sql.json({ value: google })},
        canonical_hash = ${valueHash},
        baseline_canonical_hash = ${valueHash},
        baseline_google_hash = ${valueHash},
        canonical_revision = ${updated.revision},
        last_reconciled_at = now(),
        observed_at = now()
      where organisation_id = ${session.organisationId}
        and location_id = ${locationId} and field_key = ${field}
    `
  })
  await invalidatePendingListingChanges({
    organisationId: session.organisationId,
    locationId,
    kinds: ["profile_publish"],
  })
}

/**
 * Google's days or dates become the saved schedule's (a local save, so the
 * hours editor's own rules apply and pending hours publishes are withdrawn).
 * The next observation then finds those parts in line and moves their
 * baselines.
 */
async function acceptGoogleHours(input: Decision, row: ChangeRow) {
  const { session, locationId } = input
  const resource = await withTenant(session.organisationId, (sql) =>
    readCanonicalResource<NormalizedHours>({
      sql,
      organisationId: session.organisationId,
      locationId,
      resourceType: "hours",
    })
  )
  if (!resource) throw NOTHING_SAVED()
  const saved: NormalizedHours = {
    regular: resource.payload.regular,
    special: resource.payload.special,
    moreHours: resource.payload.moreHours ?? [],
  }
  const google = row.googleValue
  const theirs: NormalizedHours = {
    regular: google.field === "regularHours" ? google.value : saved.regular,
    special: google.field === "specialHours" ? google.value : saved.special,
    moreHours: saved.moreHours,
  }
  const selection = selectionOf(row)
  if (hoursSelectionKeys(selection).length === 0) throw NOTHING_TO_ACCEPT()
  // The saved schedule with the selected parts replaced by Google's.
  const hours = mergeSelectedHours({
    canonical: theirs,
    google: saved,
    selection,
  })
  await saveCanonicalHours({
    session,
    locationId,
    expectedCanonicalRevision: resource.revision,
    hours,
    requestId: input.requestId,
  })
}
