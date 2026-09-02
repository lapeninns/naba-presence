import { accountSelectionSchema } from "@/lib/contracts/google"
import { writeAudit } from "@/lib/server/audit"
import { connectionAccessToken, googleAccounts } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  roles: ["owner", "admin"],
  query: (searchParams) => ({
    connectionId: searchParams.get("connection_id"),
  }),
  handler: async ({ session, query, tenant }) => {
    const accounts = await tenant(async (sql) => {
      const [connection] = query.connectionId
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
      if (!connection) {
        throw new ApiError(
          404,
          "connection_not_found",
          "Connect Google before discovering accounts."
        )
      }
      const accessToken = await connectionAccessToken(sql, connection.id)
      const discovered: Array<Record<string, unknown>> = []
      const seenPageTokens = new Set<string>()
      let pageToken: string | undefined
      do {
        const response = await googleAccounts(accessToken, pageToken, {
          connectionKey: connection.id,
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
            account_name = excluded.account_name,
            account_type = excluded.account_type,
            role = excluded.role,
            permission_level = excluded.permission_level,
            raw_payload = excluded.raw_payload,
            raw_content_expires_at = excluded.raw_content_expires_at
        `
      }
      return sql`
        select
          id::text as id,
          google_account_name as "googleAccountName",
          account_name as "accountName",
          account_type as type,
          role,
          permission_level as "permissionLevel",
          is_active as "isActive"
        from google_account
        order by account_name, google_account_name
      `
    })
    return { accounts }
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  body: accountSelectionSchema,
  handler: async ({ session, body, requestId, clientRequestId, tenant }) => {
    const accounts = await tenant(async (sql) => {
      await sql`
        update google_account
        set is_active = ${
          body.accountIds.length ? sql`id in ${sql(body.accountIds)}` : false
        }
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "google.accounts.activated",
        subjectType: "organisation",
        subjectId: session.organisationId,
        requestId,
        metadata: {
          accountIds: body.accountIds,
          clientRequestId,
        },
      })
      return sql`
        select
          id::text as id,
          google_account_name as "googleAccountName",
          account_name as "accountName",
          account_type as type,
          role,
          permission_level as "permissionLevel",
          is_active as "isActive"
        from google_account
        order by account_name, google_account_name
      `
    })
    return { accounts }
  },
})
