import "server-only"

import { z } from "zod"
import type { TransactionSql } from "postgres"
import { googleLocationSearchResultSchema, type GoogleAccountMatchInput, type GoogleAccountMatchesResponse } from "@/lib/contracts/google-onboarding"
import { belongsToClient } from "./clients"
import { getDatabase, withTenant } from "./db"
import { connectionAccessToken, googleAccountManagementApi, searchGoogleLocations } from "./google"
import { ApiError } from "./http"
import { requireClientAccess } from "./permissions"
import type { Session } from "./session"

type AccountScope = { accountId: string; connectionId: string; clientId?: string }

export async function resolveOnboardingAccount(session: Session, input: AccountScope) {
  return withTenant(session.organisationId, (sql) => resolveOnboardingAccountInTransaction(sql, session, input))
}

export async function resolveOnboardingAccountInTransaction(sql: TransactionSql, session: Session, input: AccountScope) {
  if (session.role !== "owner" && session.role !== "admin") throw new ApiError(403, "onboarding_not_allowed", "Only owners and admins can set up Google listings.")
  const [member] = await sql<{ role: string }[]>`select role from member where user_id = ${session.userId}`
  if (!member || (member.role !== "owner" && member.role !== "admin")) throw new ApiError(403, "onboarding_not_allowed", "Your permission to set up Google listings changed.")
  if (input.clientId) await requireClientAccess(sql, session, input.clientId)
  const clientScope = input.clientId ? belongsToClient(sql, sql`${input.clientId}::uuid`, sql`gc.id`) : sql`true`
  const [account] = await sql<{ id: string; name: string; connectionId: string }[]>`
    select ga.id::text as id, ga.google_account_name as name, gc.id::text as "connectionId"
    from google_account ga
    join google_connection gc on gc.id = ga.google_connection_id and gc.organisation_id = ga.organisation_id
    where ga.id = ${input.accountId} and ga.google_connection_id = ${input.connectionId}
      and ga.is_active and gc.status = 'active' and ${clientScope}
  `
  if (!account) throw new ApiError(404, "onboarding_account_not_found", "Select an active Google account reached by this connection.")
  if (!/^accounts\/[^/\s]+$/.test(account.name)) throw new ApiError(409, "onboarding_account_invalid", "Refresh Google account discovery before continuing.")
  return account
}

export async function searchOnboardingMatches(session: Session, accountId: string, input: GoogleAccountMatchInput): Promise<GoogleAccountMatchesResponse> {
  const scope = { accountId, connectionId: input.connectionId, clientId: input.clientId }
  const account = await resolveOnboardingAccount(session, scope)
  const token = await connectionAccessToken(getDatabase(), session.organisationId, account.connectionId)
  const access = await googleAccountManagementApi(token, { path: account.name }, { connectionKey: account.connectionId })
  const proof = z.object({ name: z.literal(account.name) }).safeParse(access)
  if (!proof.success) throw new ApiError(502, "onboarding_account_unconfirmed", "Google did not confirm access to the selected account. Refresh discovery and try again.")
  const query = input.search.kind === "query" ? { query: input.search.query } : { location: input.search.location }
  const response = await searchGoogleLocations(token, { ...query, pageSize: input.pageSize }, { connectionKey: account.connectionId })
  const result = googleLocationSearchResultSchema.safeParse(response)
  if (!result.success) throw new ApiError(502, "google_matches_invalid", "Google returned incomplete match information. Retry the search before continuing.")
  const current = await resolveOnboardingAccount(session, scope)
  if (current.name !== account.name) throw new ApiError(409, "onboarding_account_changed", "The selected account changed during search. Refresh and try again.")
  return { accountId, connectionId: account.connectionId, checkedAt: new Date().toISOString(), matches: result.data.googleLocations ?? [] }
}
