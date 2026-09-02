import { cookies } from "next/headers"
import { after, NextResponse } from "next/server"
import { z, ZodError } from "zod"

import { writeAudit } from "@/lib/server/audit"
import {
  prepareAutomaticGoogleReviewSetup,
  type AutomaticGoogleSetup,
} from "@/lib/server/automatic-google-setup"
import { encryptSecret, verifySignedValue } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { exchangeGoogleCode, googleUserInfo } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { syncLinkedLocation } from "@/lib/server/reviews"
import { route } from "@/lib/server/route"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const stateSchema = z.object({
  nonce: z.string().min(1),
  verifier: z.string().min(43),
  organisationId: z.uuid(),
  userId: z.uuid(),
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

type OAuthInput = {
  request: Request
  requestId: string
  clientRequestId: string | null
}

/**
 * The route is `auth: "public"` on purpose: the signed state cookie is
 * validated (and cleared) before the session is required, so a stale or
 * tampered state answers 400 rather than 401 regardless of sign-in status.
 * Owner/admin gating happens right after, exactly as before.
 */
async function completeOAuth({ request, requestId, clientRequestId }: OAuthInput) {
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

  const session = requireRole(await requireSession(), ["owner", "admin"])
  if (
    state.organisationId !== session.organisationId ||
    state.userId !== session.userId
  ) {
    throw new ApiError(
      403,
      "oauth_session_changed",
      "The active session changed."
    )
  }

  const tokens = await exchangeGoogleCode(params.code, state.verifier)
  const profile = await googleUserInfo(tokens.access_token)
  const refreshTokenExpiresAt = tokens.refresh_token_expires_in
    ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
    : null
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
      requestId: `${requestId}:connection`,
      metadata: {
        googleEmail: profile.email ?? null,
        previousStatus: existing?.status ?? null,
        clientRequestId,
      },
    })
    return row
  })
  let setup: AutomaticGoogleSetup
  try {
    setup = await prepareAutomaticGoogleReviewSetup({
      organisationId: session.organisationId,
      userId: session.userId,
      connectionId: connection.id,
      accessToken: tokens.access_token,
      requestId,
    })
  } catch (error) {
    const handledError =
      error instanceof Error ? error : new Error(String(error))
    log.warn("google.automatic_setup_fallback", {
      requestId,
      organisationId: session.organisationId,
      userId: session.userId,
      error: handledError,
    })
    setup = { kind: "manual_error" }
  }
  if (setup.kind === "automatic" && getServerEnv().SYNC_ENABLED) {
    after(async () => {
      try {
        const outcome = await syncLinkedLocation({
          organisationId: session.organisationId,
          externalLocationId: setup.externalLocationId,
          type: "backfill",
          maxPages: 10,
        })
        if (outcome.status === "failed") {
          log.warn("google.automatic_review_sync_failed", {
            requestId,
            organisationId: session.organisationId,
            errorCode: outcome.errorCode,
          })
        }
      } catch (error) {
        const handledError =
          error instanceof Error ? error : new Error(String(error))
        log.error("google.automatic_review_sync_failed", {
          requestId,
          organisationId: session.organisationId,
          error: handledError,
        })
      }
    })
  }
  return { connection, setup }
}

/**
 * The status `apiError` would have answered with, without building the JSON
 * response: the browser redirect only carries the number. Unknown errors are
 * logged the same way the error mapper logs them.
 */
function redirectStatus(error: unknown, requestId: string): number {
  if (error instanceof ApiError) return error.status
  if (error instanceof ZodError) return 400
  log.error("api.unhandled_error", { error, requestId })
  return 500
}

// Browser redirect from Google: errors become a redirect, never a JSON body.
export const GET = route({
  auth: "public",
  handler: async ({ request, requestId, clientRequestId }) => {
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    try {
      await completeOAuth({ request, requestId, clientRequestId })
      return NextResponse.redirect(
        new URL("/connections?google=connected", baseUrl)
      )
    } catch (error) {
      const status = String(redirectStatus(error, requestId))
      const path =
        error instanceof ApiError && error.code === "authentication_required"
          ? "/sign-in"
          : "/connections"
      return NextResponse.redirect(
        new URL(`${path}?google=error&status=${status}`, baseUrl)
      )
    }
  },
})

export const POST = route({
  auth: "public",
  handler: ({ request, requestId, clientRequestId }) =>
    completeOAuth({ request, requestId, clientRequestId }),
})
