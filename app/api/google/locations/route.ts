import { NextResponse } from "next/server"

import { withTenant } from "@/lib/server/db"
import { connectionAccessToken, googleLocations } from "@/lib/server/google"
import { ApiError, apiError } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

function titleOf(location: Record<string, unknown>) {
  return String(location.title ?? location.name ?? "Untitled location")
}

function addressOf(location: Record<string, unknown>) {
  const address =
    location.storefrontAddress &&
    typeof location.storefrontAddress === "object"
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

export async function GET(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const accountFilter = new URL(request.url).searchParams.get("account_name")
    const locations = await withTenant(session.organisationId, async (sql) => {
      const accounts = accountFilter
        ? await sql<
            { google_account_name: string; google_connection_id: string }[]
          >`
            select
              google_account_name,
              google_connection_id::text as google_connection_id
            from google_account
            where google_account_name = ${accountFilter}
              and is_active = true
          `
        : await sql<
            { google_account_name: string; google_connection_id: string }[]
          >`
            select
              google_account_name,
              google_connection_id::text as google_connection_id
            from google_account
            where is_active = true
            order by account_name
          `
      if (!accounts.length) {
        throw new ApiError(
          409,
          "accounts_not_discovered",
          "Discover Google accounts first."
        )
      }
      const discovered: Record<string, unknown>[] = []
      for (const account of accounts) {
        const accessToken = await connectionAccessToken(
          sql,
          account.google_connection_id
        )
        let pageToken: string | undefined
        do {
          const response = await googleLocations(
            accessToken,
            account.google_account_name,
            pageToken,
            { connectionKey: account.google_connection_id }
          )
          for (const location of response.locations ?? []) {
            const googleLocationName = String(location.name ?? "")
            if (!googleLocationName) continue
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
                raw_content_expires_at = excluded.raw_content_expires_at
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
          pageToken = response.nextPageToken
        } while (pageToken)
      }
      return discovered
    })
    return NextResponse.json({ locations })
  } catch (error) {
    return apiError(error)
  }
}
