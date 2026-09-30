import "server-only"

import type { z } from "zod"

import {
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
  type notificationListQuerySchema,
  type notificationPreferencesUpdateSchema,
} from "@/lib/contracts/operational-notifications"
import {
  ACCOUNT_SCOPED_KINDS,
  CONDITION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_KINDS,
} from "@/lib/domain/notification-preferences"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { isManagerialRole, visibilityPredicate } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

import { emailConfigured } from "./email"
import {
  effectiveMode,
  loadNotificationMembers,
  loadPreferences,
} from "./recipients"

type Row = {
  id: string
  kind: string
  subjectType: string
  subjectId: string
  locationId: string | null
  locationName: string | null
  status: "open" | "resolved"
  reason: string | null
  summary: Record<string, unknown>
  openedAt: Date
  lastSeenAt: Date
  resolvedAt: Date | null
  readAt: Date | null
}

function decodeCursor(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as { openedAt?: unknown; id?: unknown }
    if (
      typeof parsed.openedAt !== "string" ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(parsed.id)
    )
      throw new Error("shape")
    return { openedAt: parsed.openedAt, id: parsed.id }
  } catch {
    throw new ApiError(400, "invalid_request", "Invalid notifications cursor.")
  }
}

/** What this viewer may see: account incidents for owners/admins, location incidents where the location is visible. */
function scopePredicate(
  sql: Parameters<Parameters<typeof withTenant>[1]>[0],
  session: Session
) {
  if (isManagerialRole(session.role)) return sql`true`
  return sql`(i.location_id is not null and i.kind not in ${sql([...ACCOUNT_SCOPED_KINDS])}
    and ${visibilityPredicate(sql, session, sql`i.location_id`)})`
}

export async function listNotifications(
  session: Session,
  query: z.infer<typeof notificationListQuerySchema>
) {
  const after = decodeCursor(query.cursor)
  return withTenant(session.organisationId, async (sql) => {
    const scope = scopePredicate(sql, session)
    const rows = await sql<Row[]>`
      select i.id::text as id, i.kind, i.subject_type as "subjectType", i.subject_id as "subjectId",
        i.location_id::text as "locationId", l.name as "locationName", i.status, i.reason, i.summary,
        i.opened_at as "openedAt", i.last_seen_at as "lastSeenAt", i.resolved_at as "resolvedAt", r.read_at as "readAt"
      from notification_incident i
      left join location l on l.id = i.location_id
      left join notification_recipient_state r on r.incident_id = i.id and r.user_id = ${session.userId}
      where ${scope}
        ${query.filter === "unread" ? sql`and r.read_at is null` : query.filter === "open" ? sql`and i.status = 'open'` : sql``}
        ${after ? sql`and (i.opened_at, i.id) < (${after.openedAt}::timestamptz, ${after.id}::uuid)` : sql``}
      order by i.opened_at desc, i.id desc
      limit ${query.limit + 1}`
    const [unread] = await sql<{ count: number }[]>`
      select count(*)::int as count from notification_incident i
      where ${scope} and i.status = 'open'
        and not exists (select 1 from notification_recipient_state r where r.incident_id = i.id and r.user_id = ${session.userId})`
    const visible = rows.slice(0, query.limit),
      last = visible.at(-1)
    const [precise] = last
      ? await sql<{ openedAt: string }[]>`
      select to_char(opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "openedAt" from notification_incident where id = ${last.id}`
      : []
    return notificationListResponseSchema.parse({
      items: visible.map((row) => ({
        ...row,
        kind: row.kind,
        openedAt: row.openedAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        readAt: row.readAt?.toISOString() ?? null,
        canResolve:
          isManagerialRole(session.role) &&
          row.status === "open" &&
          !(CONDITION_KINDS as readonly string[]).includes(row.kind),
      })),
      nextCursor:
        rows.length > query.limit && last && precise
          ? Buffer.from(
              JSON.stringify({ openedAt: precise.openedAt, id: last.id })
            ).toString("base64url")
          : null,
      unreadCount: unread?.count ?? 0,
    })
  })
}

