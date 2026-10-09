import "server-only"

import type { TransactionSql } from "postgres"

import {
  UNFILED_CLIENT_ID,
  UNFILED_CLIENT_NAME,
} from "@/lib/contracts/client-access"
import { writeAudit } from "@/lib/server/audit"
import type {
  AccessGrant,
  ClientCatalogueEntry,
} from "@/lib/settings/client-access"

// Client access is WRITTEN here, as location_member rows. Visibility is still
// READ only by lib/server/permissions.ts; nothing in this file decides who
// sees what, and there is no client membership table (see that file's
// header). "Give Ben the Old Crown" means "give Ben a row for every listing
// filed under the Old Crown now", and these helpers are the one place that
// expansion happens:
//
//   * loadClientCatalogue / loadGrants   -> what the Client access dialog and
//     PUT /api/members/[userId]/client-access work from;
//   * grantClientListings                -> a scoped invitation, on acceptance;
//   * extendClientHolders                -> a listing newly filed under a
//     client reaches the people who already hold the whole client.
//
// All of them expect the tenant transaction (withTenant or an acceptance
// transaction with app.organisation_id set), so RLS scopes every read and
// write to one organisation.

/**
 * Every client with the ids of its listings, archived clients included (a
 * member can still hold their listings), then the unfiled group when there
 * are unfiled listings. Unfiled is a pseudo-client: choosing it grants the
 * listings unfiled NOW, and listings imported later are not added to it.
 */
export async function loadClientCatalogue(
  sql: TransactionSql
): Promise<ClientCatalogueEntry[]> {
  const clients = await sql<
    {
      clientId: string
      name: string
      archived: boolean
      listingIds: string[]
    }[]
  >`
    select
      c.id::text as "clientId",
      c.name,
      c.archived_at is not null as archived,
      coalesce(
        array_agg(l.id::text order by lower(l.name)) filter (where l.id is not null),
        '{}'
      ) as "listingIds"
    from client c
    left join location l on l.client_id = c.id
    group by c.id, c.name, c.archived_at
    order by c.archived_at is not null, lower(c.name)
  `
  const [unfiled] = await sql<{ listingIds: string[] }[]>`
    select coalesce(array_agg(id::text order by lower(name)), '{}') as "listingIds"
    from location
    where client_id is null
  `
  const catalogue: ClientCatalogueEntry[] = clients.map((client) => ({
    ...client,
    listingIds: [...client.listingIds],
  }))
  if (unfiled && unfiled.listingIds.length > 0) {
    catalogue.push({
      clientId: UNFILED_CLIENT_ID,
      name: UNFILED_CLIENT_NAME,
      archived: false,
      listingIds: [...unfiled.listingIds],
    })
  }
  return catalogue
}

/** One user's location_member rows, with the client each listing is under. */
export async function loadGrants(
  sql: TransactionSql,
  userId: string
): Promise<AccessGrant[]> {
  return sql<AccessGrant[]>`
    select
      lm.location_id::text as "locationId",
      l.client_id::text as "clientId",
      lm.can_publish as "canPublish"
    from location_member lm
    join location l on l.id = lm.location_id
    where lm.user_id = ${userId}
    order by lm.location_id
  `
}

/**
 * Grants `userId` every listing filed under `clientIds` now. Returns the
 * listing ids granted; an empty result means the clients hold no listings
 * any more, which the caller must treat as a refusal — no rows means every
 * client (lib/server/permissions.ts).
 */
export async function grantClientListings(
  sql: TransactionSql,
  input: {
    organisationId: string
    userId: string
    clientIds: readonly string[]
    canPublish: boolean
  }
): Promise<string[]> {
  if (input.clientIds.length === 0) return []
  const rows = await sql<{ locationId: string }[]>`
    insert into location_member (organisation_id, location_id, user_id, can_publish)
    select ${input.organisationId}, l.id, ${input.userId}, ${input.canPublish}
    from location l
    where l.client_id = any(${sql.array([...input.clientIds])}::uuid[])
    on conflict (location_id, user_id) do nothing
    returning location_id::text as "locationId"
  `
  return rows.map((row) => row.locationId)
}

export type ExtendedGrant = {
  userId: string
  locationId: string
  canPublish: boolean
}

/**
 * A listing newly filed under a client reaches the people scoped to that
 * client.
 *
 * Without this, "Ben sees the Old Crown" would quietly mean "Ben sees the
 * Old Crown's listings as they were when access was set", and a new branch
 * would be invisible to him with nothing on screen saying so. The rule is
 * deliberately narrow: only a user who holds EVERY other listing of the
 * client gets the new one. Someone scoped to one branch stays scoped to it,
 * and "All clients" people (no rows) already see it. Viewers never publish;
 * a member publishes to the new listing when they publish to most of the
 * client's others (a tie is Drafts only).
 *
 * `locationIds` are the listings just filed; they are left out of "the
 * other listings", so this works whether it runs before or after the
 * `update location set client_id`. Returns the rows added, for the audit.
 */
export async function extendClientHolders(
  sql: TransactionSql,
  input: {
    organisationId: string
    clientId: string
    locationIds: readonly string[]
  }
): Promise<ExtendedGrant[]> {
  if (input.locationIds.length === 0) return []
  const newIds = sql.array([...input.locationIds])
  return sql<ExtendedGrant[]>`
    with others as (
      select id from location
      where client_id = ${input.clientId}
        and id <> all(${newIds}::uuid[])
    ),
    holder as (
      select
        lm.user_id,
        count(*) filter (where lm.can_publish) * 2 > count(*) as majority_publish
      from location_member lm
      where lm.location_id in (select id from others)
      group by lm.user_id
      having count(distinct lm.location_id) = (select count(*) from others)
         and (select count(*) from others) > 0
    )
    insert into location_member (organisation_id, location_id, user_id, can_publish)
    select
      ${input.organisationId},
      new_location.id,
      holder.user_id,
      holder.majority_publish and m.role = 'member'
    from unnest(${newIds}::uuid[]) as new_location(id)
    cross join holder
    join member m on m.user_id = holder.user_id
    on conflict (location_id, user_id) do nothing
    returning
      user_id::text as "userId",
      location_id::text as "locationId",
      can_publish as "canPublish"
  `
}

/**
 * One `member.client_access_extended` entry per person who gained listings
 * from `extendClientHolders`, so the member's own audit trail shows why they
 * can suddenly see a listing nobody assigned to them by hand.
 */
export async function auditExtendedGrants(
  sql: TransactionSql,
  input: {
    organisationId: string
    actorUserId: string | null
    clientId: string
    requestId: string
    extended: readonly ExtendedGrant[]
  }
) {
  const byUser = new Map<string, ExtendedGrant[]>()
  for (const grant of input.extended) {
    byUser.set(grant.userId, [...(byUser.get(grant.userId) ?? []), grant])
  }
  for (const [userId, grants] of byUser) {
    await writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      action: "member.client_access_extended",
      subjectType: "member",
      subjectId: userId,
      requestId: input.requestId,
      metadata: {
        clientId: input.clientId,
        reason: "holds_every_other_listing_of_client",
        grants: grants.map(({ locationId, canPublish }) => ({
          locationId,
          canPublish,
        })),
      },
    })
  }
}
