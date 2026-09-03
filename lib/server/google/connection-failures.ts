import "server-only"

import type { TransactionSql } from "postgres"

import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"

export type GoogleConnectionRow = {
  id: string
  organisation_id: string
  access_token_ciphertext: Buffer
  refresh_token_ciphertext: Buffer | null
  access_token_expires_at: Date | null
  status: string
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

export function revokesConnection(errorCode: string): boolean {
  return CREDENTIAL_REJECTIONS.has(errorCode)
}

export function reconnectRequiredError() {
  return new ApiError(
    401,
    "google_reconnect_required",
    "Google access has expired. Reconnect this account."
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
 * True for the two failures the connection layer raises when it could not
 * obtain a token at all. Both happen strictly BEFORE any provider mutation,
 * so nothing reached Google: queued work must be parked (reconnect is blocked
 * on a person; the token endpoint is blocked on Google) rather than settled
 * as a terminal provider rejection.
 */
/**
 * Errors that mean "a person must reconnect", not "this write failed".
 *
 * `connection_not_found` belongs here even though it reads like a 404: once
 * `recordConnectionFailure` marks a connection `revoked`, `loadConnection`
 * filters on `status in ('active', 'expired')` and finds nothing, so every
 * attempt AFTER the first revocation surfaces as `connection_not_found`
 * rather than `google_reconnect_required`. Leaving it out classified those as
 * terminal failures, which permanently failed every reply queued behind a
 * revoked grant -- and reconnecting did not resume them, because the OAuth
 * callback upserts the same row back to `active` while the replies had
 * already been settled `failed`.
 */
export function isConnectionBlockedError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "google_reconnect_required" ||
      error.code === "google_token_unavailable" ||
      error.code === "connection_not_found")
  )
}

async function recordConnectionFailure(
  sql: TransactionSql,
  connection: GoogleConnectionRow,
  errorCode: string
) {
  await sql`
    update google_connection
    set
      status = ${errorCode === "invalid_grant" ? "revoked" : "expired"},
      last_error_code = ${errorCode}
    where id = ${connection.id}
  `
  await sql`
    insert into connection_task (
      organisation_id,
      google_connection_id,
      task_type,
      status,
      reason_code
    )
    values (
      ${connection.organisation_id},
      ${connection.id},
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
      ${connection.organisation_id},
      null,
      'google.connection.reconnect_required',
      'google_connection',
      ${connection.id},
      ${sql.json({ reasonCode: errorCode })}
    )
  `
}

export async function persistConnectionFailure(
  connection: GoogleConnectionRow,
  errorCode: string
) {
  // Invariant: callers must not hold an open transaction. This helper owns
  // the short tenant-scoped transaction that persists reconnect state, and it
  // is the ONLY way to record one — an in-transaction form let the caller's
  // rollback erase the revoked status, the reconnect task and the audit row.
  await withTenant(connection.organisation_id, (sql) =>
    recordConnectionFailure(sql, connection, errorCode)
  )
}

/**
 * A transient token failure, recorded for observability only. The status is
 * left alone so the connection stays loadable and the caller's own back-off
 * can retry it.
 */
export async function noteConnectionError(
  connection: GoogleConnectionRow,
  errorCode: string
) {
  await withTenant(
    connection.organisation_id,
    (sql) => sql`
      update google_connection
      set last_error_code = ${errorCode}
      where id = ${connection.id}
    `
  )
}
