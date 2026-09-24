import "server-only"

import type { TransactionSql } from "postgres"

import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

/**
 * The state transitions behind the connection service
 * (`lib/server/google/connections.ts`). Routes never import this module; the
 * transport does, because it is the one place an API 401 is observed and it
 * cannot import the service without a cycle.
 *
 * Every write here is conditional twice over:
 *
 *   status <> 'disconnected'       a disconnect is authoritative. Whatever a
 *                                  Google round trip that started before it
 *                                  returns, the removed connection stays
 *                                  removed, with no tokens and no task.
 *
 *   credential_generation = $gen   the result belongs to the credential it
 *                                  was obtained with. A reconnect bumps the
 *                                  generation, so a refresh or a 401 that
 *                                  started on the old credential cannot
 *                                  overwrite the new tokens or mark them for
 *                                  reconnect.
 *
 * A write that loses either race is dropped silently (and logged): the state
 * it would have recorded is no longer true of the row.
 */

export type GoogleConnectionRow = {
  id: string
  organisation_id: string
  access_token_ciphertext: Buffer
  refresh_token_ciphertext: Buffer | null
  access_token_expires_at: Date | null
  status: string
  credential_generation: number
}

/**
 * The only token-endpoint answers that mean the stored credential itself is
 * dead. Google answers a revoked or expired refresh token with
 * `invalid_grant`; everything else it can answer with — a 5xx, a rate limit,
 * an `invalid_client` after a client-secret rotation — is transient or an
 * operator fault. Revoking on those would make every tenant redo the OAuth
 * consent for an incident that never touched their credentials.
 */
const CREDENTIAL_REJECTIONS = new Set([
  "invalid_grant",
  "invalid_scope",
  "refresh_token_missing",
])

/**
 * Failures only a fresh consent can fix, so the connection is `revoked`
 * (unloadable) rather than `expired` (retried by the next refresh). A token
 * without `business.manage` refreshes happily into another token without it,
 * and an `expired` row would close its own reconnect task on that refresh.
 * RISC notices (`google_token_revoked`, `google_account_disabled`) are Google
 * saying so directly.
 */
const REVOKING_FAILURES = new Set([
  "invalid_grant",
  "insufficient_scope",
  "google_token_revoked",
  "google_account_disabled",
  "google_account_purged",
])

export function revokesConnection(errorCode: string): boolean {
  return CREDENTIAL_REJECTIONS.has(errorCode)
}

export function reconnectRequiredError() {
  return new ApiError(
    401,
    "google_reconnect_required",
    "Google access has stopped working. Reconnect this account."
  )
}

export function googleTokenUnavailableError() {
  return new ApiError(
    503,
    "google_token_unavailable",
    "Google could not issue an access token just now. The connection is still linked - try again shortly."
  )
}

/**
 * Errors that mean "a person must reconnect", not "this write failed".
 *
 * Both token failures happen strictly BEFORE any provider mutation, so
 * nothing reached Google: queued work must be parked (reconnect is blocked on
 * a person; the token endpoint is blocked on Google) rather than settled as a
 * terminal provider rejection.
 *
 * `connection_not_found` belongs here even though it reads like a 404: once
 * a connection is marked `revoked`, the loader filters on
 * `status in ('active', 'expired')` and finds nothing, so every attempt AFTER
 * the first revocation surfaces as `connection_not_found` rather than
 * `google_reconnect_required`. Leaving it out classified those as terminal
 * failures, which permanently failed every reply queued behind a revoked
 * grant.
 */
export function isConnectionBlockedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "google_reconnect_required" ||
      error.code === "google_token_unavailable" ||
      error.code === "connection_not_found")
  )
}

/**
 * Which credential a result belongs to. `generation` is optional only for
 * callers that genuinely have no credential in hand (a RISC notice names an
 * account, not a token); those apply to whatever the row holds now.
 */
export type CredentialRef = {
  readonly organisationId: string
  readonly connectionId: string
  readonly generation?: number
}

function generationGuard(sql: TransactionSql, generation?: number) {
  return generation === undefined
    ? sql``
    : sql`and credential_generation = ${generation}`
}

/**
 * Needs reconnect. Returns false when the write lost a race (disconnected,
 * or reconnected since the credential was read), so the caller can tell a
 * recorded rejection from a stale one.
 */
async function recordRejection(
  sql: TransactionSql,
  credential: CredentialRef,
  errorCode: string
): Promise<boolean> {
  const updated = await sql`
    update google_connection
    set
      status = ${REVOKING_FAILURES.has(errorCode) ? "revoked" : "expired"},
      last_error_code = ${errorCode},
      last_error_at = now()
    where id = ${credential.connectionId}
      and status <> 'disconnected'
      ${generationGuard(sql, credential.generation)}
    returning id
  `
  if (updated.length === 0) return false
  await sql`
    insert into connection_task (
      organisation_id,
      google_connection_id,
      task_type,
      status,
      reason_code
    )
    values (
      ${credential.organisationId},
      ${credential.connectionId},
      'reconnect',
      'open',
      ${errorCode}
    )
    on conflict (
      organisation_id,
      google_connection_id,
      task_type
    ) where status = 'open' do update
    set reason_code = excluded.reason_code
  `
  await sql`
    insert into audit_log (
      organisation_id,
      actor_user_id,
      action,
      subject_type,
      subject_id,
      metadata
    )
    values (
      ${credential.organisationId},
      null,
      'google.connection.reconnect_required',
      'google_connection',
      ${credential.connectionId},
      ${sql.json({ reasonCode: errorCode })}
    )
  `
  return true
}