/** Read state is per person. It never changes the incident itself. */
export async function markNotificationsRead(
  session: Session,
  incidentIds: readonly string[],
  read: boolean
) {
  return withTenant(session.organisationId, async (sql) => {
    const visible = await sql<{ id: string }[]>`
      select i.id::text as id from notification_incident i where i.id in ${sql(incidentIds)} and ${scopePredicate(sql, session)}`
    const ids = visible.map((row) => row.id)
    if (!ids.length) return { updated: 0 }
    if (read) {
      await sql`
        insert into notification_recipient_state (organisation_id, incident_id, user_id)
        select ${session.organisationId}, unnest(${ids}::uuid[]), ${session.userId}
        on conflict (incident_id, user_id) do nothing`
    } else {
      await sql`delete from notification_recipient_state where user_id = ${session.userId} and incident_id in ${sql(ids)}`
    }
    return { updated: ids.length }
  })
}

/**
 * A manager closes an event incident once handled. Conditions (reconnect,
 * access loss, stale data) resolve only when re-evaluation finds them gone.
 */
export async function resolveNotification(
  session: Session,
  incidentId: string,
  requestId: string
) {
  if (!isManagerialRole(session.role))
    throw new ApiError(
      403,
      "forbidden",
      "Only an owner or administrator can resolve notifications."
    )
  return withTenant(session.organisationId, async (sql) => {
    const [row] = await sql<
      { kind: string; status: string }[]
    >`select kind, status from notification_incident where id = ${incidentId} for update`
    if (!row)
      throw new ApiError(
        404,
        "notification_not_found",
        "The notification was not found."
      )
    if ((CONDITION_KINDS as readonly string[]).includes(row.kind))
      throw new ApiError(
        409,
        "notification_condition_active",
        "This clears on its own once the underlying problem is fixed."
      )
    if (row.status === "resolved") return { resolved: false }
    await sql`update notification_incident set status = 'resolved', resolved_at = now() where id = ${incidentId}`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "notification.resolved",
      subjectType: "notification_incident",
      subjectId: incidentId,
      requestId,
      metadata: { kind: row.kind },
    })
    return { resolved: true }
  })
}

export async function readNotificationPreferences(session: Session) {
  return withTenant(session.organisationId, async (sql) => {
    const member = (await loadNotificationMembers(sql)).get(session.userId)
    if (!member)
      throw new ApiError(
        403,
        "forbidden",
        "You are not a member of this organisation."
      )
    const preferences = await loadPreferences(sql, [session.userId])
    const explicit = new Set(preferences.keys())
    return notificationPreferencesResponseSchema.parse({
      emailConfigured: emailConfigured(),
      // Account incidents are for owners and admins; others get no choice to make.
      preferences: NOTIFICATION_EVENT_KINDS.filter(
        (kind) => isManagerialRole(member.role) || !ACCOUNT_SCOPED_KINDS.includes(kind)
      ).flatMap((kind) =>
        NOTIFICATION_CHANNELS.map((channel) => ({
          kind,
          channel,
          mode: effectiveMode(preferences, member, kind, channel),
          explicit: explicit.has(`${session.userId}:${kind}:${channel}`),
        }))
      ),
    })
  })
}

export async function updateNotificationPreferences(
  session: Session,
  input: z.infer<typeof notificationPreferencesUpdateSchema>,
  requestId: string
) {
  await withTenant(session.organisationId, async (sql) => {
    for (const change of input.changes) {
      await sql`
        insert into notification_preference (organisation_id, user_id, event_kind, channel, mode)
        values (${session.organisationId}, ${session.userId}, ${change.kind}, ${change.channel}, ${change.mode})
        on conflict (organisation_id, user_id, event_kind, channel) do update set mode = excluded.mode, updated_at = now()`
    }
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "notification.preferences_updated",
      subjectType: "app_user",
      subjectId: session.userId,
      requestId,
      metadata: { changes: input.changes },
    })
  })
  return readNotificationPreferences(session)
}
