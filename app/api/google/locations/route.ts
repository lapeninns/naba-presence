import type {
  DiscoveredLocation,
  GoogleLocationsResponse,
} from "@/lib/contracts/google"
import { getDatabase } from "@/lib/server/db"
import { connectionAccessToken, googleLocations } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

type GoogleAccountRow = {
  google_account_name: string
  google_connection_id: string
}

/** One Google location as discovered, paired with the account it came from. */
type FetchedLocation = {
  account: GoogleAccountRow
  location: Record<string, unknown>
}

function titleOf(location: Record<string, unknown>) {
  return String(location.title ?? location.name ?? "Untitled location")
}

function addressOf(location: Record<string, unknown>) {
  const address =
    location.storefrontAddress && typeof location.storefrontAddress === "object"
      ? (location.storefrontAddress as Record<string, unknown>)
      : {}
  const addressLines = Array.isArray(address.addressLines)
    ? address.addressLines.filter(
        (line): line is string => typeof line === "string" && Boolean(line)
      )
    : []
  return [
    ...addressLines,
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ]
    .filter((part): part is string => typeof part === "string" && Boolean(part))
    .join(", ")
}

export const GET = route({
  roles: ["owner", "admin"],
  query: (searchParams) => ({
    accountFilter: searchParams.get("account_name"),
  }),
  handler: async ({ session, query, tenant }) => {
    const { accountFilter } = query
    const accounts = await tenant(async (sql) => {
      const rows = accountFilter
        ? await sql<GoogleAccountRow[]>`
            select
              google_account_name,
              google_connection_id::text as google_connection_id
            from google_account
            where google_account_name = ${accountFilter}
              and is_active = true
          `
        : await sql<GoogleAccountRow[]>`
            select
              google_account_name,
              google_connection_id::text as google_connection_id
            from google_account
            where is_active = true
            order by account_name
          `
      if (!rows.length) {
        throw new ApiError(
          409,
          "accounts_not_discovered",
          "Discover Google accounts first."
        )
      }
      return rows
    })
    // Tokens and paging run above `tenant`. A token refresh commits its own
    // reconnect state, which a rollback here would erase, and holding the
    // transaction open across every page of every account is what let one
    // slow Google response trip idle_in_transaction_session_timeout.
    const fetched: FetchedLocation[] = []
    for (const account of accounts) {
      const accessToken = await connectionAccessToken(
        getDatabase(),
        session.organisationId,
        account.google_connection_id
      )
      const seenPageTokens = new Set<string>()
      let pageToken: string | undefined
      do {
        const response = await googleLocations(
          accessToken,
          account.google_account_name,
          pageToken,
          { connectionKey: account.google_connection_id }
        )
        for (const location of response.locations ?? []) {
          if (!String(location.name ?? "")) continue
          fetched.push({ account, location })
        }
        pageToken = response.nextPageToken
        if (pageToken) {
          if (seenPageTokens.has(pageToken)) {
            throw new ApiError(
              502,
              "google_pagination_cycle",
              "Google returned a repeated location page token."
            )
          }
          seenPageTokens.add(pageToken)
        }
      } while (pageToken)
    }
    const locations = await tenant(async (sql) => {
      const discovered: DiscoveredLocation[] = []
      for (const { account, location } of fetched) {
        const googleLocationName = String(location.name ?? "")
        const metadata =
          location.metadata && typeof location.metadata === "object"
            ? (location.metadata as Record<string, unknown>)
            : {}
        const [external] = await sql<{ id: string }[]>`
          insert into external_location (
            organisation_id,
            google_connection_id,
            google_account_name,
            google_location_name,
            title,
            address_json,
            verified,
            raw_payload,
            raw_content_expires_at
          )
          values (
            ${session.organisationId},
            ${account.google_connection_id},
            ${account.google_account_name},
            ${googleLocationName},
            ${titleOf(location)},
            ${sql.json(JSON.parse(JSON.stringify(location.storefrontAddress ?? {})))},
            ${metadata.hasVoiceOfMerchant === true},
            ${sql.json(JSON.parse(JSON.stringify(location)))},
            now() + interval '30 days'
          )
          on conflict (organisation_id, google_location_name) do update
          set
            title = excluded.title,
            address_json = excluded.address_json,
            verified = excluded.verified,
            raw_payload = excluded.raw_payload,
            raw_content_expires_at = excluded.raw_content_expires_at,
            -- This login just listed the location, so it can reach it. Move
            -- the listing over only when the login it points at cannot
            -- (disconnected, revoked, waiting on a reconnect, or lost access
            -- to this one location): a working login keeps its listings, so
            -- discovering through a second login never silently re-routes
            -- another client's venue.
            google_connection_id = case
              when (
                external_location.google_connection_id <> excluded.google_connection_id
                and external_location.access_state = 'ok'
                and exists (
                  select 1
                  from google_connection current_login
                  where current_login.id = external_location.google_connection_id
                    and current_login.status in ('active', 'expired')
                    and not exists (
                      select 1 from connection_task ct
                      where ct.google_connection_id = current_login.id
                        and ct.task_type = 'reconnect'
                        and ct.status = 'open'
                    )
                )
              ) then external_location.google_connection_id
              else excluded.google_connection_id
            end,
            google_account_name = case
              when (
                external_location.google_connection_id <> excluded.google_connection_id
                and external_location.access_state = 'ok'
                and exists (
                  select 1
                  from google_connection current_login
                  where current_login.id = external_location.google_connection_id
                    and current_login.status in ('active', 'expired')
                    and not exists (
                      select 1 from connection_task ct
                      where ct.google_connection_id = current_login.id
                        and ct.task_type = 'reconnect'
                        and ct.status = 'open'
                    )
                )
              ) then external_location.google_account_name
              else excluded.google_account_name
            end,
            access_state = case
              when (
                external_location.google_connection_id <> excluded.google_connection_id
                and external_location.access_state = 'ok'
                and exists (
                  select 1
                  from google_connection current_login
                  where current_login.id = external_location.google_connection_id
                    and current_login.status in ('active', 'expired')
                    and not exists (
                      select 1 from connection_task ct
                      where ct.google_connection_id = current_login.id
                        and ct.task_type = 'reconnect'
                        and ct.status = 'open'
                    )
                )
              ) then external_location.access_state
              else 'ok'
            end,
            access_lost_at = case
              when (
                external_location.google_connection_id <> excluded.google_connection_id
                and external_location.access_state = 'ok'
                and exists (
                  select 1
                  from google_connection current_login
                  where current_login.id = external_location.google_connection_id
                    and current_login.status in ('active', 'expired')
                    and not exists (
                      select 1 from connection_task ct
                      where ct.google_connection_id = current_login.id
                        and ct.task_type = 'reconnect'
                        and ct.status = 'open'
                    )
                )
              ) then external_location.access_lost_at
              else null
            end,
            access_error_code = case
              when (
                external_location.google_connection_id <> excluded.google_connection_id
                and external_location.access_state = 'ok'
                and exists (
                  select 1
                  from google_connection current_login
                  where current_login.id = external_location.google_connection_id
                    and current_login.status in ('active', 'expired')
                    and not exists (
                      select 1 from connection_task ct
                      where ct.google_connection_id = current_login.id
                        and ct.task_type = 'reconnect'
                        and ct.status = 'open'
                    )
                )
              ) then external_location.access_error_code
              else null
            end
          returning id::text as id
        `
        try {
          await sql`
            insert into webhook_route (
              google_location_name,
              organisation_id,
              external_location_id
            )
            values (
              ${googleLocationName},
              ${session.organisationId},
              ${external.id}
            )
            on conflict (google_location_name) do update
            set
              organisation_id = excluded.organisation_id,
              external_location_id = excluded.external_location_id,
              updated_at = now()
          `
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "42501"
          ) {
            throw new ApiError(
              409,
              "location_routing_conflict",
              "That Google location is already routed to a different organisation."
            )
          }
          throw error
        }
        discovered.push({
          id: external.id,
          accountName: account.google_account_name,
          googleLocationName,
          title: titleOf(location),
          address: addressOf(location),
          verified: metadata.hasVoiceOfMerchant === true,
        })
      }
      return discovered
    })
    return { locations } satisfies GoogleLocationsResponse
  },
})
