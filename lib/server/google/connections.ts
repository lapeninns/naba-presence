import "server-only"

import type { Sql, TransactionSql } from "postgres"

import { isRetryableGoogleStatus, retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { decryptSecret, encryptSecret } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  googleTokenUnavailableError,
  noteConnectionError,
  persistConnectionFailure,
  reconnectRequiredError,
  revokesConnection,
  type GoogleConnectionRow,
} from "./connection-failures"
import { rememberAccessToken } from "./credentials"
import type { GoogleTokenResponse } from "./oauth"
import { googleApiTarget, googleTimeoutError, isAbortError } from "./transport"

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const TOKEN_REFRESH_ATTEMPTS = 3

/** A non-2xx answer from the token endpoint, carrying Google's own code. */
class TokenEndpointError extends Error {
  constructor(
    readonly errorCode: string,
    readonly status: number
  ) {
    super(`Google token endpoint answered ${status} ${errorCode}`)
  }
}

async function pause(ms: number, deadline: number) {
  const wait = Math.min(ms, deadline - Date.now())
  if (wait <= 0) return
  await new Promise((resolve) => setTimeout(resolve, wait))
}

type TokenBody = Partial<GoogleTokenResponse> & { error?: string }

function parseTokenBody(text: string): TokenBody {
  if (!text) return {}
  try {
    return JSON.parse(text) as TokenBody
  } catch {
    return {}
  }
}

/**
 * The refresh grant, retried the way `googleRequest` retries every other
 * Google call. It cannot go through that helper (no bearer token, a
 * form-encoded body), and before this it had no retry at all: a single 503
 * from the token endpoint was enough to take the connection out of service.
 */
async function requestRefreshedToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
  const env = getServerEnv()
  const deadline = Date.now() + env.GOOGLE_TIMEOUT_MS
  for (let attempt = 1; attempt <= TOKEN_REFRESH_ATTEMPTS; attempt += 1) {
    if (Date.now() >= deadline) throw googleTimeoutError()
    let response: Response
    try {
      response = await fetch(googleApiTarget(TOKEN_ENDPOINT), {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID ?? "",
          client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(deadline - Date.now()),
      })
    } catch (error) {
      if (isAbortError(error)) throw googleTimeoutError()
      if (attempt === TOKEN_REFRESH_ATTEMPTS) throw error
      await pause(retryDelayMs(attempt), deadline)
      continue
    }
    const body = parseTokenBody(await response.text())
    if (response.ok) {
      if (
        typeof body.access_token !== "string" ||
        typeof body.expires_in !== "number"
      ) {
        throw new TokenEndpointError("invalid_token_response", response.status)
      }
      return { accessToken: body.access_token, expiresIn: body.expires_in }
    }
    if (
      isRetryableGoogleStatus(response.status) &&
      attempt < TOKEN_REFRESH_ATTEMPTS
    ) {
      const retryAfter = Number(response.headers.get("retry-after"))
      await pause(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : retryDelayMs(attempt),
        deadline
      )
      continue
    }
    throw new TokenEndpointError(
      body.error ?? "refresh_failed",
      response.status
    )
  }
  throw googleTimeoutError()
}

/**
 * Refresh the access token and persist the outcome. Every write below commits
 * in its own tenant transaction, so the caller must NOT hold one open.
 */
