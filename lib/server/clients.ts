import "server-only"

import type { TransactionSql } from "postgres"

import { clientHealth, type ClientHealth } from "@/lib/clients/health"
import type {
  ClientConnection,
  ClientSetup,
  ClientSummary,
} from "@/lib/contracts/clients"
import { nextIncompleteStep } from "@/lib/contracts/clients"
import { clientVisibilityPredicate } from "@/lib/server/permissions"
import { visibilityPredicate } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

type SummaryRow = Omit<ClientSummary, "health" | "connections"> & {
  connections: ClientConnection[] | null
}

/**
 * Every client the session may see, with the counts the index and the hub
 * both render.
 *
 * One statement, not one per client: an agency with forty clients would
 * otherwise issue forty round trips to draw a table. The aggregates are
 * lateral subqueries so a client with no locations still returns a row with
 * zeroes rather than disappearing behind a join.
 */
export async function listClientSummaries(
  sql: TransactionSql,
  session: Session
): Promise<{ items: ClientSummary[]; unassignedLocationCount: number }> {
  const rows = await sql<SummaryRow[]>`
    select
      c.id::text as id,
      c.name,
      c.slug,
      c.colour,
      c.logo_url as "logoUrl",
      c.notes,
      to_json(c.archived_at)#>>'{}' as "archivedAt",
      to_json(c.created_at)#>>'{}' as "createdAt",
      counts.location_count::int as "locationCount",
      counts.linked_count::int as "linkedCount",
      counts.verified_count::int as "verifiedCount",
      json_build_object(
        'needsReply', work.needs_reply::int,
        'awaitingApproval', work.awaiting_approval::int,
        'failed', work.failed::int
      ) as "openWork",
      json_build_object(
        'running', backfill.running::int,
        'failed', backfill.failed::int,
        'succeeded', backfill.succeeded::int,
        'notStarted', greatest(counts.linked_count - backfill.started, 0)::int
      ) as backfill,
      connections.items as connections,
      to_json(backfill.last_sync_at)#>>'{}' as "lastSyncAt"
    from client c
    left join lateral (
      select
        count(*) as location_count,
        count(*) filter (where ll.id is not null) as linked_count,
        count(*) filter (where e.verified) as verified_count
      from location l
      left join location_link ll on ll.location_id = l.id and ll.is_active
      left join external_location e on e.id = ll.external_location_id
      where l.client_id = c.id
        and ${visibilityPredicate(sql, session, sql`l.id`)}
    ) counts on true
    left join lateral (
      select
        count(*) filter (
          where r.workflow_status in ('new', 'drafted', 'verified', 'rejected')
            and r.triaged_at is null
        ) as needs_reply,
        count(*) filter (where r.workflow_status = 'awaiting_approval') as awaiting_approval,
        count(*) filter (where r.workflow_status = 'failed') as failed
      from review r
      join location l on l.id = r.location_id
      where l.client_id = c.id
        and r.provider_deleted_at is null
        and ${visibilityPredicate(sql, session, sql`r.location_id`)}
    ) work on true
    left join lateral (
      select
        count(*) filter (where sc.status in ('pending', 'running')) as running,
        count(*) filter (where sc.status = 'failed') as failed,
        count(*) filter (where sc.status = 'succeeded') as succeeded,
        count(*) as started,
        max(sc.updated_at) as last_sync_at
      from sync_checkpoint sc
      join external_location e on e.id = sc.external_location_id
      join location_link ll on ll.external_location_id = e.id and ll.is_active
      join location l on l.id = ll.location_id
      where l.client_id = c.id
        and sc.sync_type = 'backfill'
    ) backfill on true
    left join lateral (
      select json_agg(distinct jsonb_build_object(
        'id', gc.id::text,
        'googleEmail', gc.google_email,
        'status', gc.status,
        'reconnectRequired', exists (
          select 1 from connection_task ct
          where ct.google_connection_id = gc.id
            and ct.task_type = 'reconnect'
            and ct.status = 'open'
        ),
        'lastRefreshAt', to_json(gc.last_refresh_at)#>>'{}'
      )) as items
      from google_connection gc
      where exists (
        select 1
        from location l
        join location_link ll on ll.location_id = l.id and ll.is_active
        join external_location e on e.id = ll.external_location_id
        where l.client_id = c.id
          and e.google_connection_id = gc.id
      )
    ) connections on true
    where c.archived_at is null
      and ${clientVisibilityPredicate(sql, session, sql`c.id`)}
    order by lower(c.name)
  `

  const [unassigned] = await sql<{ count: number }[]>`
    select count(*)::int as count
    from location l
    where l.client_id is null
      and ${visibilityPredicate(sql, session, sql`l.id`)}
  `

  return {
    items: rows.map(toSummary),
    unassignedLocationCount: unassigned?.count ?? 0,
  }
}

