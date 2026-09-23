import "server-only"

import { createHash } from "node:crypto"

import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import {
  googleApiTarget,
  googleRequest,
  googleTimeoutError,
  isAbortError,
} from "./transport"

const OAUTH_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/business.manage",
].join(" ")

export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/callback/google"

export type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope: string
  token_type: string
  id_token?: string
}

export function googleOAuthUrl(input: {
  state: string
  codeChallenge: string
  /** The Google account to preselect, when reconnecting a known login. */
  loginHint?: string | null
}): string {
  const env = getServerEnv()
  if (!env.GOOGLE_CLIENT_ID) {
    throw new ApiError(
      503,
      "google_not_configured",
      "Google OAuth credentials are not configured."
    )
  }
  const redirectUri = new URL(
    GOOGLE_OAUTH_CALLBACK_PATH,
    env.NEXTAUTH_URL ?? "http://localhost:3000"
  )
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri.toString(),
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  })
  if (input.loginHint) params.set("login_hint", input.loginHint)
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

export async function exchangeGoogleCode(
  code: string,
  verifier: string
): Promise<GoogleTokenResponse> {
  const env = getServerEnv()
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new ApiError(
      503,
      "google_not_configured",
      "Google OAuth credentials are not configured."
    )
  }
  const response = await fetch(
    googleApiTarget("https://oauth2.googleapis.com/token"),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: new URL(
          GOOGLE_OAUTH_CALLBACK_PATH,
          env.NEXTAUTH_URL ?? "http://localhost:3000"
        ).toString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(env.GOOGLE_TIMEOUT_MS),
    }
  ).catch((error) => {
    if (isAbortError(error)) throw googleTimeoutError()
    throw error
  })
  const body = (await response.json()) as GoogleTokenResponse & {
    error?: string
    error_description?: string
  }
  if (!response.ok) {
    throw new ApiError(
      502,
      body.error ?? "google_token_exchange_failed",
      body.error_description ?? "Google did not complete the token exchange."
    )
  }
  return body
}

export async function googleUserInfo(accessToken: string): Promise<{
  sub: string
  email?: string
  name?: string
  email_verified?: boolean
}> {
  return googleRequest(
    "https://openidconnect.googleapis.com/v1/userinfo",
    accessToken
  )
}
