import "server-only"

import type { TransactionSql } from "postgres"

import { randomToken, sha256 } from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"

/**
 * How strongly the person behind a session proved who they are (0200).
 * `aal2` only after a TOTP code was verified for this sign-in; the factor,
 * when, and until when that proof counts as recent travel with it. A session
 * minted from another session (workspace switch, accepting an invitation
 * while signed in) carries the original assurance across unchanged.
 */
export type SessionAssurance = {
  aal: "aal1" | "aal2"
  factorId: string | null
  verifiedAt: Date | null
  proofExpiresAt: Date | null
  /** password, email_link, password_reset, session_switch, ... */
  authMethod: string | null
}

export const AAL1_ASSURANCE: SessionAssurance = {
  aal: "aal1",
  factorId: null,
  verifiedAt: null,
  proofExpiresAt: null,
  authMethod: null,
}

export async function createSession(
  sql: TransactionSql,
  userId: string,
  organisationId: string,
  options: {
    supportActor?: string
    impersonationReason?: string
    maxAgeDays?: number
    assurance?: SessionAssurance
  } = {}
): Promise<string> {
  const token = randomToken()
  const env = getServerEnv()
  // A fixed-length session (support impersonation) neither slides nor
  // outlives its own maxAge; an ordinary one starts with the idle window
  // and may slide up to the absolute limit (0051).
  const idleDays = options.maxAgeDays ?? env.SESSION_IDLE_DAYS
  const absoluteDays = options.maxAgeDays ?? env.SESSION_ABSOLUTE_DAYS
  const assurance = options.assurance ?? AAL1_ASSURANCE
  // The session records the person's security_version as it is now, so a
  // later bump (operator MFA recovery) ends it (lookupSession). Every caller
  // has already set the organisation (and usually the user) the session is
  // for, which is what makes the app_user row visible here; a row that is not
  // visible is a bug, and minting a session that would never resolve hides it.
  const inserted = await sql`
    insert into app_session (
      token_hash,
      user_id,
      organisation_id,
      support_actor,
      impersonation_reason,
      expires_at,
      absolute_expires_at,
      aal,
      mfa_factor_id,
      mfa_verified_at,
      mfa_proof_expires_at,
      security_version,
      auth_method
    )
    select
      ${sha256(token)}::text,
      u.id,
      ${organisationId}::uuid,
      ${options.supportActor ?? null}::text,
      ${options.impersonationReason ?? null}::text,
      now() + (${Math.min(idleDays, absoluteDays)} * interval '1 day'),
      now() + (${absoluteDays} * interval '1 day'),
      ${assurance.aal}::text,
      ${assurance.factorId}::text,
      ${assurance.verifiedAt}::timestamptz,
      ${assurance.proofExpiresAt}::timestamptz,
      u.security_version,
      ${assurance.authMethod}::text
    from app_user u
    where u.id = ${userId}::uuid
    returning 1
  `
  if (inserted.length !== 1) {
    throw new Error("Session user is not visible to the session transaction")
  }
  return token
}
