import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { encryptSecret, sha256, verifySignedValue } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { exchangeGoogleCode, googleUserInfo } from "@/lib/server/google"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import {
  createSession,
  getSession,
  setSessionCookie,
} from "@/lib/server/session"
import { writeAudit } from "@/lib/server/audit"

export const runtime = "nodejs"

const stateSchema = z.object({
  nonce: z.string().min(1),
  verifier: z.string().min(43),
  organisationId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
  expiresAt: z.number(),
})

async function oauthParameters(request: Request) {
  if (request.method === "GET") {
    const url = new URL(request.url)
    return {
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      error: url.searchParams.get("error"),
    }
  }
  const body = await request.json()
  return {
    code: typeof body.code === "string" ? body.code : null,
    state: typeof body.state === "string" ? body.state : null,
    error: typeof body.error === "string" ? body.error : null,
  }
}

async function provisionOwner(profile: {
  sub: string
  email?: string
  name?: string
}) {
  return getDatabase().begin(async (sql) => {
    const slugBase = (profile.email?.split("@")[0] ?? profile.sub)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40)
    const [user] = await sql<
      { id: string; default_organisation_id: string | null }[]
    >`
      insert into app_user (email, display_name, google_subject)
      values (
        ${profile.email ?? `${profile.sub}@google.invalid`},
        ${profile.name ?? profile.email ?? "Google user"},
        ${profile.sub}
      )
      on conflict (email) do update
      set google_subject = excluded.google_subject,
          display_name = excluded.display_name
      returning
        id::text as id,
        default_organisation_id::text as default_organisation_id
    `
    let organisationId = user.default_organisation_id
    if (!organisationId) {
      const [organisation] = await sql<{ id: string }[]>`
        insert into organisation (slug, name)
        values (
          ${`${slugBase || "organisation"}-${sha256(profile.sub).slice(0, 8)}`},
          ${profile.name ? `${profile.name}'s organisation` : "My organisation"}
        )
        returning id::text as id
      `
      organisationId = organisation.id
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
      await sql`
        insert into member (
          organisation_id,
          user_id,
          role,
          can_publish
        )
        values (${organisationId}, ${user.id}, 'owner', true)
      `
      await sql`
        update app_user
        set default_organisation_id = ${organisationId}
        where id = ${user.id}
      `
    } else {
      await sql`
        select set_config('app.organisation_id', ${organisationId}, true)
      `
    }
    const token = await createSession(sql, user.id, organisationId)
    return { organisationId, userId: user.id, token }
  })
}

async function completeOAuth(request: Request) {
  const correlationId = requestId(request)
  const params = await oauthParameters(request)
  if (params.error) {
    throw new ApiError(400, "google_oauth_denied", params.error)
  }
  if (!params.code || !params.state) {
    throw new ApiError(400, "invalid_oauth_callback", "Missing OAuth response.")
  }
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get("naba_google_oauth")?.value
  cookieStore.delete("naba_google_oauth")
  if (!stateCookie) {
    throw new ApiError(400, "invalid_oauth_state", "OAuth state has expired.")
  }
  const [payload, signature] = stateCookie.split(".")
  if (!payload || !signature || !verifySignedValue(payload, signature)) {
    throw new ApiError(400, "invalid_oauth_state", "OAuth state is invalid.")
  }
  const state = stateSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  )
  if (state.expiresAt < Date.now() || state.nonce !== params.state) {
    throw new ApiError(400, "invalid_oauth_state", "OAuth state has expired.")
  }

  const tokens = await exchangeGoogleCode(params.code, state.verifier)
  const profile = await googleUserInfo(tokens.access_token)
  const refreshTokenExpiresAt = tokens.refresh_token_expires_in
    ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
    : null
  let session = await getSession()
  let sessionToken: string | undefined
  if (!session) {
    const provisioned = await provisionOwner(profile)
    sessionToken = provisioned.token
    session = {
      sessionId: "",
      userId: provisioned.userId,
      organisationId: provisioned.organisationId,
      organisationName: "",
      displayName: profile.name ?? profile.email ?? "Google user",
      email: profile.email ?? "",
      role: "owner",
      canPublish: true,
    }
  }
  if (
    state.organisationId &&
    (state.organisationId !== session.organisationId ||
      state.userId !== session.userId)
  ) {
    throw new ApiError(
      403,
      "oauth_session_changed",
      "The active session changed."
    )
  }

  const connection = await withTenant(session.organisationId, async (sql) => {
    const [existing] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status
      from google_connection
      where google_subject = ${profile.sub}
      limit 1
    `
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
        disconnected_at,
        purge_due_at
      )
      values (
        ${session.organisationId},
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
        null
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
        refresh_token_expires_at = coalesce(
          excluded.refresh_token_expires_at,
          google_connection.refresh_token_expires_at
        ),
        last_refresh_at = now(),
        last_error_code = null,
        disconnected_at = null,
        purge_due_at = null
      returning id::text as id
    `
    await sql`
      update connection_task
      set status = 'completed', resolved_at = now()
      where google_connection_id = ${row.id}
        and task_type = 'reconnect'
        and status = 'open'
    `
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: existing
        ? "google.connection.reconnected"
        : "google.connection.connected",
      subjectType: "google_connection",
      subjectId: row.id,
      requestId: `${correlationId}:connection`,
      metadata: {
        googleEmail: profile.email ?? null,
        previousStatus: existing?.status ?? null,
      },
    })
    if (sessionToken) {
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "user.signed_in",
        subjectType: "user",
        subjectId: session.userId,
        requestId: `${correlationId}:signin`,
        metadata: { provider: "google" },
      })
    }
    return row
  })
  if (sessionToken) await setSessionCookie(sessionToken)
  return { connection }
}

export async function GET(request: Request) {
  const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
  try {
    await completeOAuth(request)
    return NextResponse.redirect(new URL("/?google=connected", baseUrl))
  } catch (error) {
    const response = apiError(error)
    if (response.status >= 400) {
      return NextResponse.redirect(
        new URL(`/?google=error&status=${response.status}`, baseUrl)
      )
    }
    return response
  }
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await completeOAuth(request))
  } catch (error) {
    return apiError(error)
  }
}
