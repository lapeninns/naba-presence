import "server-only"

import { cookies } from "next/headers"
import type { Fragment, TransactionSql } from "postgres"
import { cache } from "react"

import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  createSession,
  type SessionAssurance,
} from "@/lib/server/session-store"

export { createSession, type SessionAssurance }

const SESSION_COOKIE = "naba_session"
const LOCAL_ORGANISATION_ID = "00000000-0000-4000-8000-000000000001"
const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000002"

export type Session = {
  sessionId: string
  userId: string
  organisationId: string
  organisationName: string
  workspaceMode: "business" | "agency"
  displayName: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
  /**
   * Set only on a session minted by POST /api/support/impersonation.
   * Everything such a session does is attributed to the customer's own user
   * id, so anything that records who acted has to read these and say so.
   * Optional so existing `Session` fixtures stay valid; `lookupSession`
   * always selects both.
   */
  supportActor?: string | null
  impersonationReason?: string | null
  /**
   * An opaque token that changes whenever what this membership may see or do
   * changes: role, publish right, explicit location scope, every location
   * grant, and the person's security_version (0105), which operator MFA
   * recovery bumps. The client compares it to drop cached data and stashed
   * drafts from a wider scope (lib/queries/scope-reset.ts). Optional so
   * existing `Session` fixtures stay valid; `lookupSession` always sets it.
   */
  scopeFingerprint?: string
  /**
   * Assurance (0105, lib/server/session-store.ts). Optional so existing
   * `Session` fixtures stay valid; `lookupSession` always selects them, and a
   * missing value means aal1 with no recent proof.
   */
  aal?: "aal1" | "aal2"
  mfaFactorId?: string | null
  mfaVerifiedAt?: Date | null
  mfaProofExpiresAt?: Date | null
  securityVersion?: number
  authMethod?: string | null
  /** Verified TOTP factors the person had when last seen (0 = none). */
  mfaFactorCount?: number
}

/** The assurance a session minted from `session` carries across. */
export function assuranceOf(session: Session): SessionAssurance {
  return {
    aal: session.aal ?? "aal1",
    factorId: session.mfaFactorId ?? null,
    verifiedAt: session.mfaVerifiedAt ?? null,
    proofExpiresAt: session.mfaProofExpiresAt ?? null,
    authMethod: session.authMethod ?? null,
  }
}

/**
 * The `scopeFingerprint` select-list expression for a query that joins the
 * session's membership as `m` and its person as `u`. One definition, so the
 * session lookup and the organisation switch can never hash different
 * things. The person's security_version (0105) leads: it is per person, not
 * per membership, and only operator MFA recovery bumps it, so the membership
 * rows still carry role and grant changes. The grants are read in a stable
 * order so the same scope always hashes the same; md5 only keeps the token
 * short and opaque (it is not a secret, and collisions cost at most a missed
 * cache reset).
 */
export function scopeFingerprintColumn(sql: TransactionSql): Fragment {
  return sql`md5(concat_ws(
    '|',
    u.security_version::text,
    m.role,
    m.can_publish::text,
    m.location_scope,
    (
      select string_agg(
        lm.location_id::text || ':' || lm.can_publish::text,
        ',' order by lm.location_id
      )
      from location_member lm
      where lm.organisation_id = m.organisation_id
        and lm.user_id = m.user_id
    )
  ))`
}

