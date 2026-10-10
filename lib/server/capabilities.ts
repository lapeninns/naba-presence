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
import {
  type GbpFlags,
  gbpIngestionEnabled,
  gbpWritesEnabled,
  getServerEnv,
} from "@/lib/server/env"
import {
  NO_GRANT,
  grantsFor,
  isManagerialRole,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

// One capability object per review (shape: ReviewCapabilities in
// lib/contracts/reviews.ts). The location rule itself lives ONLY in
// lib/server/permissions.ts (grantsFor); this module just projects it:
//   canPublish         === grant.canPublish (canPublishLocation)
//   canEdit            === grant.canEdit    (visible && role !== 'viewer')
//   canRequestApproval === canEdit && !canPublish && organisation.approval_required
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

  const grants = await grantsFor(sql, session, unique)
  for (const id of unique) {
    const { canEdit, canPublish } = grants.get(id) ?? NO_GRANT
    const canRequestApproval = canEdit && !canPublish && approvalRequired
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
// Business Information writes). A paused surface stays visible read-only.
export function resourceWritesEnabled(
  env: GbpFlags
): Record<LocationResourceKey, boolean> {
  const profileWrites = gbpWritesEnabled(env, "profileWrites")
  return {
    profile: profileWrites,
    hours: profileWrites,
    businessInformation: profileWrites,
    industry: profileWrites,
    administration: profileWrites,
    photos: gbpWritesEnabled(env, "media"),
    posts: gbpWritesEnabled(env, "posts"),
    menu: gbpWritesEnabled(env, "foodMenus"),
    booking: gbpWritesEnabled(env, "placeActions"),
    performance:
      env.PUBLISH_ENABLED && gbpIngestionEnabled(env, "performance"),
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
      key === "industry" || key === "administration" || key === "businessInformation"
    if (consoleOnly && !canEditCanonical) {
      resources[key] = {
        state: "unavailable",
        reasonCode: "permission_denied",
      }
      continue
    }

    if (!publishesEnabled[key]) {
      resources[key] = {
        state: canEditCanonical || key === "performance" ? "readOnly" : "blocked",
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

export async function locationCapabilitiesForIds(
  sql: TransactionSql,
  session: Session,
  locationIds: string[]
): Promise<Map<string, LocationCapabilities>> {
  const unique = [...new Set(locationIds)]
  const result = new Map<string, LocationCapabilities>()
  if (unique.length === 0) return result

  const env = getServerEnv()
  const publishesEnabled = resourceWritesEnabled(env)
  const actionWritesEnabled = {
    profileWrites: publishesEnabled.profile,
    media: publishesEnabled.photos,
    posts: publishesEnabled.posts,
    foodMenus: publishesEnabled.menu,
    placeActions: publishesEnabled.booking,
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
    const { canPublish, visible } = grants.get(id) ?? NO_GRANT
    result.set(id, {
      canEditCanonical,
      canPublish,
      resourceActions: resourceActionCapabilities({
        connected: connectedIds.has(id), canRead: visible, canPublish,
        managerial: canEditCanonical, writesEnabled: actionWritesEnabled,
      }),
      resources: buildResources({
        canEditCanonical,
        canPublish,
        linked: linkedIds.has(id),
        publishesEnabled,
      }),
    })
  }
  return result
}

export async function locationCapabilities(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<LocationCapabilities> {
  const map = await locationCapabilitiesForIds(sql, session, [locationId])
  return (
    map.get(locationId) ?? {
      canEditCanonical: false,
      canPublish: false,
      resources: buildResources({
        canEditCanonical: false,
        canPublish: false,
        linked: false,
        publishesEnabled: NO_RESOURCE_WRITES,
      }),
    }
  )
}

// Org/settings capabilities for the Settings workspace (spec §3):
//   canManageTeam/canManageConnections/canEditSettings === role in {owner, admin}
// Pure role predicates that mirror the route guards; no SQL.
export function settingsCapabilities(session: Session): SettingsCapabilities {
  const managerial = isManagerialRole(session.role)
  return {
    canManageTeam: managerial,
    canManageConnections: managerial,
    canEditSettings: managerial,
  }
}
