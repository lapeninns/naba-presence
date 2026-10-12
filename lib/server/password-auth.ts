import "server-only"

import { z } from "zod"

import {
  workspaceModeSchema,
  type WorkspaceMode,
} from "@/lib/contracts/session"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

const providerFactorSchema = z.object({
  id: z.string().min(1).max(128),
  factor_type: z.string(),
  status: z.string(),
  friendly_name: z.string().nullable().optional(),
})

const providerUserSchema = z.object({
  id: z.string().min(1),
  email: z.email().optional(),
  email_confirmed_at: z.string().nullable().optional(),
  confirmed_at: z.string().nullable().optional(),
  user_metadata: z.record(z.string(), z.unknown()).optional(),
  // GoTrue lists the user's MFA factors on the user object; absent (or null)
  // for a user who never enrolled.
  factors: z.array(providerFactorSchema).nullable().optional(),
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
  /**
   * The workspace mode chosen at registration, carried in the provider's
   * user metadata so it survives the email confirmation round trip. Absent
   * for invited sign-ups and for accounts created before the choice existed.
   */
  workspaceMode?: WorkspaceMode
}

/** A verified TOTP factor: the only kind a sign-in may be challenged with. */
export type ProviderFactor = { id: string; friendlyName: string | null }

/**
 * What a provider sign-in hands back besides the identity: the user's access
 * token (aal1) and the verified TOTP factors, so the caller can decide
 * whether the sign-in still needs a code (lib/server/mfa.ts).
 */
export type ProviderAuthentication = {
  identity: PasswordIdentity
  accessToken: string
  factors: ProviderFactor[]
}

export function verifiedTotpFactors(userValue: unknown): ProviderFactor[] {
  const user = providerUserSchema.safeParse(userValue)
  if (!user.success) return []
  return (user.data.factors ?? [])
    .filter(
      (factor) => factor.factor_type === "totp" && factor.status === "verified"
    )
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
    }))
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
  // Metadata is user-writable at the provider, so it only ever chooses
  // between the two modes a new owner may pick anyway, and only while the
  // registration choice is on; anything else is ignored and provisioning
  // falls back to business.
  const workspaceMode = getServerEnv().REGISTRATION_WORKSPACE_CHOICE_ENABLED
    ? workspaceModeSchema.safeParse(metadata.workspace_mode)
    : ({ success: false } as const)
  return {
    provider: "supabase",
    subject: user.id,
    email: user.email.trim().toLowerCase(),
    displayName: displayName.trim().slice(0, 120),
    emailVerified: Boolean(user.email_confirmed_at ?? user.confirmed_at),
    ...(workspaceMode.success ? { workspaceMode: workspaceMode.data } : {}),
  }
}

// D3: the login surface must not reveal whether an email is registered. An
// unverified account and a throttled attempt are made indistinguishable from a
// wrong password - the real provider behaviour is unchanged; only the
// user-facing code/status/message is normalised. (Sign-up / reset / resend keep
// their own documented 429 handling.)
function genericLoginFailure(): ApiError {
  return new ApiError(
    401,
    "invalid_credentials",
    "The email or password is incorrect."
  )
}

