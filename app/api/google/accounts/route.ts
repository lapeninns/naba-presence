import type { TransactionSql } from "postgres"

import { accountSelectionSchema } from "@/lib/contracts/google"
import { writeAudit } from "@/lib/server/audit"
import { belongsToClient } from "@/lib/server/clients"
import { getDatabase } from "@/lib/server/db"
import { connectionAccessToken, googleAccounts } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { requireClientAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

async function discoverAccounts(accessToken: string, connectionId: string) {
  const discovered: Array<Record<string, unknown>> = []
  const seenPageTokens = new Set<string>()
  let pageToken: string | undefined
  do {
    const response = await googleAccounts(accessToken, pageToken, {
      connectionKey: connectionId,
    })
    discovered.push(...(response.accounts ?? []))
    pageToken = response.nextPageToken
    if (pageToken) {
      if (seenPageTokens.has(pageToken)) {
        throw new ApiError(
          502,
          "google_pagination_cycle",
          "Google returned a repeated account page token."
        )
      }
      seenPageTokens.add(pageToken)
    }
  } while (pageToken)
  return discovered
}

function accountRows(sql: TransactionSql) {
  return sql`
    select
      id::text as id,
      google_account_name as "googleAccountName",
      account_name as "accountName",
      account_type as type,
      role,
      permission_level as "permissionLevel",
      is_active as "isActive",
      google_connection_id::text as "googleConnectionId"
    from google_account
    order by account_name, google_account_name
  `
}

/** Which `google_account ga` rows a selection may switch on or off. */
function accountScope(
  sql: TransactionSql,
  body: { clientId?: string; connectionId?: string }
) {
  const client = body.clientId
    ? belongsToClient(
        sql,
        sql`${body.clientId}::uuid`,
        sql`ga.google_connection_id`
      )
    : sql`true`
  const connection = body.connectionId
    ? sql`ga.google_connection_id = ${body.connectionId}`
    : sql`true`
  return sql`(${client} and ${connection})`
}

export const GET = route({
  roles: ["owner", "admin"],
  query: (searchParams) => ({
    connectionId: searchParams.get("connection_id"),
  }),
  handler: async ({ session, query, tenant }) => {
    const connection = await tenant(async (sql) => {
      const [found] = query.connectionId
        ? await sql<{ id: string }[]>`
            select id::text as id
            from google_connection
            where id = ${query.connectionId} and status = 'active'
            limit 1
          `
        : await sql<{ id: string }[]>`
            select id::text as id
            from google_connection
            where status = 'active'
            order by created_at desc
            limit 1
          `
      if (!found) {
        throw new ApiError(
          404,
          "connection_not_found",
          "Connect Google before discovering accounts."
        )
      }
      return found
    })
    // Both the token (which may itself refresh) and the discovery pages run
    // above `tenant`: a refresh failure has to commit its revoked status and
    // reconnect task, and this handler's rollback would erase them.
    const accessToken = await connectionAccessToken(
      getDatabase(),
      session.organisationId,
      connection.id
    )
    const discovered = await discoverAccounts(accessToken, connection.id)
    const accounts = await tenant(async (sql) => {
      for (const account of discovered) {
        const name = String(account.name ?? "")
        if (!name) continue
        await sql`
          insert into google_account (
            organisation_id,
            google_connection_id,
            google_account_name,
            account_name,
            account_type,
            role,
            permission_level,
            raw_payload,
            raw_content_expires_at
          )
          values (
            ${session.organisationId},
            ${connection.id},
            ${name},
            ${String(account.accountName ?? account.name ?? "")},
            ${account.type ? String(account.type) : null},
            ${account.role ? String(account.role) : null},
            ${account.permissionLevel ? String(account.permissionLevel) : null},
            ${sql.json(JSON.parse(JSON.stringify(account)))},
            now() + interval '30 days'
          )
          on conflict (organisation_id, google_account_name) do update
          set
            -- This login just proved it can reach the account. Keeping the
            -- login that first found it left the account outside every
            -- client's scope once that login was disconnected.
            google_connection_id = excluded.google_connection_id,
            account_name = excluded.account_name,
            account_type = excluded.account_type,
            role = excluded.role,
            permission_level = excluded.permission_level,
            raw_payload = excluded.raw_payload,
            raw_content_expires_at = excluded.raw_content_expires_at
        `
      }
      return accountRows(sql)
    })
    return { accounts }
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  body: accountSelectionSchema,
  handler: async ({ session, body, requestId, clientRequestId, tenant }) => {
    const accounts = await tenant(async (sql) => {
      if (body.clientId) {
        await requireClientAccess(sql, session, body.clientId)
      }
      const scope = accountScope(sql, body)
      if (body.accountIds.length > 0) {
        const [outside] = await sql<{ count: number }[]>`
          select count(*)::int as count
          from unnest(${sql.array(body.accountIds)}::uuid[]) as chosen(id)
          where not exists (
            select 1 from google_account ga
            where ga.id = chosen.id and ${scope}
          )
        `
        if ((outside?.count ?? 0) > 0) {
          throw new ApiError(
            400,
            "account_out_of_scope",
            "One or more of those accounts is not reached by this Google login."
          )
        }
      }
      const chosen = () =>
        body.accountIds.length
          ? sql`ga.id in ${sql(body.accountIds)}`
          : sql`false`
      // is_active is one flag per account, not per client. Two clients can
      // share a login, so one client's save must not switch off an account
      // whose listings another client relies on: its discovery would start
      // answering 409 and that client's setup would fall back a step.
      const keptForOtherClients = body.clientId
        ? sql`exists (
            select 1
            from external_location e
            join location_link ll
              on ll.external_location_id = e.id and ll.is_active
            join location l on l.id = ll.location_id
            where e.google_account_name = ga.google_account_name
              and l.client_id is not null
              and l.client_id <> ${body.clientId}::uuid
          )`
        : sql`false`
      await sql`
        update google_account ga
        set is_active = ${chosen()}
        where ${scope}
          and (${chosen()} or not ${keptForOtherClients})
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "google.accounts.activated",
        subjectType: body.clientId ? "client" : "organisation",
        subjectId: body.clientId ?? session.organisationId,
        requestId,
        metadata: {
          accountIds: body.accountIds,
          clientId: body.clientId ?? null,
          connectionId: body.connectionId ?? null,
          clientRequestId,
        },
      })
      return accountRows(sql)
    })
    return { accounts }
  },
})
