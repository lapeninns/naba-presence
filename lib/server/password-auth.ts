import "server-only"

import { z } from "zod"

import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

const providerUserSchema = z.object({
  id: z.string().min(1),
  email: z.email().optional(),
  email_confirmed_at: z.string().nullable().optional(),
  confirmed_at: z.string().nullable().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
})

const providerSessionSchema = z.object({
  access_token: z.string().min(1).optional(),
  refresh_token: z.string().min(1).optional(),
  user: providerUserSchema.optional(),
})

export type PasswordIdentity = {
  provider: "supabase"
  subject: string
  email: string
  displayName: string
  emailVerified: boolean
}

class AuthProviderError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code)
  }
}

function providerConfiguration() {
  const env = getServerEnv()
  if (!env.PASSWORD_AUTH_ENABLED) {
    throw new ApiError(
      503,
      "password_auth_disabled",
      "Email and password sign-in is temporarily unavailable."
    )
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new ApiError(
      503,
      "auth_provider_unavailable",
      "Email and password sign-in is temporarily unavailable."
    )
  }
  return {
    baseUrl: env.SUPABASE_URL.replace(/\/$/, ""),
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    timeoutMs: env.AUTH_PROVIDER_TIMEOUT_MS,
  }
}

async function providerRequest(
  path: string,
  init: RequestInit & { accessToken?: string } = {}
): Promise<unknown> {
  const { baseUrl, publishableKey, timeoutMs } = providerConfiguration()
  const { accessToken, ...requestInit } = init
  const response = await fetch(`${baseUrl}/auth/v1${path}`, {
    ...requestInit,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      apikey: publishableKey,
      authorization: `Bearer ${accessToken ?? publishableKey}`,
      "content-type": "application/json",
      ...init.headers,
    },
  }).catch((error) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AuthProviderError(504, "auth_provider_timeout")
    }
    throw new AuthProviderError(503, "auth_provider_unavailable")
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const code =
      payload &&
      typeof payload === "object" &&
      "error_code" in payload &&
      typeof payload.error_code === "string"
        ? payload.error_code
        : "auth_provider_rejected"
    throw new AuthProviderError(response.status, code)
  }
  return payload
}

function identityFromUser(userValue: unknown): PasswordIdentity {
  const user = providerUserSchema.parse(userValue)
  if (!user.email) {
    throw new ApiError(
      403,
      "verified_email_required",
      "A verified email address is required."
    )
  }
  const metadata = user.user_metadata ?? {}
  const displayName =
    (typeof metadata.display_name === "string" && metadata.display_name) ||
    (typeof metadata.full_name === "string" && metadata.full_name) ||
    user.email.split("@")[0] ||
    "NabaPresence user"
  return {
    provider: "supabase",
    subject: user.id,
    email: user.email.trim().toLowerCase(),
    displayName: displayName.trim().slice(0, 120),
    emailVerified: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  }
}

function mapLoginFailure(error: unknown): never {
  if (error instanceof ApiError) throw error
  if (error instanceof AuthProviderError) {
    if (
      error.code === "email_not_confirmed" ||
      error.code === "email_not_verified"
    ) {
      throw new ApiError(
        403,
        "email_not_verified",
        "Confirm your email address before signing in."
      )
    }
    if (error.status === 400 || error.status === 401) {
      throw new ApiError(
        401,
        "invalid_credentials",
        "The email or password is incorrect."
      )
    }
    throw new ApiError(
      error.status === 429 ? 429 : 503,
      error.status === 429 ? "auth_rate_limited" : error.code,
      error.status === 429
        ? "Too many attempts. Try again later."
        : "Email and password sign-in is temporarily unavailable."
    )
  }
  throw error
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<PasswordIdentity> {
  try {
    const payload = providerSessionSchema.parse(
      await providerRequest("/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
    )
    if (!payload.user) {
      throw new AuthProviderError(502, "auth_provider_invalid_response")
    }
    const identity = identityFromUser(payload.user)
    if (!identity.emailVerified) {
      throw new ApiError(
        403,
        "email_not_verified",
        "Confirm your email address before signing in."
      )
    }
    return identity
  } catch (error) {
    mapLoginFailure(error)
  }
}

export async function signUpWithPassword(input: {
  email: string
  password: string
  displayName: string
  redirectTo: string
}): Promise<{
  identity: PasswordIdentity | null
  confirmationRequired: boolean
}> {
  try {
    const providerPayload = await providerRequest(
      `/signup?redirect_to=${encodeURIComponent(input.redirectTo)}`,
      {
        method: "POST",
        body: JSON.stringify({
          email: input.email.trim().toLowerCase(),
          password: input.password,
          data: { display_name: input.displayName.trim().slice(0, 120) },
        }),
      }
    )
    // GoTrue's REST endpoint returns the User directly when confirmation is
    // required, while autoconfirmed projects return a session-shaped payload.
    const directUser = providerUserSchema.safeParse(providerPayload)
    const sessionPayload = providerSessionSchema.safeParse(providerPayload)
    const user = directUser.success
      ? directUser.data
      : sessionPayload.success
        ? sessionPayload.data.user
        : undefined
    if (!user) {
      return { identity: null, confirmationRequired: true }
    }
    const identity = identityFromUser(user)
    return {
      identity: identity.emailVerified ? identity : null,
      confirmationRequired: !identity.emailVerified,
    }
  } catch (error) {
    if (error instanceof AuthProviderError) {
      if (error.status === 429) {
        throw new ApiError(
          429,
          "auth_rate_limited",
          "Too many attempts. Try again later."
        )
      }
      // Avoid exposing whether an account already exists.
      if (error.status === 400 || error.status === 422) {
        return { identity: null, confirmationRequired: true }
      }
      throw new ApiError(
        503,
        error.code,
        "Account creation is temporarily unavailable."
      )
    }
    throw error
  }
}

export async function verifyEmailToken(input: {
  tokenHash: string
  type: "email" | "recovery"
}): Promise<{ identity: PasswordIdentity; accessToken: string }> {
  try {
    const payload = providerSessionSchema.parse(
      await providerRequest("/verify", {
        method: "POST",
        body: JSON.stringify({
          token_hash: input.tokenHash,
          type: input.type,
        }),
      })
    )
    if (!payload.user || !payload.access_token) {
      throw new AuthProviderError(502, "auth_provider_invalid_response")
    }
    return {
      identity: identityFromUser(payload.user),
      accessToken: payload.access_token,
    }
  } catch (error) {
    if (error instanceof AuthProviderError) {
      throw new ApiError(
        400,
        "invalid_email_link",
        "This email link is invalid or expired."
      )
    }
    throw error
  }
}

export async function requestPasswordReset(
  email: string,
  redirectTo: string
): Promise<void> {
  try {
    await providerRequest(
      `/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      }
    )
  } catch (error) {
    // Password reset must not disclose whether an account exists. Rate limiting
    // remains enforced by the provider, but the public response stays uniform.
    if (error instanceof AuthProviderError) return
    throw error
  }
}

export async function updatePasswordWithToken(
  accessToken: string,
  password: string
): Promise<void> {
  try {
    await providerRequest("/user", {
      method: "PUT",
      accessToken,
      body: JSON.stringify({ password }),
    })
  } catch (error) {
    if (error instanceof AuthProviderError) {
      throw new ApiError(
        400,
        "password_reset_failed",
        "The reset session is invalid or expired."
      )
    }
    throw error
  }
}