function mapLoginFailure(error: unknown): never {
  if (error instanceof ApiError) throw error
  if (error instanceof AuthProviderError) {
    if (
      error.code === "email_not_confirmed" ||
      error.code === "email_not_verified" ||
      error.status === 400 ||
      error.status === 401 ||
      error.status === 429 // 429 timing channel folded into the generic failure
    ) {
      throw genericLoginFailure()
    }
    throw new ApiError(
      503,
      error.code,
      "Email and password sign-in is temporarily unavailable."
    )
  }
  throw error
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<ProviderAuthentication> {
  try {
    const payload = providerSessionSchema.parse(
      await providerRequest("/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      })
    )
    if (!payload.user || !payload.access_token) {
      throw new AuthProviderError(502, "auth_provider_invalid_response")
    }
    const identity = identityFromUser(payload.user)
    if (!identity.emailVerified) {
      throw genericLoginFailure() // was: ApiError(403, "email_not_verified", …)
    }
    return {
      identity,
      accessToken: payload.access_token,
      factors: verifiedTotpFactors(payload.user),
    }
  } catch (error) {
    mapLoginFailure(error)
  }
}

export async function signUpWithPassword(input: {
  email: string
  password: string
  displayName: string
  /** Stored as provider metadata for provisioning after confirmation. */
  workspaceMode?: WorkspaceMode
  redirectTo: string
}): Promise<{
  identity: PasswordIdentity | null
  confirmationRequired: boolean
  /** Verified TOTP factors on the returned user (none for a new account). */
  factors: ProviderFactor[]
}> {
  try {
    const providerPayload = await providerRequest(
      `/signup?redirect_to=${encodeURIComponent(input.redirectTo)}`,
      {
        method: "POST",
        body: JSON.stringify({
          email: input.email.trim().toLowerCase(),
          password: input.password,
          data: {
            display_name: input.displayName.trim().slice(0, 120),
            ...(input.workspaceMode
              ? { workspace_mode: input.workspaceMode }
              : {}),
          },
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
      return { identity: null, confirmationRequired: true, factors: [] }
    }
    const identity = identityFromUser(user)
    return {
      identity: identity.emailVerified ? identity : null,
      confirmationRequired: !identity.emailVerified,
      factors: verifiedTotpFactors(user),
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
        return { identity: null, confirmationRequired: true, factors: [] }
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
}): Promise<ProviderAuthentication> {
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
      factors: verifiedTotpFactors(payload.user),
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
    // Password reset must not disclose whether an account exists, so every
    // provider error is swallowed by default. 429 is the one deliberate
    // exception: it is surfaced so a throttled caller learns to slow down,
    // rather than being told (falsely) that a reset email is on its way.
    //
    // This is only safe if GoTrue's 429 here is a generic, IP/project-scoped
    // limiter - i.e. account information, not a decision the caller made.
    // Residual risk: GoTrue's broader error taxonomy also includes a
    // recipient-scoped email-send-abuse limiter. If that bucket only accrues
    // for addresses with a real mailbox, repeated calls against a real
    // account could 429 sooner than against a fabricated one, which would
    // reopen a narrow enumeration channel this change does not close. We
    // cannot confirm which limiter applies from this repo alone.
    // Follow-up: once the deployed GoTrue's error codes are confirmed, branch
    // on error.code (not just error.status) so only the generic per-caller
    // bucket is surfaced and a recipient-scoped one keeps being swallowed.
    if (error instanceof AuthProviderError) {
      if (error.status === 429) {
        throw new ApiError(
          429,
          "auth_rate_limited",
          "Too many attempts. Try again later."
        )
      }
      return
    }
    throw error
  }
}

export async function resendConfirmationEmail(
  email: string,
  redirectTo: string
): Promise<void> {
  try {
    await providerRequest(
      `/resend?redirect_to=${encodeURIComponent(redirectTo)}`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "signup",
          email: email.trim().toLowerCase(),
        }),
      }
    )
  } catch (error) {
    if (error instanceof AuthProviderError) {
      if (error.status === 429) {
        // Deliberately surfaced - see requestPasswordReset for the full
        // rationale. Safe only if GoTrue's 429 here is IP/project-scoped;
        // a recipient-scoped send-limit bucket would reopen a narrow
        // enumeration channel this change does not close.
        throw new ApiError(
          429,
          "auth_rate_limited",
          "Too many attempts. Try again later."
        )
      }
      // Never disclose whether the address belongs to an account.
      return
    }
    throw error
  }
}

function passwordRejected(): ApiError {
  return new ApiError(
    400,
    "password_reset_failed",
    "The reset session is invalid or expired."
  )
}

export async function updatePasswordWithToken(
  accessToken: string,
  password: string
): Promise<void> {
  const put = () =>
    providerRequest("/user", {
      method: "PUT",
      accessToken,
      body: JSON.stringify({ password }),
    })
  try {
    await put()
  } catch (error) {
    if (!(error instanceof AuthProviderError)) throw error
    // A 4xx is a decision: the recovery token was spent or the password was
    // refused, and nothing changed. A timeout (504) or a provider fault
    // (503/5xx) is ambiguous -- the password may already be live. Reporting
    // both as "your link is invalid" sent people back to a link they could
    // not reuse, with a password they did not know had changed.
    if (error.status < 500) throw passwordRejected()
    try {
      // Setting a password is an absolute write, so replaying it costs
      // nothing and usually turns the ambiguity into a definite answer.
      await put()
    } catch (retryError) {
      if (!(retryError instanceof AuthProviderError)) throw retryError
      // The provider refusing a repeat of the same password is proof the
      // first attempt landed.
      if (retryError.code === "same_password") return
      if (retryError.status < 500) throw passwordRejected()
      throw new ApiError(
        503,
        "password_reset_outcome_unknown",
        "We could not confirm whether your new password was saved. Try signing in with the new password before requesting another reset link."
      )
    }
  }
}

// ---------------------------------------------------------------------------
// MFA (P02-S8). Every call below acts as the user, with the access token a
// sign-in returned; the provider holds the TOTP secrets and checks the codes.
// ---------------------------------------------------------------------------

const enrolledFactorSchema = z.object({
  id: z.string().min(1).max(128),
  totp: z.object({
    qr_code: z.string().min(1),
    secret: z.string().min(1),
    uri: z.string().min(1),
  }),
})

const challengeSchema = z.object({ id: z.string().min(1) })

/**
 * GoTrue versions differ: some return the QR code as a `data:image/svg+xml`
 * URI, older ones as bare SVG markup. Always hand the client an image data
 * URI, and nothing else (no remote URL ever reaches an <img>).
 */
export function qrCodeDataUri(value: string): string {
  const trimmed = value.trim()
  if (/^data:image\/(svg\+xml|png)[;,]/.test(trimmed)) return trimmed
  if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) {
    return `data:image/svg+xml;utf-8,${encodeURIComponent(trimmed)}`
  }
  throw new ApiError(
    503,
    "auth_provider_invalid_response",
    "Two-step verification is temporarily unavailable."
  )
}

export type TotpEnrollment = {
  factorId: string
  qrCode: string
  secret: string
  uri: string
}

function mfaProviderFailure(error: unknown): never {
  if (error instanceof ApiError) throw error
  if (error instanceof AuthProviderError) {
    if (error.status === 429) {
      throw new ApiError(
        429,
        "auth_rate_limited",
        "Too many attempts. Try again later."
      )
    }
    if (error.status === 401 || error.status === 403) {
      throw new ApiError(
        401,
        "mfa_ticket_invalid",
        "Your sign-in has expired. Sign in again."
      )
    }
    throw new ApiError(
      503,
      error.code,
      "Two-step verification is temporarily unavailable."
    )
  }
  throw error
}

/** The user's verified TOTP factors, read fresh from the provider. */
export async function listFactors(
  accessToken: string
): Promise<ProviderFactor[]> {
  try {
    return verifiedTotpFactors(
      await providerRequest("/user", { method: "GET", accessToken })
    )
  } catch (error) {
    mfaProviderFailure(error)
  }
}

/**
 * Starts a TOTP enrollment: the provider creates an unverified factor and
 * returns its secret, which the person adds to an authenticator app. The
 * factor counts only once a code from it is verified. A person who already
 * has a verified factor needs an aal2 token for this (GoTrue's rule).
 */
export async function enrollTotp(
  accessToken: string,
  friendlyName: string
): Promise<TotpEnrollment> {
  try {
    const payload = enrolledFactorSchema.parse(
      await providerRequest("/factors", {
        method: "POST",
        accessToken,
        body: JSON.stringify({
          factor_type: "totp",
          friendly_name: friendlyName,
          issuer: "NabaPresence",
        }),
      })
    )
    return {
      factorId: payload.id,
      qrCode: qrCodeDataUri(payload.totp.qr_code),
      secret: payload.totp.secret,
      uri: payload.totp.uri,
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(
        503,
        "auth_provider_invalid_response",
        "Two-step verification is temporarily unavailable."
      )
    }
    mfaProviderFailure(error)
  }
}

/**
 * Challenges a factor and verifies the code against it in one step (the
 * challenge carries nothing the person needs to see for TOTP). Returns the
 * provider session the verification minted, whose token says aal2, and the
 * user's verified factors after it.
 *
 * A wrong code is 400 `mfa_code_invalid`; the caller counts attempts.
 */
export async function challengeAndVerifyFactor(input: {
  accessToken: string
  factorId: string
  code: string
}): Promise<{ accessToken: string; factors: ProviderFactor[] }> {
  const factorPath = `/factors/${encodeURIComponent(input.factorId)}`
  let challengeId: string
  try {
    challengeId = challengeSchema.parse(
      await providerRequest(`${factorPath}/challenge`, {
        method: "POST",
        accessToken: input.accessToken,
        body: JSON.stringify({}),
      })
    ).id
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(
        503,
        "auth_provider_invalid_response",
        "Two-step verification is temporarily unavailable."
      )
    }
    mfaProviderFailure(error)
  }
  try {
    const payload = providerSessionSchema.parse(
      await providerRequest(`${factorPath}/verify`, {
        method: "POST",
        accessToken: input.accessToken,
        body: JSON.stringify({ challenge_id: challengeId, code: input.code }),
      })
    )
    if (!payload.access_token) {
      throw new AuthProviderError(502, "auth_provider_invalid_response")
    }
    return {
      accessToken: payload.access_token,
      factors: verifiedTotpFactors(payload.user),
    }
  } catch (error) {
    // GoTrue answers a wrong or replayed code with 422
    // mfa_verification_failed (older versions 400).
    if (
      error instanceof AuthProviderError &&
      (error.status === 400 || error.status === 422)
    ) {
      throw new ApiError(
        400,
        "mfa_code_invalid",
        "That code did not match. Check your authenticator app and try again."
      )
    }
    mfaProviderFailure(error)
  }
}