async function refreshAccessToken(
  connection: GoogleConnectionRow
): Promise<string> {
  if (!connection.refresh_token_ciphertext) {
    await persistConnectionFailure(connection, "refresh_token_missing")
    throw reconnectRequiredError()
  }
  let token: { accessToken: string; expiresIn: number }
  try {
    token = await requestRefreshedToken(
      decryptSecret(connection.refresh_token_ciphertext)
    )
  } catch (error) {
    const errorCode =
      error instanceof TokenEndpointError
        ? error.errorCode
        : error instanceof ApiError
          ? error.code
          : "refresh_failed"
    if (revokesConnection(errorCode)) {
      await persistConnectionFailure(connection, errorCode)
      throw reconnectRequiredError()
    }
    // `invalid_client` after a client-secret rotation is an operator fault
    // that hits every tenant at once; a 5xx is Google's. Neither is evidence
    // that this tenant's credential died, so the connection stays usable and
    // only the error code is recorded.
    const operatorFault =
      error instanceof TokenEndpointError &&
      !isRetryableGoogleStatus(error.status)
    await noteConnectionError(connection, errorCode)
    log[operatorFault ? "error" : "warn"]("google.token_refresh_unavailable", {
      organisationId: connection.organisation_id,
      connectionId: connection.id,
      errorCode,
      status: error instanceof TokenEndpointError ? error.status : null,
    })
    throw googleTokenUnavailableError()
  }
  await withTenant(connection.organisation_id, async (transaction) => {
    await transaction`
      update google_connection
      set
        access_token_ciphertext = ${encryptSecret(token.accessToken)},
        access_token_expires_at =
          now() + (${token.expiresIn} * interval '1 second'),
        last_refresh_at = now(),
        status = 'active',
        last_error_code = null
      where id = ${connection.id}
    `
    // Google just honoured the stored refresh token, so an open reconnect
    // task for this row is stale: the credential it says a person must
    // replace is the one that worked. Before this, only a full OAuth
    // re-consent ever closed the task, and a task opened on a transient
    // answer (`status = 'expired'` stays loadable on purpose) kept "Google
    // needs reconnecting" on every page for as long as the tenant let it -
    // even while every refresh underneath it was succeeding.
    const closed = await transaction<{ reasonCode: string | null }[]>`
      update connection_task
      set status = 'completed', resolved_at = now()
      where google_connection_id = ${connection.id}
        and task_type = 'reconnect'
        and status = 'open'
      returning reason_code as "reasonCode"
    `
    if (closed.length > 0) {
      await writeAudit(transaction, {
        organisationId: connection.organisation_id,
        actorUserId: null,
        action: "google.connection.refresh_restored",
        subjectType: "google_connection",
        subjectId: connection.id,
        metadata: {
          closedReconnectTasks: closed.length,
          reasonCodes: closed.map((task) => task.reasonCode),
        },
      })
    }
  })
  return token.accessToken
}

/**
 * `expired` is loadable on purpose. Nothing but a fresh OAuth consent ever
 * writes `status = 'active'` again, so refusing to load an expired row made a
 * two-minute token-endpoint blip a permanent outage for the tenant. Loading it
 * lets the next refresh restore it. `revoked` stays unloadable: there Google
 * rejected the credential itself and only a human can fix it.
 */
async function loadConnection(
  sql: TransactionSql,
  connectionId: string
): Promise<GoogleConnectionRow> {
  const [connection] = await sql<GoogleConnectionRow[]>`
    select *
    from google_connection
    where id = ${connectionId}
      and status in ('active', 'expired')
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

/**
 * The access token for a connection, refreshed when it is within a minute of
 * expiry or the connection is not currently active.
 *
 * There is deliberately no in-transaction form. A refresh failure has to
 * commit the revoked status, the reconnect task and the audit row, and a
 * caller holding an open transaction rolls all three back when the 401
 * propagates out of it. Acquire the token ABOVE `ctx.tenant(...)`.
 */
export async function connectionAccessToken(
  // Kept for signature compatibility; every caller passes `getDatabase()`,
  // which is exactly what `withTenant` uses.
  sql: Sql,
  organisationId: string,
  connectionId: string
): Promise<string> {
  const connection = await withTenant(organisationId, (transaction) =>
    loadConnection(transaction, connectionId)
  )
  const token =
    connection.status !== "active" ||
    !connection.access_token_expires_at ||
    connection.access_token_expires_at.getTime() <= Date.now() + 60_000
      ? await refreshAccessToken(connection)
      : decryptSecret(connection.access_token_ciphertext)
  // Lets the transport route a 401 from Google back to this connection.
  rememberAccessToken(token, { organisationId, connectionId })
  return token
}
