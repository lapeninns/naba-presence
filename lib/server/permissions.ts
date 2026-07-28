import "server-only"

import type { TransactionSql } from "postgres"

import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

async function locationGrant(
  sql: TransactionSql,
  session: Session,
  locationId: string
) {
  const [scope] = await sql<
    { hasAssignments: boolean; assigned: boolean; canPublish: boolean }[]
  >`
    select
      exists (
        select 1 from location_member
        where user_id = ${session.userId}
      ) as "hasAssignments",
      exists (
        select 1 from location_member
        where user_id = ${session.userId}
          and location_id = ${locationId}
      ) as assigned,
      exists (
        select 1 from location_member
        where user_id = ${session.userId}
          and location_id = ${locationId}
          and can_publish = true
      ) as "canPublish"
  `
  return scope
}

export async function requireLocationAccess(
  sql: TransactionSql,
  session: Session,
  locationId: string
) {
  if (session.role === "owner" || session.role === "admin") return
  const grant = await locationGrant(sql, session, locationId)
  if (grant.hasAssignments && !grant.assigned) {
    throw new ApiError(
      404,
      "review_not_found",
      "The requested review was not found."
    )
  }
}

export async function canPublishLocation(
  sql: TransactionSql,
  session: Session,
  locationId: string
) {
  if (session.role === "owner" || session.role === "admin") return true
  if (session.role === "viewer") return false
  const grant = await locationGrant(sql, session, locationId)
  return grant.hasAssignments ? grant.canPublish : session.canPublish
}
