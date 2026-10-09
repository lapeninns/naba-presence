import "server-only"

import type { TransactionSql } from "postgres"

import { randomToken, sha256 } from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"

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
  const env = getServerEnv()
  // A fixed-length session (support impersonation) neither slides nor
  // outlives its own maxAge; an ordinary one starts with the idle window
  // and may slide up to the absolute limit (0051).
  const idleDays = options.maxAgeDays ?? env.SESSION_IDLE_DAYS
  const absoluteDays = options.maxAgeDays ?? env.SESSION_ABSOLUTE_DAYS
  await sql`
    insert into app_session (
      token_hash,
      user_id,
      organisation_id,
      support_actor,
      impersonation_reason,
      expires_at,
      absolute_expires_at
    )
    values (
      ${sha256(token)},
      ${userId},
      ${organisationId},
      ${options.supportActor ?? null},
      ${options.impersonationReason ?? null},
      now() + (${Math.min(idleDays, absoluteDays)} * interval '1 day'),
      now() + (${absoluteDays} * interval '1 day')
    )
  `
  return token
}