async function lookupSession(rawToken: string): Promise<Session | null> {
  const tokenHash = sha256(rawToken)
  return getDatabase().begin(async (sql) => {
    await sql`
      select set_config('app.session_token_hash', ${tokenHash}, true)
    `
    const supportEnabled = getServerEnv().SUPPORT_IMPERSONATION_ENABLED
    const [sessionIdentity] = await sql<
      {
        sessionId: string
        userId: string
        organisationId: string
        isSupport: boolean
        currentVersion: boolean
      }[]
    >`
      select
        s.id::text as "sessionId",
        s.user_id::text as "userId",
        s.organisation_id::text as "organisationId",
        s.support_actor is not null as "isSupport",
        s.security_version = u.security_version as "currentVersion"
      from app_session s
      join app_user u on u.id = s.user_id
      where s.token_hash = ${tokenHash}
        and s.expires_at > now()
        and (s.absolute_expires_at is null or s.absolute_expires_at > now())
      limit 1
    `
    if (!sessionIdentity) return null
    // Minted before the person's security_version moved on (operator MFA
    // recovery bumps it, 0105): the session is over everywhere, and its row
    // goes now rather than waiting for its expiry.
    if (!sessionIdentity.currentVersion) {
      await sql`delete from app_session where token_hash = ${tokenHash}`
      return null
    }
    // With support impersonation off (the default), a support session never
    // resolves, and the row it presented is deleted so it cannot come back
    // when the flag is turned on again. The policy on app_session lets this
    // transaction see and delete only the row matching its own token hash.
    if (sessionIdentity.isSupport && !supportEnabled) {
      await sql`
        delete from app_session
        where token_hash = ${tokenHash}
          and support_actor is not null
      `
      return null
    }
    await sql`
      select set_config(
        'app.organisation_id',
        ${sessionIdentity.organisationId},
        true
      )
    `
    const [session] = await sql<Session[]>`
      select
        s.id::text as "sessionId",
        s.user_id::text as "userId",
        s.organisation_id::text as "organisationId",
        o.name as "organisationName",
        o.workspace_mode as "workspaceMode",
        u.display_name as "displayName",
        u.email,
        m.role,
        m.can_publish as "canPublish",
        s.support_actor as "supportActor",
        s.impersonation_reason as "impersonationReason",
        s.aal,
        s.mfa_factor_id as "mfaFactorId",
        s.mfa_verified_at as "mfaVerifiedAt",
        s.mfa_proof_expires_at as "mfaProofExpiresAt",
        s.security_version as "securityVersion",
        s.auth_method as "authMethod",
        u.mfa_factor_count as "mfaFactorCount",
        ${scopeFingerprintColumn(sql)} as "scopeFingerprint"
      from app_session s
      join app_user u on u.id = s.user_id
      join organisation o on o.id = s.organisation_id
      join member m
        on m.organisation_id = s.organisation_id
       and m.user_id = s.user_id
      where s.id = ${sessionIdentity.sessionId}
      limit 1
    `
    // Use keeps a session alive: the idle window slides forward from now,
    // capped at the absolute limit set at sign-in (0051). A support session
    // keeps its fixed expiry and never slides.
    await sql`
      update app_session
      set
        last_seen_at = now(),
        expires_at = case
          when support_actor is null then least(
            -- 24-hour days, as at sign-in (session-store.ts): DST-proof.
            now() + (${getServerEnv().SESSION_IDLE_DAYS} * interval '24 hours'),
            coalesce(absolute_expires_at, expires_at)
          )
          else expires_at
        end
      where id = ${sessionIdentity.sessionId}
    `
    return session ?? null
  }) as Promise<Session | null>
}

// React.cache(): one lookup (and one last_seen_at write) per server request,
// however many layouts, pages and prefetch helpers ask. Outside an RSC render
// (route handlers) React's cache is a per-call no-op, so behaviour there is
// unchanged.
export const getSession = cache(async (): Promise<Session | null> => {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value
  return rawToken ? lookupSession(rawToken) : null
})

export async function requireSession(): Promise<Session> {
  const session = await getSession()
  if (!session) {
    throw new ApiError(401, "authentication_required", "Please sign in.")
  }
  return session
}

export function requireRole(
  session: Session,
  roles: Session["role"][]
): Session {
  if (!roles.includes(session.role)) {
    throw new ApiError(403, "permission_denied", "You do not have permission.")
  }
  return session
}

export async function setSessionCookie(token: string) {
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !isLocalBootstrapEnabled(),
    path: "/",
    // The browser keeps the cookie for the absolute lifetime; the server
    // decides, on every request, whether the session behind it is still
    // alive (idle window, absolute limit, sign out everywhere).
    maxAge: 60 * 60 * 24 * getServerEnv().SESSION_ABSOLUTE_DAYS,
    priority: "high",
  })
}

