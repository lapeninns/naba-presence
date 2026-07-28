import "server-only"

import { cookies } from "next/headers"
import type { TransactionSql } from "postgres"

import { randomToken, sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

const SESSION_COOKIE = "naba_session"
const DEMO_ORGANISATION_ID = "00000000-0000-4000-8000-000000000001"
const DEMO_USER_ID = "00000000-0000-4000-8000-000000000002"

export type Session = {
  sessionId: string
  userId: string
  organisationId: string
  organisationName: string
  displayName: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
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
        m.can_publish as "canPublish"
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

export async function getSession(): Promise<Session | null> {
  const rawToken = (await cookies()).get(SESSION_COOKIE)?.value
  return rawToken ? lookupSession(rawToken) : null
}

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

export async function setSessionCookie(token: string) {
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.NODE_ENV === "production" && !isLocalBootstrapEnabled(),
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

export async function ensureDevelopmentSession(): Promise<Session> {
  const existing = await getSession()
  if (existing) return existing
  if (
    process.env.NODE_ENV === "production" &&
    !isLocalBootstrapEnabled()
  ) {
    throw new ApiError(401, "authentication_required", "Please sign in.")
  }

  const token = await getDatabase().begin(async (sql) => {
    await sql`
      select set_config('app.organisation_id', ${DEMO_ORGANISATION_ID}, true)
    `
    await sql`
      insert into organisation (id, slug, name)
      values (${DEMO_ORGANISATION_ID}, 'lapen-inns', 'Lapen Inns')
      on conflict (id) do update set name = excluded.name
    `
    await sql`
      insert into app_user (id, email, display_name)
      values (${DEMO_USER_ID}, 'demo@nabareview.local', 'Maya Khan')
      on conflict (id) do update set display_name = excluded.display_name
    `
    await sql`
      insert into member (
        organisation_id,
        user_id,
        role,
        can_publish
      )
      values (${DEMO_ORGANISATION_ID}, ${DEMO_USER_ID}, 'owner', true)
      on conflict (organisation_id, user_id)
      do update set role = 'owner', can_publish = true
    `
    return createSession(sql, DEMO_USER_ID, DEMO_ORGANISATION_ID)
  })

  await setSessionCookie(token)

  const session = await lookupSession(token)
  if (!session) throw new Error("Development session could not be created")
  return session
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
