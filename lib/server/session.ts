import "server-only"

import { cookies } from "next/headers"
import { cache } from "react"

import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { createSession } from "@/lib/server/session-store"

export { createSession }

const SESSION_COOKIE = "naba_session"
const LOCAL_ORGANISATION_ID = "00000000-0000-4000-8000-000000000001"
const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000002"

export type Session = {
  sessionId: string
  userId: string
  organisationId: string
  organisationName: string
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
}

async function lookupSession(rawToken: string): Promise<Session | null> {
  const tokenHash = sha256(rawToken)
  return getDatabase().begin(async (sql) => {
    await sql`
      select set_config('app.session_token_hash', ${tokenHash}, true)
    `
    const [sessionIdentity] = await sql<
      { sessionId: string; userId: string; organisationId: string }[]
    >`
      select
        id::text as "sessionId",
        user_id::text as "userId",
        organisation_id::text as "organisationId"
      from app_session
      where token_hash = ${tokenHash}
        and expires_at > now()
      limit 1
    `
    if (!sessionIdentity) return null
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
        u.display_name as "displayName",
        u.email,
        m.role,
        m.can_publish as "canPublish",
        s.support_actor as "supportActor",
        s.impersonation_reason as "impersonationReason"
      from app_session s
      join app_user u on u.id = s.user_id
      join organisation o on o.id = s.organisation_id
      join member m
        on m.organisation_id = s.organisation_id
       and m.user_id = s.user_id
      where s.id = ${sessionIdentity.sessionId}
      limit 1
    `
    await sql`
      update app_session
      set last_seen_at = now()
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
    maxAge: 60 * 60 * 24 * 30,
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