export function isLocalBootstrapEnabled() {
  const env = getServerEnv()
  if (!env.LOCAL_BOOTSTRAP_ENABLED || !env.NEXTAUTH_URL) return false

  const hostname = new URL(env.NEXTAUTH_URL).hostname
  return hostname === "localhost" || hostname === "127.0.0.1"
}

async function syncLocalOwnerIdentity(session: Session): Promise<Session> {
  if (session.userId !== LOCAL_USER_ID) return session

  const identity = await getDatabase().begin(async (sql) => {
    await sql`
      select set_config(
        'app.organisation_id',
        ${LOCAL_ORGANISATION_ID},
        true
      )
    `
    await sql`select set_config('app.user_id', ${LOCAL_USER_ID}, true)`
    const [googleIdentity] = await sql<
      { email: string | null; displayName: string | null }[]
    >`
      select
        gc.google_email as email,
        coalesce(ga.account_name, gc.google_email) as "displayName"
      from google_connection gc
      left join google_account ga
        on ga.google_connection_id = gc.id
       and ga.is_active = true
      where gc.organisation_id = ${LOCAL_ORGANISATION_ID}
        and gc.status = 'active'
      order by ga.is_active desc nulls last, gc.last_refresh_at desc nulls last
      limit 1
    `
    if (!googleIdentity?.email) return null
    const displayName = googleIdentity.displayName ?? googleIdentity.email
    const [updated] = await sql<{ email: string; displayName: string }[]>`
      update app_user
      set
        email = case
          when not exists (
            select 1
            from app_user other
            where other.email = ${googleIdentity.email}
              and other.id <> ${LOCAL_USER_ID}
          ) then ${googleIdentity.email}
          else email
        end,
        display_name = ${displayName},
        updated_at = now()
      where id = ${LOCAL_USER_ID}
      returning email, display_name as "displayName"
    `
    return updated ?? null
  })

  return identity
    ? { ...session, email: identity.email, displayName: identity.displayName }
    : session
}

export async function ensureDevelopmentSession(): Promise<Session> {
  const existing = await getSession()
  if (existing) return syncLocalOwnerIdentity(existing)
  if (process.env.NODE_ENV === "production" && !isLocalBootstrapEnabled()) {
    throw new ApiError(401, "authentication_required", "Please sign in.")
  }

  const token = await getDatabase().begin(async (sql) => {
    await sql`
      select set_config('app.organisation_id', ${LOCAL_ORGANISATION_ID}, true)
    `
    await sql`
      select provision_local_bootstrap(
        ${LOCAL_ORGANISATION_ID},
        ${LOCAL_USER_ID}
      )
    `
    return createSession(sql, LOCAL_USER_ID, LOCAL_ORGANISATION_ID)
  })

  await setSessionCookie(token)

  const session = await lookupSession(token)
  if (!session) throw new Error("Development session could not be created")
  return syncLocalOwnerIdentity(session)
}

/**
 * Sign this person out on every device and in every organisation. Keyed by
 * the caller's own token, so it can only end the caller's sessions. Leaves
 * every Google connection alone: those belong to the organisation, and
 * background sync keeps running.
 */
export async function revokeAllSessions(): Promise<number> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  let revoked = 0
  if (token) {
    const [row] = await getDatabase()<{ revoked: number }[]>`
      select revoke_user_sessions(${sha256(token)}) as revoked
    `
    revoked = row?.revoked ?? 0
  }
  cookieStore.delete(SESSION_COOKIE)
  return revoked
}

/**
 * Forgets the session cookie in this browser without touching the database.
 * For sign-out paths whose database step failed: the browser must still stop
 * presenting the token, even when its row could not be deleted.
 */
export async function dropSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE)
}

export async function clearSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token) {
    const tokenHash = sha256(token)
    await getDatabase().begin(async (sql) => {
      await sql`
        select set_config('app.session_token_hash', ${tokenHash}, true)
      `
      await sql`delete from app_session where token_hash = ${tokenHash}`
    })
  }
  cookieStore.delete(SESSION_COOKIE)
}
