import "server-only"

import type { TransactionSql } from "postgres"

import { randomToken, sha256 } from "@/lib/server/crypto"

export async function createSession(
  sql: TransactionSql,
  userId: string,
  organisationId: string,
  options: {
    supportActor?: string
    impersonationReason?: string
    maxAgeDays?: number
  } = {}
): Promise<string> {
  const token = randomToken()
  await sql`
    insert into app_session (
      token_hash,
      user_id,
      organisation_id,
      support_actor,
      impersonation_reason,
      expires_at
    )
    values (
      ${sha256(token)},
      ${userId},
      ${organisationId},
      ${options.supportActor ?? null},
      ${options.impersonationReason ?? null},
      now() + (${options.maxAgeDays ?? 30} * interval '1 day')
    )
  `
  return token
}
