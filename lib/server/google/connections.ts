import "server-only"

import type { Sql, TransactionSql } from "postgres"

import { isRetryableGoogleStatus, retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { decryptSecret, encryptSecret } from "@/lib/server/crypto"
import { withSessionConnection, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  googleTokenUnavailableError,
  noteConnectionError,
  persistConnectionFailure,
  reconnectRequiredError,
  revokesConnection,
  type CredentialRef,
  type GoogleConnectionRow,
} from "./connection-failures"
import { rememberAccessToken } from "./credentials"
import { refreshTokenFingerprints } from "./risc-fingerprint"
import {
  grantsBusinessManage,
  revokeGoogleToken,
  type GoogleTokenResponse,
} from "./oauth"
import { googleApiTarget, googleTimeoutError, isAbortError } from "./transport"

/**
 * The connection service: the only code that changes a Google connection's
 * credentials or lifecycle state. Routes call these operations and never
 * write `google_connection` or its reconnect tasks themselves.
 *
 *   getAccessToken            a usable access token, refreshing at most once
 *                             per connection across every server
 *   completeAuthorisation     a finished OAuth consent becomes an active
 *                             connection (or refuses to)
 *   recordCredentialRejection Google refused the credential: needs reconnect
 *   disconnect                the owner removes the connection
 *   setNotificationSettings   Pub/Sub notification configuration
 *
 * Lifecycle, as a person sees it, on the existing columns:
 *
 *   Active           status 'active', last_error_code null
 *   Degraded         status 'active' or 'expired' with last_error_code set
 *                    by a transient failure; recovers on the next success
 *   Needs reconnect  status 'revoked' or 'expired' with an open reconnect task
 *   Disconnected     status 'disconnected'; tokens gone, purge scheduled
 *
 * Listing-level access loss lives on `external_location.access_state` and
 * never changes the connection (see connection-failures.ts).
 *
 * Invariants every write here keeps, enforced in SQL rather than by lock
 * ordering:
 *   1. Disconnect is authoritative: no write after it may restore tokens,
 *      reactivate the row or open a task (`status <> 'disconnected'`).
 *   2. A result belongs to the credential it came from: writes that follow a
 *      Google round trip carry `credential_generation` and are dropped if a
 *      reconnect or disconnect has bumped it since.
 */

export { persistConnectionFailure as recordCredentialRejection }
export type { CredentialRef }

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const TOKEN_REFRESH_ATTEMPTS = 3

/**
 * The credential this refresh started from was replaced (a reconnect) while
 * Google answered, so the answer was dropped. Not an error for the caller:
 * `getAccessToken` loads the new credential and uses that instead.
 */
class StaleCredentialError extends Error {
  constructor() {
    super("The credential changed while it was being refreshed")
  }
}

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
type RefreshedToken = {
  accessToken: string
  expiresIn: number
  /**
   * Present only if Google ever returns one. Google documents no rotation for
   * web-server clients, but storing one that arrives costs nothing and
   * dropping it would lose the only credential that still works.
   */
  refreshToken?: string
  refreshTokenExpiresIn?: number
  scope?: string
}

async function requestRefreshedToken(
  refreshToken: string
): Promise<RefreshedToken> {
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
      return {
        accessToken: body.access_token,
        expiresIn: body.expires_in,
        refreshToken:
          typeof body.refresh_token === "string" && body.refresh_token
            ? body.refresh_token
            : undefined,
        refreshTokenExpiresIn:
          typeof body.refresh_token_expires_in === "number"
            ? body.refresh_token_expires_in
            : undefined,
        scope: typeof body.scope === "string" ? body.scope : undefined,
      }
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

function credentialOf(connection: GoogleConnectionRow): CredentialRef {
  return {
    organisationId: connection.organisation_id,
    connectionId: connection.id,
    generation: connection.credential_generation,
  }
}

/**
 * Refresh the access token and persist the outcome. Every write below commits
 * in its own tenant transaction, so the caller must NOT hold one open.
 */
async function refreshAccessToken(
  connection: GoogleConnectionRow
): Promise<string> {
  const credential = credentialOf(connection)
  if (!connection.refresh_token_ciphertext) {
    await persistConnectionFailure(credential, "refresh_token_missing")
    throw reconnectRequiredError()
  }
  let token: RefreshedToken
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
      if (!(await persistConnectionFailure(credential, errorCode))) {
        throw await staleOrGone(connection)
      }
      throw reconnectRequiredError()
    }
    // `invalid_client` after a client-secret rotation is an operator fault
    // that hits every tenant at once; a 5xx is Google's. Neither is evidence
    // that this tenant's credential died, so the connection stays usable
    // (Degraded) and only the error code is recorded.
    const operatorFault =
      error instanceof TokenEndpointError &&
      !isRetryableGoogleStatus(error.status)
    await noteConnectionError(credential, errorCode)
    log[operatorFault ? "error" : "warn"]("google.token_refresh_unavailable", {
      organisationId: connection.organisation_id,
      connectionId: connection.id,
      errorCode,
      status: error instanceof TokenEndpointError ? error.status : null,
    })
    throw googleTokenUnavailableError()
  }
  // A refresh answer that names scopes and leaves out business.manage means
  // the grant was narrowed at Google. Refreshing into it would only produce
  // a token that fails every Business Profile call.
  if (token.scope !== undefined && !grantsBusinessManage(token.scope)) {
    await persistConnectionFailure(credential, "insufficient_scope")
    throw reconnectRequiredError()
  }
  await withTenant(connection.organisation_id, async (transaction) => {
    // Both guards (see the module comment): a disconnect that committed
    // while Google was answering has already nulled the tokens, and a
    // reconnect has replaced them with a credential this answer does not
    // belong to. Either way, writing these back would be wrong.
    const updated = await transaction`
      update google_connection
      set
        access_token_ciphertext = ${encryptSecret(token.accessToken)},
        access_token_expires_at =
          now() + (${token.expiresIn} * interval '1 second'),
        ${
          token.refreshToken
            ? transaction`
                refresh_token_ciphertext = ${encryptSecret(token.refreshToken)},
                refresh_token_sha512x2 = ${refreshTokenFingerprints(token.refreshToken).sha512x2},
                refresh_token_prefix_sha256 = ${refreshTokenFingerprints(token.refreshToken).prefixSha256},
              `
            : transaction``
        }
        ${
          token.refreshToken && token.refreshTokenExpiresIn
            ? transaction`refresh_token_expires_at =
                now() + (${token.refreshTokenExpiresIn} * interval '1 second'),`
            : transaction``
        }
        last_refresh_at = now(),
        status = 'active',
        last_error_code = null,
        last_error_at = null
      where id = ${connection.id}
        and status <> 'disconnected'
        and credential_generation = ${connection.credential_generation}
      returning id
    `
    if (updated.length === 0) throw await staleOrGone(connection)
    // Google just honoured the stored refresh token, so an open reconnect
    // task for this row is stale: the credential it says a person must
    // replace is the one that worked.
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
 * `expired` is loadable on purpose: a two-minute token-endpoint blip must not
 * become a permanent outage, and the next refresh can restore it. `revoked`
 * stays unloadable: Google rejected the credential itself and only a person
 * can fix it.
 */
async function loadConnection(
  sql: TransactionSql,
  connectionId: string
): Promise<GoogleConnectionRow> {
  const [connection] = await sql<GoogleConnectionRow[]>`
    select
      id,
      organisation_id,
      access_token_ciphertext,
      refresh_token_ciphertext,
      access_token_expires_at,
      status,
      credential_generation
    from google_connection
    where id = ${connectionId}
      and status in ('active', 'expired')
    limit 1
  `
  if (!connection) throw connectionNotFoundError()
  return connection
}

/**
 * Why a guarded write matched nothing: the row was reconnected (a newer
 * generation that is still loadable, so the caller can use it) or it is gone
 * (disconnected or revoked, which the caller must see as not found).
 */
async function staleOrGone(connection: GoogleConnectionRow): Promise<Error> {
  const [row] = await withTenant(
    connection.organisation_id,
    (sql) => sql<{ generation: number; status: string }[]>`
      select credential_generation as generation, status
      from google_connection
      where id = ${connection.id}
    `
  )
  return row &&
    row.status !== "disconnected" &&
    row.generation !== connection.credential_generation
    ? new StaleCredentialError()
    : connectionNotFoundError()
}

function connectionNotFoundError() {
  return new ApiError(
    404,
    "connection_not_found",
    "Google connection not found."
  )
}

function needsRefresh(connection: GoogleConnectionRow): boolean {
  return (
    connection.status !== "active" ||
    !connection.access_token_ciphertext ||
    !connection.access_token_expires_at ||
    connection.access_token_expires_at.getTime() <= Date.now() + 60_000
  )
}

function loadFromTenant(organisationId: string, connectionId: string) {
  return withTenant(organisationId, (transaction) =>
    loadConnection(transaction, connectionId)
  )
}

/** How often a caller that lost the refresh lock looks for the winner's token. */
const REFRESH_WAIT_POLL_MS = 150

/**
 * Refreshes already running in this process, so concurrent callers share one
 * instead of each queueing on the database lock with a pooled connection.
 */
const refreshesInFlight = new Map<string, Promise<string>>()

/**
 * One refresh per connection at a time, across every process.
 *
 * The in-process map folds concurrent callers in one server into a single
 * promise. The session advisory lock does the same across servers: the
 * holder re-reads the row after taking it, because the previous holder has
 * usually just refreshed, and everyone else polls the row until a fresh token
 * appears. The lock is session-level on a reserved connection, not held in a
 * transaction, so the Google round trip cannot trip
 * `idle_in_transaction_session_timeout`, and a server that dies mid-refresh
 * drops its connection and with it the lock: there is nothing to reap.
 * Waiters give up at the deadline with the retryable
 * `google_token_unavailable`, never with a reconnect.
 *
 * Needs a session-mode pool (Supabase's session pooler on 5432 or a direct
 * connection); transaction-mode pooling would release the lock between
 * statements. docs/runbook.md records this.
 */
function refreshOnce(connection: GoogleConnectionRow): Promise<string> {
  const key = `${connection.organisation_id}:${connection.id}:${connection.credential_generation}`
  const running = refreshesInFlight.get(key)
  if (running) return running
  const refresh = refreshUnderLock(connection).finally(() => {
    refreshesInFlight.delete(key)
  })
  refreshesInFlight.set(key, refresh)
  return refresh
}

async function refreshUnderLock(
  connection: GoogleConnectionRow
): Promise<string> {
  const lockKey = `naba:google-refresh:${connection.id}`
  // Long enough for the holder's full retried refresh to finish.
  const deadline = Date.now() + getServerEnv().GOOGLE_TIMEOUT_MS + 5_000
  for (;;) {
    const refreshed = await withSessionConnection(async (session) => {
      const [lock] = await session<{ acquired: boolean }[]>`
        select pg_try_advisory_lock(hashtext(${lockKey})) as acquired
      `
      if (!lock?.acquired) return null
      try {
        const current = await loadFromTenant(
          connection.organisation_id,
          connection.id
        )
        if (!needsRefresh(current)) {
          return issue(current)
        }
        const token = await refreshAccessToken(current)
        rememberAccessToken(token, {
          organisationId: current.organisation_id,
          connectionId: current.id,
          generation: current.credential_generation,
        })
        return token
      } finally {
        // Closing the session releases the lock too; never mask the refresh.
        await session`select pg_advisory_unlock(hashtext(${lockKey}))`.catch(
          () => undefined
        )
      }
    })
    if (refreshed !== null) return refreshed
    await new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_POLL_MS))
    // A disconnect or revocation while waiting surfaces here as
    // connection_not_found, the same as for any caller arriving after it.
    const current = await loadFromTenant(
      connection.organisation_id,
      connection.id
    )
    if (!needsRefresh(current)) {
      return issue(current)
    }
    if (Date.now() >= deadline) throw googleTokenUnavailableError()
  }
}

/** Hand out a stored token, recording which credential issued it. */
function issue(connection: GoogleConnectionRow): string {
  const token = decryptSecret(connection.access_token_ciphertext)
  // Lets the transport route a 401 from Google back to this credential.
  rememberAccessToken(token, {
    organisationId: connection.organisation_id,
    connectionId: connection.id,
    generation: connection.credential_generation,
  })
  return token
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
export async function getAccessToken(
  organisationId: string,
  connectionId: string
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const connection = await loadFromTenant(organisationId, connectionId)
    try {
      return needsRefresh(connection)
        ? await refreshOnce(connection)
        : issue(connection)
    } catch (error) {
      // A reconnect landed mid-refresh: the new credential is already
      // stored, so use it. Once only -- a second race in a row is not worth
      // chasing, and the retryable error below says to try again.
      if (error instanceof StaleCredentialError) {
        if (attempt < 2) continue
        throw googleTokenUnavailableError()
      }
      throw error
    }
  }
}

/** `getAccessToken` under its original name and signature. */
export function connectionAccessToken(
  // Kept for signature compatibility; every caller passes `getDatabase()`,
  // which is exactly what `withTenant` uses.
  _sql: Sql,
  organisationId: string,
  connectionId: string
): Promise<string> {
  return getAccessToken(organisationId, connectionId)
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

export type GoogleProfile = {
  sub: string
  email?: string
}

export type CompletedAuthorisation = {
  connectionId: string
  /** The same Google account was already connected to this organisation. */
  reconnected: boolean
  previousStatus: string | null
  /**
   * The reconnect was started for a different Google account than the one
   * that came back. That connection still needs reconnecting (or
   * disconnecting); nothing was moved onto this one.
   */
  accountMismatch: { connectionId: string; googleEmail: string | null } | null
  /** Linked locations that will catch up now the credential works again. */
  catchUpLocationIds: string[]
}

export function scopeMissingError() {
  return new ApiError(
    403,
    "google_scope_missing",
    "Google did not grant permission to manage Business Profiles."
  )
}

/**
 * A finished OAuth consent. Validates what Google actually granted, then
 * installs the credential as a new generation.
 *
 * Refuses, with nothing written:
 *   - a grant without business.manage (Google's consent screen lets a person
 *     untick it, and a `scope` field that is missing counts as not granted:
 *     Google documents the field and never says it may be omitted);
 *   - a grant with no refresh token at all, new or stored, which would make
 *     an "active" connection that dies within the hour.
 *
 * Deliberately does NOT revoke the refresh token it replaces. Google revokes
 * a grant per user and Cloud project, not per token: revoking the old token
 * would also invalidate the one just issued. The old token is dropped here
 * and ages out of Google's 100-per-client limit on its own.
 *
 * `attach` runs in the same transaction so a client's setup records the
 * login atomically with it becoming active.
 */
export async function completeAuthorisation(input: {
  organisationId: string
  userId: string
  tokens: GoogleTokenResponse
  profile: GoogleProfile
  /** The connection a reconnect was started for, from the signed state. */
  reconnectConnectionId?: string | null
  requestId: string
  clientRequestId: string | null
  attach?: (sql: TransactionSql, connectionId: string) => Promise<unknown>
}): Promise<CompletedAuthorisation> {
  const { tokens, profile } = input
  if (!grantsBusinessManage(tokens.scope)) throw scopeMissingError()
  // What a RISC token-revoked event will identify this token by.
  const fingerprints = tokens.refresh_token
    ? refreshTokenFingerprints(tokens.refresh_token)
    : null
  const refreshTokenExpiresAt = tokens.refresh_token_expires_in
    ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
    : null
  return withTenant(input.organisationId, async (sql) => {
    const [existing] = await sql<
      { id: string; status: string; hasRefreshToken: boolean }[]
    >`
      select
        id::text as id,
        status,
        refresh_token_ciphertext is not null as "hasRefreshToken"
      from google_connection
      where google_subject = ${profile.sub}
      limit 1
    `
    if (!tokens.refresh_token && !existing?.hasRefreshToken) {
      throw new ApiError(
        502,
        "google_offline_access_missing",
        "Google did not grant offline access. Try connecting again."
      )
    }
    const [row] = await sql<{ id: string }[]>`
      insert into google_connection (
        organisation_id,
        google_subject,
        google_email,
        status,
        scope,
        access_token_ciphertext,
        refresh_token_ciphertext,
        access_token_expires_at,
        refresh_token_expires_at,
        last_refresh_at,
        last_error_code,
        last_error_at,
        disconnected_at,
        purge_due_at,
        connected_by_user_id,
        google_revocation_status,
        google_revocation_at,
        refresh_token_sha512x2,
        refresh_token_prefix_sha256
      )
      values (
        ${input.organisationId},
        ${profile.sub},
        ${profile.email ?? null},
        'active',
        ${tokens.scope},
        ${encryptSecret(tokens.access_token)},
        ${tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null},
        now() + (${tokens.expires_in} * interval '1 second'),
        ${refreshTokenExpiresAt},
        now(),
        null,
        null,
        null,
        null,
        ${input.userId},
        null,
        null,
        ${fingerprints?.sha512x2 ?? null},
        ${fingerprints?.prefixSha256 ?? null}
      )
      on conflict (organisation_id, google_subject) do update
      set
        google_email = excluded.google_email,
        status = 'active',
        scope = excluded.scope,
        access_token_ciphertext = excluded.access_token_ciphertext,
        refresh_token_ciphertext = coalesce(
          excluded.refresh_token_ciphertext,
          google_connection.refresh_token_ciphertext
        ),
        access_token_expires_at = excluded.access_token_expires_at,
        refresh_token_expires_at = case
          when excluded.refresh_token_ciphertext is not null
            then excluded.refresh_token_expires_at
          else google_connection.refresh_token_expires_at
        end,
        last_refresh_at = now(),
        last_error_code = null,
        last_error_at = null,
        disconnected_at = null,
        purge_due_at = null,
        connected_by_user_id = excluded.connected_by_user_id,
        google_revocation_status = null,
        google_revocation_at = null,
        refresh_token_sha512x2 = case
          when excluded.refresh_token_ciphertext is not null
            then excluded.refresh_token_sha512x2
          else google_connection.refresh_token_sha512x2
        end,
        refresh_token_prefix_sha256 = case
          when excluded.refresh_token_ciphertext is not null
            then excluded.refresh_token_prefix_sha256
          else google_connection.refresh_token_prefix_sha256
        end,
        -- A new credential generation: anything still in flight on the old
        -- credential can no longer write to this row.
        credential_generation = google_connection.credential_generation + 1
      returning id::text as id
    `
    await sql`
      update connection_task
      set status = 'completed', resolved_at = now()
      where google_connection_id = ${row.id}
        and task_type = 'reconnect'
        and status = 'open'
    `
    // A reconnect started for one login that came back as another. The old
    // login's task stays open -- its locations really are still unreachable
    // -- but is labelled, so the banner can say what happened and the
    // person can reconnect the right account or disconnect the old one.
    let accountMismatch: CompletedAuthorisation["accountMismatch"] = null
    if (input.reconnectConnectionId && input.reconnectConnectionId !== row.id) {
      const [previous] = await sql<
        { id: string; googleEmail: string | null }[]
      >`
        select id::text as id, google_email as "googleEmail"
        from google_connection
        where id = ${input.reconnectConnectionId}
      `
      if (previous) {
        accountMismatch = {
          connectionId: previous.id,
          googleEmail: previous.googleEmail,
        }
        await sql`
          update connection_task
          set reason_code = 'superseded_by_reconnect'
          where google_connection_id = ${previous.id}
            and task_type = 'reconnect'
            and status = 'open'
        `
      }
    }
    if (input.attach) await input.attach(sql, row.id)
    // Catch-up after an outage: every linked location reached through this
    // login gets its reconcile due now, so the runner fetches what was missed
    // instead of waiting for the next scheduled check.
    const catchUp = await sql<{ id: string }[]>`
      update sync_checkpoint sc
      set next_attempt_at = now(),
          status = case
            when sc.status in ('succeeded', 'cancelled') then 'pending'
            else sc.status
          end
      from external_location e
      join location_link ll on ll.external_location_id = e.id and ll.is_active
      where sc.external_location_id = e.id
        and e.google_connection_id = ${row.id}
        and sc.sync_type = 'reconcile'
        and sc.status <> 'running'
        and sc.status <> 'dead'
      returning sc.external_location_id::text as id
    `
    await writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.userId,
      action: existing
        ? "google.connection.reconnected"
        : "google.connection.connected",
      subjectType: "google_connection",
      subjectId: row.id,
      requestId: `${input.requestId}:connection`,
      metadata: {
        googleEmail: profile.email ?? null,
        previousStatus: existing?.status ?? null,
        accountMismatchConnectionId: accountMismatch?.connectionId ?? null,
        catchUpLocations: catchUp.length,
        clientRequestId: input.clientRequestId,
      },
    })
    return {
      connectionId: row.id,
      reconnected: Boolean(existing),
      previousStatus: existing?.status ?? null,
      accountMismatch,
      catchUpLocationIds: catchUp.map((entry) => entry.id),
    }
  })
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export type DisconnectOutcome = {
  /**
   * Remote revocation at Google: never reported as done unless Google said
   * so. "shared" means it was skipped because another live connection holds
   * the same login, and revoking would have ended that one too.
   */
  googleRevocation: "revoked" | "failed" | "not_attempted" | "shared"
  /** Notification settings Google would not clear, for an operator. */
  residualNotificationAccounts: string[]
}

/**
 * Remove a connection. Local removal is authoritative and commits first;
 * everything that talks to Google afterwards is best effort and can only
 * leave a residue at Google, never a live credential here.
 *
 *   1. read    the credential (held in memory for the revoke) and accounts
 *   2. token   an access token for the notification cleanup, if needed
 *   3. remove  status, tokens, tasks, checkpoints, routes, links, purge date
 *              and the caller's own cleanup, in one transaction; bumps the
 *              generation so in-flight refreshes cannot land
 *   4. clean   Google notification settings, one account at a time
 *   5. revoke  the grant at Google; the outcome is recorded on the row
 */
export async function disconnect(input: {
  organisationId: string
  userId: string
  connectionId: string
  requestId: string
  clientRequestId: string | null
  /** Route-owned cleanup that must commit with the disconnect. */
  withinDisconnect?: (sql: TransactionSql) => Promise<Record<string, unknown>>
  /** Clears one account's Google notification setting. */
  clearNotifications?: (
    accessToken: string,
    accountName: string
  ) => Promise<unknown>
}): Promise<DisconnectOutcome> {
  const { organisationId, connectionId, requestId } = input
  const target = await withTenant(organisationId, async (sql) => {
    const [connection] = await sql<
      {
        notificationsEnabled: boolean
        refreshToken: Buffer | null
        accessToken: Buffer | null
      }[]
    >`
      select
        notifications_enabled as "notificationsEnabled",
        refresh_token_ciphertext as "refreshToken",
        access_token_ciphertext as "accessToken"
      from google_connection
      where id = ${connectionId}
        and status <> 'disconnected'
      limit 1
    `
    if (!connection) {
      throw new ApiError(404, "connection_not_found", "Connection not found.")
    }
    const accounts = await sql<{ googleAccountName: string }[]>`
      select google_account_name as "googleAccountName"
      from google_account
      where google_connection_id = ${connectionId}
    `
    return {
      notificationsEnabled: connection.notificationsEnabled,
      accountNames: accounts.map((account) => account.googleAccountName),
      // Phase 3 nulls the stored copies, and Google can only revoke what it
      // is shown. The refresh token, because revoking it ends the grant.
      grantToken: connection.refreshToken
        ? decryptSecret(connection.refreshToken)
        : connection.accessToken
          ? decryptSecret(connection.accessToken)
          : null,
    }
  })

  const cleanupErrors: string[] = []
  let accessToken: string | null = null
  if (
    input.clearNotifications &&
    target.notificationsEnabled &&
    target.accountNames.length
  ) {
    try {
      accessToken = await getAccessToken(organisationId, connectionId)
    } catch (error) {
      cleanupErrors.push(
        error instanceof ApiError ? error.code : "notification_cleanup_failed"
      )
    }
  }

  const removed = await withTenant(organisationId, async (sql) => {
    const result = await sql`
      update google_connection
      set
        status = 'disconnected',
        access_token_ciphertext = null,
        refresh_token_ciphertext = null,
        notifications_enabled = false,
        disconnected_at = now(),
        purge_due_at = now() + interval '7 days',
        credential_generation = credential_generation + 1,
        refresh_token_sha512x2 = null,
        refresh_token_prefix_sha256 = null,
        google_revocation_status = ${target.grantToken ? null : "not_attempted"}
      where id = ${connectionId}
        and status <> 'disconnected'
      returning id
    `
    if (!result.length) {
      throw new ApiError(404, "connection_not_found", "Connection not found.")
    }
    await sql`
      update connection_task
      set status = 'cancelled', resolved_at = now()
      where google_connection_id = ${connectionId}
        and status = 'open'
    `
    await sql`
      update sync_checkpoint
      set
        status = 'cancelled',
        finished_at = now(),
        next_attempt_at = null
      where external_location_id in (
        select id
        from external_location
        where google_connection_id = ${connectionId}
      )
        and status in ('pending', 'running', 'failed')
    `
    const removedRoutes = await sql`
      delete from webhook_route
      where organisation_id = ${organisationId}
        and external_location_id in (
          select id
          from external_location
          where google_connection_id = ${connectionId}
        )
      returning google_location_name
    `
    await sql`
      update location_link
      set is_active = false
      where external_location_id in (
        select id
        from external_location
        where google_connection_id = ${connectionId}
      )
    `
    const extra = input.withinDisconnect
      ? await input.withinDisconnect(sql)
      : {}
    await writeAudit(sql, {
      organisationId,
      actorUserId: input.userId,
      action: "google.connection.disconnected",
      subjectType: "google_connection",
      subjectId: connectionId,
      requestId,
      metadata: {
        purgeDueWithinDays: 7,
        routesRemoved: removedRoutes.length,
        ...extra,
        clientRequestId: input.clientRequestId,
      },
    })
    return extra
  })

  const residualAccounts: string[] = []
  if (accessToken && input.clearNotifications) {
    for (const accountName of target.accountNames) {
      try {
        await input.clearNotifications(accessToken, accountName)
      } catch (error) {
        residualAccounts.push(accountName)
        cleanupErrors.push(
          error instanceof ApiError ? error.code : "notification_cleanup_failed"
        )
      }
    }
  }
  if (cleanupErrors.length) {
    log.warn("google.notification_cleanup_failed", {
      requestId,
      organisationId,
      connectionId,
      residualAccounts: residualAccounts.length,
      errors: cleanupErrors,
    })
    await withTenant(organisationId, (sql) =>
      writeAudit(sql, {
        organisationId,
        actorUserId: input.userId,
        action: "google.notifications.cleanup_failed",
        subjectType: "google_connection",
        subjectId: connectionId,
        requestId,
        metadata: {
          residualAccounts,
          errors: cleanupErrors,
          ...removed,
          clientRequestId: input.clientRequestId,
        },
      })
    )
  }

  // Revoke last: it also kills the access token the notification cleanup
  // needs, and the local disconnect above must not wait on Google. A failure
  // is recorded on the row and in the audit log -- and reported as failed,
  // never as revoked -- but does not undo the local disconnect.
  if (!target.grantToken) {
    return {
      googleRevocation: "not_attempted",
      residualNotificationAccounts: residualAccounts,
    }
  }
  // Google revokes per login and Cloud project, not per token. If this
  // row was reconnected since step 3, or another organisation holds the same
  // login, revoking would end a grant that is still in use.
  const grantInUse = await withTenant(organisationId, async (sql) => {
    const [row] = await sql<{ inUse: boolean }[]>`
      select
        status <> 'disconnected'
          or google_grant_in_use_elsewhere(id) as "inUse"
      from google_connection
      where id = ${connectionId}
    `
    if (row?.inUse) {
      await sql`
        update google_connection
        set google_revocation_status = 'shared', google_revocation_at = now()
        where id = ${connectionId}
          and status = 'disconnected'
      `
    }
    return row?.inUse ?? false
  })
  if (grantInUse) {
    log.info("google.connection.revoke_skipped_shared", {
      requestId,
      organisationId,
      connectionId,
    })
    return {
      googleRevocation: "shared",
      residualNotificationAccounts: residualAccounts,
    }
  }
  const outcome = await revokeGoogleToken(target.grantToken)
  await withTenant(organisationId, async (sql) => {
    // Only the row that is still this disconnect's: a reconnect that
    // landed in the meantime owns the columns now.
    await sql`
      update google_connection
      set
        google_revocation_status = ${outcome.revoked ? "revoked" : "failed"},
        google_revocation_at = now()
      where id = ${connectionId}
        and status = 'disconnected'
    `
    if (!outcome.revoked) {
      await writeAudit(sql, {
        organisationId,
        actorUserId: input.userId,
        action: "google.connection.revoke_failed",
        subjectType: "google_connection",
        subjectId: connectionId,
        requestId: `${requestId}:revoke`,
        metadata: {
          status: outcome.status,
          error: outcome.error,
          clientRequestId: input.clientRequestId,
        },
      })
    }
  })
  if (outcome.revoked) {
    log.info("google.connection.revoked_at_google", {
      requestId,
      organisationId,
      connectionId,
    })
  } else {
    log.warn("google.connection.revoke_failed", {
      requestId,
      organisationId,
      connectionId,
      status: outcome.status,
      error: outcome.error,
    })
  }
  return {
    googleRevocation: outcome.revoked ? "revoked" : "failed",
    residualNotificationAccounts: residualAccounts,
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export async function setNotificationSettings(
  sql: TransactionSql,
  input: {
    connectionId: string
    pubsubTopic: string | null
    notificationTypes: string[]
  }
) {
  await sql`
    update google_connection
    set
      pubsub_topic = ${input.pubsubTopic || null},
      notifications_enabled = ${Boolean(input.pubsubTopic)},
      notification_types = ${input.pubsubTopic ? input.notificationTypes : []}
    where id = ${input.connectionId}
      and status <> 'disconnected'
  `
}
