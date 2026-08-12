import "server-only"

import type { TransactionSql } from "postgres"

import { getDatabase } from "@/lib/server/db"

export type GoogleConnectionRow = {
  id: string
  organisation_id: string
  access_token_ciphertext: Buffer
  refresh_token_ciphertext: Buffer | null
  access_token_expires_at: Date | null
  status: string
}

export async function recordConnectionFailure(
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
  // the short tenant-scoped transaction that persists reconnect state.
  await getDatabase().begin(async (sql) => {
    await sql`
      select set_config(
        'app.organisation_id',
        ${connection.organisation_id},
        true
      )
    `
    await recordConnectionFailure(sql, connection, errorCode)
  })
}
