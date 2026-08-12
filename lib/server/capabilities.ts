import "server-only"

import type { TransactionSql } from "postgres"

import { getServerEnv } from "@/lib/server/env"
import type { Session } from "@/lib/server/session"

// One capability object per review, mirroring lib/server/permissions.ts
// exactly:
//   canPublish         === canPublishLocation(sql, session, locationId)
//   canEdit            === (role !== 'viewer') && requireLocationAccess would pass
//   canRequestApproval === canEdit && !canPublish && organisation.approval_required
//     (D2: a non-publisher may submit a reply for approval only when the org
//     requires it. Never true for a publisher — see executePublish's
//     `!canPublish && approval_required` routing, lib/server/publishing.ts.)
export type ReviewCapabilities = {
  canPublish: boolean
  canEdit: boolean
  canRequestApproval: boolean
}

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

  if (session.role === "owner" || session.role === "admin") {
    for (const id of unique) {
      result.set(id, { canPublish: true, canEdit: true, canRequestApproval: false })
    }
    return result
  }
  if (session.role === "viewer") {
    for (const id of unique) {
      result.set(id, { canPublish: false, canEdit: false, canRequestApproval: false })
    }
    return result
  }

  // member: mirror locationGrant/canPublishLocation/requireLocationAccess.
  const [assignmentScope] = await sql<{ hasAssignments: boolean }[]>`
    select exists (
      select 1 from location_member where user_id = ${session.userId}
    ) as "hasAssignments"
  `
  const hasAssignments = assignmentScope.hasAssignments
  const grants = hasAssignments
    ? await sql<{ locationId: string; canPublish: boolean }[]>`
        select
          location_id::text as "locationId",
          can_publish as "canPublish"
        from location_member
        where user_id = ${session.userId}
          and location_id in ${sql(unique)}
      `
    : []
  const grantByLocation = new Map(
    grants.map((grant) => [grant.locationId, grant.canPublish])
  )
  for (const id of unique) {
    const assigned = grantByLocation.has(id)
    const canPublish = hasAssignments
      ? assigned
        ? (grantByLocation.get(id) ?? false)
        : false
      : session.canPublish
    const canEdit = hasAssignments ? assigned : true
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
export type ResourceCapabilityState =
  | "available"
  | "readOnly"
  | "blocked"
  | "unavailable"

export type ResourceCapability = {
  state: ResourceCapabilityState
  reasonCode?: string
}

export type LocationResourceKey =
  | "profile"
  | "hours"
  | "businessInformation"
  | "photos"
  | "posts"
  | "menu"
  | "booking"
  | "performance"
  | "industry"
  | "administration"

export type LocationCapabilities = {
  canEditCanonical: boolean
  canPublish: boolean
  resources: Record<LocationResourceKey, ResourceCapability>
}

const RESOURCE_KEYS: LocationResourceKey[] = [
  "profile",
  "hours",
  "businessInformation",
  "photos",
  "posts",
  "menu",
  "booking",
  "performance",
  "industry",
  "administration",
]

function buildResources(input: {
  canEditCanonical: boolean
  canPublish: boolean
  linked: boolean
  publishesEnabled: boolean
}): Record<LocationResourceKey, ResourceCapability> {
  const { canEditCanonical, canPublish, linked, publishesEnabled } = input
  const resources = {} as Record<LocationResourceKey, ResourceCapability>

  for (const key of RESOURCE_KEYS) {
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

    if (!publishesEnabled) {
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

  const publishesEnabled = getServerEnv().PUBLISH_ENABLED

  const links = await sql<{ locationId: string }[]>`
    select location_id::text as "locationId"
    from location_link
    where location_id in ${sql(unique)}
      and is_active = true
  `
  const linkedIds = new Set(links.map((row) => row.locationId))

  if (session.role === "owner" || session.role === "admin") {
    for (const id of unique) {
      result.set(id, {
        canEditCanonical: true,
        canPublish: true,
        resources: buildResources({
          canEditCanonical: true,
          canPublish: true,
          linked: linkedIds.has(id),
          publishesEnabled,
        }),
      })
    }
    return result
  }
  if (session.role === "viewer") {
    for (const id of unique) {
      result.set(id, {
        canEditCanonical: false,
        canPublish: false,
        resources: buildResources({
          canEditCanonical: false,
          canPublish: false,
          linked: linkedIds.has(id),
          publishesEnabled,
        }),
      })
    }
    return result
  }

  // member: mirror locationGrant/canPublishLocation exactly.
  const [assignmentScope] = await sql<{ hasAssignments: boolean }[]>`
    select exists (
      select 1 from location_member where user_id = ${session.userId}
    ) as "hasAssignments"
  `
  const hasAssignments = assignmentScope.hasAssignments
  const grants = hasAssignments
    ? await sql<{ locationId: string; canPublish: boolean }[]>`
        select
          location_id::text as "locationId",
          can_publish as "canPublish"
        from location_member
        where user_id = ${session.userId}
          and location_id in ${sql(unique)}
      `
    : []
  const grantByLocation = new Map(
    grants.map((grant) => [grant.locationId, grant.canPublish])
  )
  for (const id of unique) {
    const assigned = grantByLocation.has(id)
    const canPublish = hasAssignments
      ? assigned
        ? (grantByLocation.get(id) ?? false)
        : false
      : session.canPublish
    result.set(id, {
      canEditCanonical: false,
      canPublish,
      resources: buildResources({
        canEditCanonical: false,
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
        publishesEnabled: false,
      }),
    }
  )
}

// Org/settings capabilities for the Settings workspace (spec §3):
//   canManageTeam/canManageConnections/canEditSettings/canViewCompliance === role in {owner, admin}
//   canManageCompliance === role === "owner"
// Pure role predicates that mirror the route guards; no SQL.
export type SettingsCapabilities = {
  canManageTeam: boolean
  canManageConnections: boolean
  canEditSettings: boolean
  canViewCompliance: boolean
  canManageCompliance: boolean
}

export function settingsCapabilities(session: Session): SettingsCapabilities {
  const managerial = session.role === "owner" || session.role === "admin"
  return {
    canManageTeam: managerial,
    canManageConnections: managerial,
    canEditSettings: managerial,
    canViewCompliance: managerial,
    canManageCompliance: session.role === "owner",
  }
}
