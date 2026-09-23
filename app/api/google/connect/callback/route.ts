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
import {
  exchangeGoogleCode,
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleUserInfo,
  grantsBusinessManage,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { syncLinkedLocation } from "@/lib/server/reviews"
import { route } from "@/lib/server/route"
import {
  DEFAULT_OAUTH_RETURN,
  safeOAuthReturn,
  withOAuthStatus,
} from "@/lib/server/oauth-return"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const stateSchema = z.object({
  nonce: z.string().min(1),
  verifier: z.string().min(43),
  organisationId: z.uuid(),
  userId: z.uuid(),
  // Optional so a state minted before these existed still parses.
  clientId: z.uuid().optional(),
  returnTo: z.string().optional(),
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
 * validated before the session is required, so a stale or tampered state
 * answers 400 rather than 401 regardless of sign-in status. Owner/admin gating
 * happens right after, and the cookie is cleared only once the state has been
 * matched to that session — see the `cookieStore.delete` comment below.
 */
async function completeOAuth({
  request,
  requestId,
  clientRequestId,
}: OAuthInput) {
  const params = await oauthParameters(request)
  if (params.error) {
    throw new ApiError(400, "google_oauth_denied", params.error)
  }
  if (!params.code || !params.state) {
    throw new ApiError(400, "invalid_oauth_callback", "Missing OAuth response.")
  }
  const cookieStore = await cookies()
  const stateCookie = cookieStore.get("naba_google_oauth")?.value
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

  // Spend the nonce and the PKCE verifier here, on the path `connect/start`
  // set them on. A bare `delete("naba_google_oauth")` emits `Path=/`, and a
  // cookie is keyed by name+domain+path, so it never evicted the one stored at
  // GOOGLE_OAUTH_CALLBACK_PATH: the spent state survived its full 10-minute
  // maxAge and a Back or a reload replayed the authorization code at Google.
  // Clearing it only after `requireSession` is deliberate - a session that
  // lapsed mid-consent throws above with the code still unspent, so signing in
  // and returning to this URL still completes the connection.
  cookieStore.delete({
    name: "naba_google_oauth",
    path: GOOGLE_OAUTH_CALLBACK_PATH,
  })

  const tokens = await exchangeGoogleCode(params.code, state.verifier)
  // Google's consent screen lets a person untick Business Profile access. A
  // token without it signs in fine and then fails every call, so it must not
  // become (or replace the tokens of) an active connection.
  if (!grantsBusinessManage(tokens.scope)) {
    throw new ApiError(
      403,
      "google_scope_missing",
      "Google did not grant permission to manage Business Profiles."
    )
  }
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
    // Re-consenting with a different Google account is a different subject,
    // so it lands on a new connection and the old row's reconnect task stays
    // open forever. Mark those superseded rather than resolving them - the
    // old connection's locations really are still unlinked work - and let the
    // shell banner scope itself to the live connection instead.
    const superseded = await sql`
      update connection_task
      set reason_code = 'superseded_by_reconnect'
      where google_connection_id <> ${row.id}
        and task_type = 'reconnect'
        and status = 'open'
      returning id
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
        supersededReconnectTasks: superseded.length,
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
      // The location this discovers belongs to the client the operator was
      // setting up. Without it, a freshly connected listing lands unassigned
      // and has to be filed by hand immediately after.
      clientId: state.clientId ?? null,
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
  return { connection, setup, returnTo: safeOAuthReturn(state.returnTo) }
}

/**
 * The status `apiError` would have answered with, without building the JSON
 * response: the browser redirect only carries the number. Every non-success
 * outcome is logged with its code — an expired state cookie, a lapsed
 * session, a denied consent and a rotated client secret all redirect to the
 * same `status=` number, and nothing else on this path writes a log line.
 */
function redirectStatus(error: unknown, requestId: string): number {
  const status =
    error instanceof ApiError
      ? error.status
      : error instanceof ZodError
        ? 400
        : 500
  if (status === 500) log.error("api.unhandled_error", { error, requestId })
  log.warn("google.connect_failed", {
    requestId,
    status,
    code:
      error instanceof ApiError
        ? error.code
        : error instanceof ZodError
          ? "invalid_request"
          : "unknown",
  })
  return status
}

/** Error codes the connections page has its own wording for. */
const OAUTH_ERROR_REASONS = new Set(["google_scope_missing"])

// Browser redirect from Google: errors become a redirect, never a JSON body.
export const GET = route({
  auth: "public",
  handler: async ({ request, requestId, clientRequestId }) => {
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    try {
      const { returnTo } = await completeOAuth({
        request,
        requestId,
        clientRequestId,
      })
      // Back to the step the operator left, not to a settings page they never
      // asked for. The path came through the signed state and is checked
      // against an allow-list, so Google's redirect cannot choose it.
      return NextResponse.redirect(
        new URL(withOAuthStatus(returnTo, { google: "connected" }), baseUrl)
      )
    } catch (error) {
      const status = String(redirectStatus(error, requestId))
      // A reason the page can explain better than a status number can.
      const reason =
        error instanceof ApiError && OAUTH_ERROR_REASONS.has(error.code)
          ? `&reason=${error.code}`
          : ""
      // The error path cannot read the state (that is often what failed), so
      // it falls back to the connections page.
      const path =
        error instanceof ApiError && error.code === "authentication_required"
          ? "/sign-in"
          : DEFAULT_OAUTH_RETURN
      // `rid` is the correlation id a user can quote in a support ticket; the
      // redirect is the only thing they can see.
      return NextResponse.redirect(
        new URL(
          `${path}?google=error&status=${status}${reason}&rid=${requestId}`,
          baseUrl
        )
      )
    }
  },
})

export const POST = route({
  auth: "public",
  handler: ({ request, requestId, clientRequestId }) =>
    completeOAuth({ request, requestId, clientRequestId }),
})
