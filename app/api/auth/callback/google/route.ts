import { cookies } from "next/headers"
import { after, NextResponse } from "next/server"
import { z, ZodError } from "zod"

import {
  prepareAutomaticGoogleReviewSetup,
  type AutomaticGoogleSetup,
} from "@/lib/server/automatic-google-setup"
import { attachConnectionToClient } from "@/lib/server/clients"
import { verifyOAuthState } from "@/lib/server/crypto"
import { getServerEnv } from "@/lib/server/env"
import {
  exchangeGoogleCode,
  GOOGLE_OAUTH_CALLBACK_PATH,
  googleUserInfo,
  grantsBusinessManage,
} from "@/lib/server/google"
import {
  completeAuthorisation,
  scopeMissingError,
} from "@/lib/server/google/connections"
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
  // The connection a reconnect was started for (and whose email went to
  // Google as login_hint), so a different account coming back is explicit.
  reconnectConnectionId: z.uuid().optional(),
  expiresAt: z.number(),
})

/**
 * Where the flow started, read from the state cookie for the error path.
 *
 * The success path reads it from the verified, parsed state. A failure may be
 * the state itself (expired, tampered), so this only trusts a cookie whose
 * signature checks out, ignores its expiry, and falls back to the default.
 * The path is still run through the allow-list: it names a page, nothing more.
 */
async function startedFrom(): Promise<string> {
  try {
    const stateCookie = (await cookies()).get("naba_google_oauth")?.value
    const [payload, signature] = stateCookie?.split(".") ?? []
    if (!payload || !signature || !verifyOAuthState(payload, signature)) {
      return DEFAULT_OAUTH_RETURN
    }
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    )
    const returnTo =
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "returnTo")
        : undefined
    return safeOAuthReturn(typeof returnTo === "string" ? returnTo : null)
  } catch {
    return DEFAULT_OAUTH_RETURN
  }
}

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
  if (!payload || !signature || !verifyOAuthState(payload, signature)) {
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
  // Checked before any other call: a token without Business Profile access
  // must not become (or replace the tokens of) an active connection.
  if (!grantsBusinessManage(tokens.scope)) throw scopeMissingError()
  const profile = await googleUserInfo(tokens.access_token)
  // Every credential and state write is the connection service's. The
  // client attach rides in its transaction: the setup wizard counts this
  // login as the client's from here on, even when Google shows it several
  // accounts or locations and nothing can be linked automatically. The
  // clientId came through the signed state, so Google's redirect cannot pick
  // which client this lands on.
  let attachedClientId: string | null = null
  const authorisation = await completeAuthorisation({
    organisationId: session.organisationId,
    userId: session.userId,
    tokens,
    profile,
    reconnectConnectionId: state.reconnectConnectionId ?? null,
    requestId,
    clientRequestId,
    attach: async (sql, connectionId) => {
      if (!state.clientId) return
      if (
        await attachConnectionToClient(sql, {
          organisationId: session.organisationId,
          clientId: state.clientId,
          connectionId,
          userId: session.userId,
        })
      ) {
        attachedClientId = state.clientId
      }
    },
  })
  const connection = { id: authorisation.connectionId }
  if (attachedClientId) {
    log.info("google.connection.attached_to_client", {
      requestId,
      organisationId: session.organisationId,
      clientId: attachedClientId,
    })
  }
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
  return {
    connection,
    setup,
    authorisation,
    returnTo: safeOAuthReturn(state.returnTo),
  }
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
const OAUTH_ERROR_REASONS = new Set([
  "google_scope_missing",
  "google_offline_access_missing",
])

// Browser redirect from Google: errors become a redirect, never a JSON body.
export const GET = route({
  auth: "public",
  handler: async ({ request, requestId, clientRequestId }) => {
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    // Read before completeOAuth: it deletes the state cookie once the session
    // matches, and a failure after that (the token exchange) must still know
    // where the flow started.
    const origin = await startedFrom()
    try {
      const { returnTo, authorisation } = await completeOAuth({
        request,
        requestId,
        clientRequestId,
      })
      // Back to the step the operator left, not to a settings page they never
      // asked for. The path came through the signed state and is checked
      // against an allow-list, so Google's redirect cannot choose it. The
      // extra flags are facts, never counts nobody has measured yet: whether
      // this was a reconnect, whether it came back as a different account,
      // and how many listings are now catching up.
      return NextResponse.redirect(
        new URL(
          withOAuthStatus(returnTo, {
            google: "connected",
            ...(authorisation.reconnected ? { reconnected: "1" } : {}),
            ...(authorisation.accountMismatch ? { mismatch: "1" } : {}),
            ...(authorisation.catchUpLocationIds.length
              ? { catchup: String(authorisation.catchUpLocationIds.length) }
              : {}),
          }),
          baseUrl
        )
      )
    } catch (error) {
      const status = String(redirectStatus(error, requestId))
      // A reason the page can explain better than a status number can.
      const reason: Record<string, string> =
        error instanceof ApiError && OAUTH_ERROR_REASONS.has(error.code)
          ? { reason: error.code }
          : {}
      // Back to where the flow started (the setup step, a client page), not
      // to Settings: an operator mid-setup would otherwise lose their place.
      // A lapsed session still goes to sign-in.
      const path =
        error instanceof ApiError && error.code === "authentication_required"
          ? "/sign-in"
          : origin
      // `rid` is the correlation id a user can quote in a support ticket; the
      // redirect is the only thing they can see.
      return NextResponse.redirect(
        new URL(
          withOAuthStatus(path, {
            google: "error",
            status,
            ...reason,
            rid: requestId,
          }),
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
