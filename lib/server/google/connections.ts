import "server-only"

import type { Sql, TransactionSql } from "postgres"

import { decryptSecret, encryptSecret } from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  persistConnectionFailure,
  recordConnectionFailure,
  type GoogleConnectionRow,
} from "./connection-failures"
import type { GoogleTokenResponse } from "./oauth"
import { googleApiTarget, googleTimeoutError, isAbortError } from "./transport"

async function refreshAccessToken(
  sql: TransactionSql,
  connection: GoogleConnectionRow
): Promise<string> {
  if (!connection.refresh_token_ciphertext) {
    await recordConnectionFailure(sql, connection, "refresh_token_missing")
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  const env = getServerEnv()
  const response = await fetch(
    googleApiTarget("https://oauth2.googleapis.com/token"),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: decryptSecret(connection.refresh_token_ciphertext),
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(env.GOOGLE_TIMEOUT_MS),
    }
  ).catch((error) => {
    if (isAbortError(error)) throw googleTimeoutError()
    throw error
  })
  const body = (await response.json()) as GoogleTokenResponse & {
    error?: string
  }
  if (!response.ok) {
    await recordConnectionFailure(
      sql,
      connection,
      body.error ?? "refresh_failed"
    )
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  await sql`
    update google_connection
    set
      access_token_ciphertext = ${encryptSecret(body.access_token)},
      access_token_expires_at = now() + (${body.expires_in} * interval '1 second'),
      last_refresh_at = now(),
      status = 'active',
      last_error_code = null
    where id = ${connection.id}
  `
  return body.access_token
}

async function loadConnection(
  sql: TransactionSql,
  connectionId: string
): Promise<GoogleConnectionRow> {
  const [connection] = await sql<GoogleConnectionRow[]>`
    select *
    from google_connection
    where id = ${connectionId}
      and status = 'active'
    limit 1
  `
  if (!connection) {
    throw new ApiError(
      404,
      "connection_not_found",
      "Google connection not found."
    )
  }
  return connection
}

async function connectionAccessTokenInTransaction(
  sql: TransactionSql,
  connectionId: string
) {
  const connection = await loadConnection(sql, connectionId)
  if (
    !connection.access_token_expires_at ||
    connection.access_token_expires_at.getTime() <= Date.now() + 60_000
  ) {
    return refreshAccessToken(sql, connection)
  }
  return decryptSecret(connection.access_token_ciphertext)
}

async function refreshAccessTokenOutsideTransaction(
  sql: Sql,
  connection: GoogleConnectionRow
) {
  if (!connection.refresh_token_ciphertext) {
    await persistConnectionFailure(connection, "refresh_token_missing")
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  const env = getServerEnv()
  const response = await fetch(
    googleApiTarget("https://oauth2.googleapis.com/token"),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: decryptSecret(connection.refresh_token_ciphertext),
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(env.GOOGLE_TIMEOUT_MS),
    }
  ).catch((error) => {
    if (isAbortError(error)) throw googleTimeoutError()
    throw error
  })
  const body = (await response.json()) as GoogleTokenResponse & {
    error?: string
  }
  if (!response.ok) {
    await persistConnectionFailure(connection, body.error ?? "refresh_failed")
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  await sql.begin(async (transaction) => {
    await transaction`
      select set_config(
        'app.organisation_id',
        ${connection.organisation_id},
        true
      )
    `
    await transaction`
      update google_connection
      set
        access_token_ciphertext = ${encryptSecret(body.access_token)},
        access_token_expires_at =
          now() + (${body.expires_in} * interval '1 second'),
        last_refresh_at = now(),
        status = 'active',
        last_error_code = null
      where id = ${connection.id}
    `
  })
  return body.access_token
}

export function connectionAccessToken(
  sql: TransactionSql,
  connectionId: string
): Promise<string>
export function connectionAccessToken(
  sql: Sql,
  organisationId: string,
  connectionId: string
): Promise<string>
export async function connectionAccessToken(
  ...args:
    | readonly [sql: TransactionSql, connectionId: string]
    | readonly [sql: Sql, organisationId: string, connectionId: string]
): Promise<string> {
  if (args.length === 3) {
    const [sql, organisationId, connectionId] = args
    const connection = await sql.begin(async (transaction) => {
      await transaction`
        select set_config(
          'app.organisation_id',
          ${organisationId},
          true
        )
      `
      return loadConnection(transaction, connectionId)
    })
    if (
      !connection.access_token_expires_at ||
      connection.access_token_expires_at.getTime() <= Date.now() + 60_000
    ) {
      return refreshAccessTokenOutsideTransaction(sql, connection)
    }
    return decryptSecret(connection.access_token_ciphertext)
  }
  const [sql, connectionId] = args
  return connectionAccessTokenInTransaction(sql, connectionId)
}
