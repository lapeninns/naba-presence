import "server-only"

import type { TransactionSql } from "postgres"

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
export type LocationCapabilities = { canEditCanonical: boolean; canPublish: boolean }

export async function locationCapabilitiesForIds(
  sql: TransactionSql,
  session: Session,
  locationIds: string[]
): Promise<Map<string, LocationCapabilities>> {
  const unique = [...new Set(locationIds)]
  const result = new Map<string, LocationCapabilities>()
  if (unique.length === 0) return result

  if (session.role === "owner" || session.role === "admin") {
    for (const id of unique) {
      result.set(id, { canEditCanonical: true, canPublish: true })
    }
    return result
  }
  if (session.role === "viewer") {
    for (const id of unique) {
      result.set(id, { canEditCanonical: false, canPublish: false })
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
    result.set(id, { canEditCanonical: false, canPublish })
  }
  return result
}

export async function locationCapabilities(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<LocationCapabilities> {
  const map = await locationCapabilitiesForIds(sql, session, [locationId])
  return map.get(locationId) ?? { canEditCanonical: false, canPublish: false }
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