function toSummary(row: SummaryRow): ClientSummary {
  const connections = row.connections ?? []
  return {
    ...row,
    connections,
    health: healthFor({ ...row, connections }),
  }
}

/** The one place a summary row becomes a health word. */
export function healthFor(
  row: Pick<ClientSummary, "connections" | "linkedCount" | "backfill">
): ClientHealth {
  return clientHealth({
    connections: row.connections,
    linkedLocationCount: row.linkedCount,
    backfill: { running: row.backfill.running, failed: row.backfill.failed },
  })
}

export async function loadClientSummary(
  sql: TransactionSql,
  session: Session,
  clientId: string
): Promise<ClientSummary | null> {
  const { items } = await listClientSummaries(sql, session)
  return items.find((client) => client.id === clientId) ?? null
}

/**
 * Setup state for the onboarding wizard, derived rather than stored.
 *
 * Nothing records which step the operator reached. Every answer here comes
 * from data that had to exist anyway, so closing the tab, refreshing, or
 * coming back tomorrow all resume at the same place, and a step undone
 * elsewhere (a disconnected login) correctly sends the wizard backwards.
 */
export async function readClientSetup(
  sql: TransactionSql,
  session: Session,
  clientId: string
): Promise<ClientSetup> {
  const [row] = await sql<
    {
      connectionId: string | null
      connectionStatus: ClientConnection["status"] | null
      accountsActive: number
      locationsLinked: number
      backfillRunning: number
      backfillFailed: number
      backfillSucceeded: number
      notificationsEnabled: boolean
      teamInvited: boolean
    }[]
  >`
    select
      conn.id::text as "connectionId",
      conn.status as "connectionStatus",
      coalesce(accounts.active, 0)::int as "accountsActive",
      coalesce(links.linked, 0)::int as "locationsLinked",
      coalesce(backfill.running, 0)::int as "backfillRunning",
      coalesce(backfill.failed, 0)::int as "backfillFailed",
      coalesce(backfill.succeeded, 0)::int as "backfillSucceeded",
      coalesce(conn.notifications_enabled, false) as "notificationsEnabled",
      exists (
        select 1 from invitation i where i.accepted_at is null
        union all
        select 1 from member m where m.user_id <> ${session.userId}
      ) as "teamInvited"
    from client c
    left join lateral (
      select gc.id, gc.status, gc.notifications_enabled
      from google_connection gc
      where exists (
        select 1
        from location l
        join location_link ll on ll.location_id = l.id and ll.is_active
        join external_location e on e.id = ll.external_location_id
        where l.client_id = c.id and e.google_connection_id = gc.id
      )
      order by (gc.status = 'active') desc, gc.created_at desc
      limit 1
    ) conn on true
    left join lateral (
      select count(*) as active from google_account ga where ga.is_active
    ) accounts on true
    left join lateral (
      select count(*) as linked
      from location l
      join location_link ll on ll.location_id = l.id and ll.is_active
      where l.client_id = c.id
    ) links on true
    left join lateral (
      select
        count(*) filter (where sc.status in ('pending', 'running')) as running,
        count(*) filter (where sc.status = 'failed') as failed,
        count(*) filter (where sc.status = 'succeeded') as succeeded
      from sync_checkpoint sc
      join external_location e on e.id = sc.external_location_id
      join location_link ll on ll.external_location_id = e.id and ll.is_active
      join location l on l.id = ll.location_id
      where l.client_id = c.id and sc.sync_type = 'backfill'
    ) backfill on true
    where c.id = ${clientId}
  `

  const backfill: ClientSetup["backfill"] =
    (row?.backfillRunning ?? 0) > 0
      ? "running"
      : (row?.backfillSucceeded ?? 0) > 0
        ? "done"
        : (row?.backfillFailed ?? 0) > 0
          ? "failed"
          : "not_started"

  const partial = {
    connection:
      row?.connectionId && row.connectionStatus
        ? { id: row.connectionId, status: row.connectionStatus }
        : null,
    accountsActive: row?.accountsActive ?? 0,
    locationsLinked: row?.locationsLinked ?? 0,
    backfill,
    notificationsEnabled: row?.notificationsEnabled ?? false,
    teamInvited: row?.teamInvited ?? false,
  }

  return {
    clientId,
    hasClient: true,
    ...partial,
    nextStep: nextIncompleteStep(partial),
  }
}

/** URL-safe slug from a client name, uniquified against the organisation. */
export async function uniqueClientSlug(
  sql: TransactionSql,
  name: string
): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "client"
  let candidate = base
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const [taken] = await sql<{ exists: boolean }[]>`
      select exists (select 1 from client where slug = ${candidate}) as exists
    `
    if (!taken?.exists) return candidate
    candidate = `${base}-${suffix}`
  }
  // 98 collisions on one name means something is wrong upstream; a random
  // suffix is still better than failing the create.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}
