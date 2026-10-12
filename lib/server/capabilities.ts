import "server-only"

import type { TransactionSql } from "postgres"

import {
  LOCATION_RESOURCE_KEYS,
  type LocationCapabilities,
  type LocationResourceKey,
  type ResourceCapability,
  type ResourceCapabilityState,
  type SettingsCapabilities,
} from "@/lib/contracts/location-capabilities"
import type { ReviewCapabilities } from "@/lib/contracts/reviews"
import { resourceActionCapabilities } from "@/lib/domain/google-resource-catalogue"
import { sessionCanWrite } from "@/lib/server/entitlement-policy"
import {
  type GbpFlags,
  gbpIngestionEnabled,
  gbpWritesEnabled,
  getServerEnv,
} from "@/lib/server/env"
import {
  NO_PAUSES,
  dbPaused,
  effectiveEnabled,
  gbpIngestionScopes,
  gbpWriteScopes,
  type PauseScope,
  type PauseSnapshot,
} from "@/lib/server/pause-controls"
import {
  NO_GRANT,
  actionAllowed,
  grantsFor,
  isManagerialRole,
  type LocationGrant,
} from "@/lib/server/permissions"
import {
  hasPendingListingChanges,
  listingApprovalRequired,
} from "@/lib/server/listing-changes"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import type { Session } from "@/lib/server/session"
import { privacyAccessFromRole } from "@/lib/settings/gating"

// One capability object per review (shape: ReviewCapabilities in
// lib/contracts/reviews.ts). The location rule itself lives ONLY in
// lib/server/permissions.ts (grantsFor); this module just projects it:
//   canPublish         === actionAllowed(role, grant, "publish")
//   canEdit            === actionAllowed(role, grant, "edit")
//   canRequestApproval === actionAllowed(role, grant, "request_approval")
//                        && !canPublish && organisation.approval_required
//   The same actionAllowed the server's requireLocationAction enforces, so a
//   button the UI shows is one the route accepts.
//     (D2: a non-publisher may submit a reply for approval only when the org
//     requires it. Never true for a publisher — see executePublish's
//     `!canPublish && approval_required` routing, lib/server/publishing.ts.)

export async function reviewCapabilitiesForLocations(
  sql: TransactionSql,
  session: Session,
  locationIds: string[]
): Promise<Map<string, ReviewCapabilities>> {
  const unique = [...new Set(locationIds)]
  const result = new Map<string, ReviewCapabilities>()
  if (unique.length === 0) return result

  const [org] = await sql<{ approvalRequired: boolean }[]>`
    select approval_required as "approvalRequired"
    from organisation where id = ${session.organisationId}
  `
  const approvalRequired = org?.approvalRequired ?? false

  // A read-only subscription under central enforcement allows no changes
  // (lib/server/entitlement-policy.ts), so no control is offered.
  const writable = sessionCanWrite(session)
  const grants = await grantsFor(sql, session, unique)
  for (const id of unique) {
    const grant = grants.get(id) ?? NO_GRANT
    const canPublish = writable && actionAllowed(session.role, grant, "publish")
    const canEdit = writable && actionAllowed(session.role, grant, "edit")
    const canRequestApproval =
      writable &&
      actionAllowed(session.role, grant, "request_approval") &&
      !canPublish &&
      approvalRequired
    result.set(id, { canPublish, canEdit, canRequestApproval })
  }
  return result
}

