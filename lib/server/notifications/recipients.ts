import "server-only"

import type { TransactionSql } from "postgres"

import {
  ACCOUNT_SCOPED_KINDS,
  defaultNotificationMode,
  isNotificationEventKind,
  type NotificationChannel,
  type NotificationEventKind,
  type NotificationMode,
} from "@/lib/domain/notification-preferences"

type Role = "owner" | "admin" | "member" | "viewer"
export type NotificationMember = {
  userId: string
  role: Role
  email: string | null
  assigned: ReadonlySet<string> | null
}
export type ScopedIncident = {
  id: string
  kind: string
  locationId: string | null
}

/**
 * Current members with their location assignments. A member with no
 * location_member rows sees every location, as visibilityPredicate has it.
 */
export async function loadNotificationMembers(
  sql: TransactionSql
): Promise<Map<string, NotificationMember>> {
  const rows = await sql<
    {
      userId: string
      role: Role
      email: string | null
      locations: string[] | null
    }[]
  >`
    select m.user_id::text as "userId", m.role, u.email,
      (select array_agg(lm.location_id::text) from location_member lm where lm.user_id = m.user_id) as locations
    from member m join app_user u on u.id = m.user_id`
  return new Map(
    rows.map((row) => [
      row.userId,
      {
        userId: row.userId,
        role: row.role,
        email: row.email,
        assigned: row.locations ? new Set(row.locations) : null,
      },
    ])
  )
}

/** Account incidents are owner/admin only; location incidents reach anyone who can see the location. */
export function canSeeIncident(
  member: NotificationMember,
  incident: ScopedIncident
) {
  if (member.role === "owner" || member.role === "admin") return true
  if (
    !incident.locationId ||
    (isNotificationEventKind(incident.kind) &&
      ACCOUNT_SCOPED_KINDS.includes(incident.kind))
  )
    return false
  return member.assigned === null || member.assigned.has(incident.locationId)
}

export type PreferenceMap = Map<string, NotificationMode>
const preferenceKey = (
  userId: string,
  kind: string,
  channel: NotificationChannel
) => `${userId}:${kind}:${channel}`

export async function loadPreferences(
  sql: TransactionSql,
  userIds?: readonly string[]
): Promise<PreferenceMap> {
  const rows = await sql<
    {
      userId: string
      kind: string
      channel: NotificationChannel
      mode: NotificationMode
    }[]
  >`
    select user_id::text as "userId", event_kind as kind, channel, mode from notification_preference
    ${userIds ? sql`where user_id in ${sql(userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"])}` : sql``}`
  return new Map(
    rows.map((row) => [
      preferenceKey(row.userId, row.kind, row.channel),
      row.mode,
    ])
  )
}

export function effectiveMode(
  preferences: PreferenceMap,
  member: NotificationMember,
  kind: string,
  channel: NotificationChannel
): NotificationMode {
  const saved = preferences.get(preferenceKey(member.userId, kind, channel))
  if (saved) return saved
  return isNotificationEventKind(kind)
    ? defaultNotificationMode(
        kind as NotificationEventKind,
        channel,
        member.role
      )
    : "off"
}