/**
 * Record that Google rejected a connection's credential. Owns its own short
 * tenant transaction on purpose: the caller must not hold one open, because a
 * rollback of the caller's work would erase the revoked status, the
 * reconnect task and the audit row.
 */
export async function persistConnectionFailure(
  credential: CredentialRef,
  errorCode: string
): Promise<boolean> {
  const recorded = await withTenant(credential.organisationId, (sql) =>
    recordRejection(sql, credential, errorCode)
  )
  if (!recorded) {
    log.info("google.connection.stale_rejection_ignored", {
      organisationId: credential.organisationId,
      connectionId: credential.connectionId,
      generation: credential.generation ?? null,
      errorCode,
    })
  }
  return recorded
}

/**
 * How recently the credential must have refreshed for a 401 to count as a
 * rejection. A 401 on an older access token is most often just that token
 * (revoked with a password reset, dropped by Google, cached past its life),
 * and the stored refresh token settles the question on the next call.
 */
const UNAUTHENTICATED_ESCALATION_WINDOW = "10 minutes"

/**
 * A 401 from a Business Profile API. Rather than asking a person to reconnect
 * on the first one, the access token is expired in place so the next call
 * refreshes it: `invalid_grant` there is the real rejection, and a refresh
 * that works is the recovery. Only a 401 on a token refreshed within
 * UNAUTHENTICATED_ESCALATION_WINDOW is recorded as needing reconnect, since a
 * second refresh would not help it.
 *
 * Returns "refresh" when the token was expired for a retry, "reconnect" when
 * the rejection was recorded, and "stale" when the write lost a race
 * (disconnected, or reconnected since this token was issued).
 */
export async function handleUnauthenticated(
  credential: CredentialRef
): Promise<"refresh" | "reconnect" | "stale"> {
  const expired = await withTenant(
    credential.organisationId,
    (sql) => sql`
      update google_connection
      set
        access_token_expires_at = now(),
        last_error_code = 'google_unauthenticated',
        last_error_at = now()
      where id = ${credential.connectionId}
        and status <> 'disconnected'
        ${generationGuard(sql, credential.generation)}
        and (
          last_refresh_at is null
          or last_refresh_at
            < now() - ${UNAUTHENTICATED_ESCALATION_WINDOW}::interval
        )
      returning id
    `
  )
  if (expired.length > 0) return "refresh"
  return (await persistConnectionFailure(credential, "google_unauthenticated"))
    ? "reconnect"
    : "stale"
}

/**
 * A transient token failure (Google 5xx, timeout, rate limit, operator
 * fault), recorded for the Data delayed state and for operators. The status
 * is left alone so the connection stays loadable and the caller's own
 * back-off can retry it.
 */
export async function noteConnectionError(
  credential: CredentialRef,
  errorCode: string
) {
  await withTenant(
    credential.organisationId,
    (sql) => sql`
      update google_connection
      set last_error_code = ${errorCode}, last_error_at = now()
      where id = ${credential.connectionId}
        and status <> 'disconnected'
        ${generationGuard(sql, credential.generation)}
    `
  )
}

/**
 * The login lost manager access to one location: Google answers 403
 * PERMISSION_DENIED (or 404) for that location while the credential works
 * everywhere else. Marks the listing, never the connection.
 */
export async function recordListingAccessLoss(
  credential: CredentialRef,
  googleLocationName: string,
  errorCode: string
) {
  await withTenant(credential.organisationId, async (sql) => {
    const changed = await sql<{ id: string }[]>`
      update external_location
      set
        access_state = 'access_lost',
        access_lost_at = coalesce(access_lost_at, now()),
        access_error_code = ${errorCode}
      where google_location_name = ${googleLocationName}
        and google_connection_id = ${credential.connectionId}
        and access_state <> 'access_lost'
      returning id::text as id
    `
    for (const row of changed) {
      await sql`
        insert into audit_log (
          organisation_id, actor_user_id, action, subject_type, subject_id,
          metadata
        )
        values (
          ${credential.organisationId}, null, 'google.listing.access_lost',
          'external_location', ${row.id},
          ${sql.json({ errorCode, connectionId: credential.connectionId })}
        )
      `
    }
  })
}

/** A successful read of a location proves access is back. Cheap when it never left. */
export async function restoreListingAccess(
  sql: TransactionSql,
  externalLocationId: string
) {
  await sql`
    update external_location
    set access_state = 'ok', access_lost_at = null, access_error_code = null
    where id = ${externalLocationId}
      and access_state <> 'ok'
  `
}