export async function reviewCapabilities(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<ReviewCapabilities> {
  const map = await reviewCapabilitiesForLocations(sql, session, [locationId])
  return (
    map.get(locationId) ?? {
      canPublish: false,
      canEdit: false,
      canRequestApproval: false,
    }
  )
}

// Per-location capabilities for the Locations workspace (spec §3):
//   canEditCanonical === role in {owner, admin}  (the canonical-PUT route gate)
//   canPublish        === canPublishLocation(sql, session, locationId)
//   canEdit / canRequestApproval / canDecideApproval === locationActionCapabilities
//   resources         === per-surface availability for UI gating (Slice 0 manifest)
// The wire shape and the resource-key vocabulary live in
// lib/contracts/location-capabilities.ts; re-exported here for existing
// server-side importers.
export type {
  LocationCapabilities,
  LocationResourceKey,
  ResourceCapability,
  ResourceCapabilityState,
  SettingsCapabilities,
}

// Per-resource write availability, mirroring the per-surface kill switch each
// lib/server module checks at its provider-mutation/ingestion boundary
// (profile/hours/businessInformation/industry/administration are all Google
// Business Information writes), and the operator pause table runGbpWrite
// checks at dispatch (lib/server/pause-controls.ts). A paused surface stays
// visible read-only. An unreadable pause table is not shown as a pause: this
// is a display, and the dispatch gate still refuses (it fails closed).
export function resourceWritesEnabled(
  env: GbpFlags,
  pauses: PauseSnapshot = NO_PAUSES
): Record<LocationResourceKey, boolean> {
  const notPaused = (scopes: readonly PauseScope[]) =>
    scopes.every((scope) =>
      effectiveEnabled(true, dbPaused(pauses, scope), "open")
    )
  const writes = (surface: Parameters<typeof gbpWriteScopes>[0]) =>
    gbpWritesEnabled(env, surface) && notPaused(gbpWriteScopes(surface))
  const profileWrites = writes("profileWrites")
  return {
    profile: profileWrites,
    hours: profileWrites,
    businessInformation: profileWrites,
    industry: profileWrites,
    administration: profileWrites,
    photos: writes("media"),
    posts: writes("posts"),
    menu: writes("foodMenus"),
    booking: writes("placeActions"),
    performance:
      env.PUBLISH_ENABLED &&
      gbpIngestionEnabled(env, "performance") &&
      notPaused(["publish", ...gbpIngestionScopes("performance")]),
  }
}

/**
 * The per-location action flags, projected from the same actionAllowed the
 * post routes enforce through requireLocationAction:
 *   canEdit            -> "edit"  (compose, edit and delete drafts)
 *   canRequestApproval -> "request_approval", for a non-publisher only (a
 *                         publisher's publish goes straight to Google)
 *   canDecideApproval  -> "decide_approval" (approve or reject a request)
 */
export function locationActionCapabilities(
  role: Session["role"],
  grant: LocationGrant
): Pick<
  LocationCapabilities,
  "canEdit" | "canRequestApproval" | "canDecideApproval"
> {
  return {
    canEdit: actionAllowed(role, grant, "edit"),
    canRequestApproval:
      actionAllowed(role, grant, "request_approval") &&
      !actionAllowed(role, grant, "publish"),
    canDecideApproval: actionAllowed(role, grant, "decide_approval"),
  }
}

const NO_RESOURCE_WRITES = Object.fromEntries(
  LOCATION_RESOURCE_KEYS.map((key) => [key, false])
) as Record<LocationResourceKey, boolean>

function buildResources(input: {
  canEditCanonical: boolean
  canPublish: boolean
  linked: boolean
  publishesEnabled: Record<LocationResourceKey, boolean>
  /** Billing holds the organisation read-only: every write surface reads. */
  billingReadOnly?: boolean
}): Record<LocationResourceKey, ResourceCapability> {
  const { canEditCanonical, canPublish, linked, publishesEnabled } = input
  const resources = {} as Record<LocationResourceKey, ResourceCapability>

  for (const key of LOCATION_RESOURCE_KEYS) {
    if (!linked) {
      resources[key] = {
        state: "unavailable",
        reasonCode: "google_location_not_linked",
      }
      continue
    }

    const consoleOnly =
      key === "industry" ||
      key === "administration" ||
      key === "businessInformation"
    if (consoleOnly && !canEditCanonical) {
      resources[key] = {
        state: "unavailable",
        reasonCode: "permission_denied",
      }
      continue
    }

    if (input.billingReadOnly && key !== "performance") {
      resources[key] = { state: "readOnly", reasonCode: "billing_read_only" }
      continue
    }

    if (!publishesEnabled[key]) {
      resources[key] = {
        state:
          canEditCanonical || key === "performance" ? "readOnly" : "blocked",
        reasonCode: "publishing_paused",
      }
      continue
    }

    if (!canPublish && key !== "performance") {
      resources[key] = {
        state: canEditCanonical ? "readOnly" : "blocked",
        reasonCode: "publish_not_allowed",
      }
      continue
    }

    resources[key] = { state: "available" }
  }

  return resources
}

// `pauses` is the pause snapshot the caller loaded before its transaction
// opened: read inside it, an expired cache would wait for a second pooled
// connection while the transaction holds one (lib/server/db.ts).
export async function locationCapabilitiesForIds(
  sql: TransactionSql,
  session: Session,
  locationIds: string[],
  pauses: PauseSnapshot
): Promise<Map<string, LocationCapabilities>> {
  const unique = [...new Set(locationIds)]
  const result = new Map<string, LocationCapabilities>()
  if (unique.length === 0) return result

  const env = getServerEnv()
  const publishesEnabled = resourceWritesEnabled(env, pauses)
  const writable = sessionCanWrite(session)
  const actionWritesEnabled = {
    profileWrites: writable && publishesEnabled.profile,
    media: writable && publishesEnabled.photos,
    posts: writable && publishesEnabled.posts,
    foodMenus: writable && publishesEnabled.menu,
    placeActions: writable && publishesEnabled.booking,
    performance: publishesEnabled.performance,
  }

  const links = await sql<{ locationId: string; connected: boolean }[]>`
    select l.location_id::text as "locationId",
      coalesce(a.is_active and c.status in ('active', 'expired'), false) as connected
    from location_link l
    left join external_location e on e.id = l.external_location_id
    left join google_account a on a.google_connection_id = e.google_connection_id
      and a.google_account_name = e.google_account_name
    left join google_connection c on c.id = e.google_connection_id
    where l.location_id in ${sql(unique)}
      and l.is_active = true
  `
  const linkedIds = new Set(links.map((row) => row.locationId))
  const connectedIds = new Set(links.filter((row) => row.connected).map((row) => row.locationId))
  const canEditCanonical = isManagerialRole(session.role)

  const grants = await grantsFor(sql, session, unique)
  for (const id of unique) {
    const grant = grants.get(id) ?? NO_GRANT
    const { canPublish, visible } = grant
    const actions = locationActionCapabilities(session.role, grant)
    result.set(id, {
      // Role-based even while read-only: it also gates whether the
      // owner/admin tabs load at all (lib/locations/gating.ts
      // gateSatisfied), and read-only access still shows them. Their editors
      // read canWrite (editDisabledReason).
      canEditCanonical,
      canPublish: writable && canPublish,
      canEdit: writable && actions.canEdit,
      canRequestApproval: writable && actions.canRequestApproval,
      canDecideApproval: writable && actions.canDecideApproval,
      canWrite: writable,
      resourceActions: resourceActionCapabilities({
        connected: connectedIds.has(id), canRead: visible, canPublish,
        managerial: canEditCanonical, writesEnabled: actionWritesEnabled,
      }),
      resources: buildResources({
        canEditCanonical,
        canPublish,
        linked: linkedIds.has(id),
        publishesEnabled,
        billingReadOnly: !writable,
      }),
    })
  }
  return result
}

export async function locationCapabilities(
  sql: TransactionSql,
  session: Session,
  locationId: string,
  pauses: PauseSnapshot
): Promise<LocationCapabilities> {
  const map = await locationCapabilitiesForIds(
    sql,
    session,
    [locationId],
    pauses
  )
  // Whether this location's listing writes park for a second publisher --
  // or requests parked before the policy or feature went off still wait
  // here -- so the editors only ask for pending change requests where there
  // can be any, and never lose sight of one that is still pending.
  const listingChangeApprovals =
    (await listingApprovalRequired(sql, session.organisationId)) ||
    (await hasPendingListingChanges(sql, session.organisationId, locationId))
  const found = map.get(locationId)
  if (found) return { ...found, listingChangeApprovals }
  return {
    canEditCanonical: false,
    canPublish: false,
    ...locationActionCapabilities(session.role, NO_GRANT),
    resources: buildResources({
      canEditCanonical: false,
      canPublish: false,
      linked: false,
      publishesEnabled: NO_RESOURCE_WRITES,
    }),
    listingChangeApprovals,
  }
}

// Org/settings capabilities for the Settings workspace (spec §3):
//   canManageTeam/canManageConnections/canEditSettings === role in {owner, admin}
//   privacy === privacyAccessFromRole(role, privacy_settings feature)
//   canWrite === billing allows changes; canEditSettings needs it too
// Pure role predicates that mirror the route guards; the one product switch
// is read by the caller (readSettingsFeatures) and passed in.
export function settingsCapabilities(
  session: Session,
  features: { privacySettings: boolean }
): SettingsCapabilities {
  const managerial = isManagerialRole(session.role)
  const canWrite = sessionCanWrite(session)
  return {
    canManageTeam: managerial,
    canManageConnections: managerial,
    canEditSettings: managerial && canWrite,
    canWrite,
    privacy: privacyAccessFromRole(session.role, features.privacySettings),
  }
}

/**
 * Whether any settings feature switch can change `session`'s capabilities.
 * Every switch gates an owner/admin area, so for anyone else the answer is
 * fixed and callers skip the query (and its transaction) entirely.
 */
export function settingsFeaturesApply(session: Session): boolean {
  return isManagerialRole(session.role)
}

export const NO_SETTINGS_FEATURES = { privacySettings: false } as const

/** The organisation feature switches the settings capabilities read. */
export async function readSettingsFeatures(
  sql: TransactionSql,
  session: Session
): Promise<{ privacySettings: boolean }> {
  return {
    privacySettings: await isOrgFeatureEnabled(
      sql,
      session.organisationId,
      "privacy_settings"
    ),
  }
}
