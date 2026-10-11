import "server-only"

import { cookies } from "next/headers"
import { z } from "zod"

import {
  decryptSecret,
  encryptSecret,
  randomToken,
  sha256,
} from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import type { ProviderFactor } from "@/lib/server/password-auth"
import { isLocalBootstrapEnabled } from "@/lib/server/session"
import type { SessionAssurance } from "@/lib/server/session-store"

/**
 * MFA foundation (P02-S8, ledger AUTH-05; migration 0200).
 *
 * The auth provider (Supabase Auth) holds the TOTP secrets and checks the
 * codes; this module carries the outcome into the app's own opaque sessions.
 *
 * A person with a verified TOTP factor does not get a session from their
 * password (or emailed link) alone. They get a pending ticket: a random value
 * in an httpOnly cookie, whose hash names a `mfa_pending_login` row holding
 * the provider's access token (encrypted) and what to complete once the code
 * is verified. The ticket lives five minutes and allows five code attempts;
 * a correct code spends it, exactly once, and mints an aal2 session.
 *
 * Enrolling uses the same ticket, bound to the enrolling session: the person
 * re-enters their password (the app keeps no provider token for a session),
 * the provider creates the factor, and verifying its first code raises that
 * session to aal2.
 *
 * Behind MFA_ENABLED (default off). Off, sign-in ignores factors exactly as
 * before and the MFA routes answer 404.
 */

export const MFA_TICKET_COOKIE = "naba_mfa_ticket"
export const MFA_TICKET_TTL_SECONDS = 5 * 60
export const MFA_MAX_ATTEMPTS = 5
/** How long a verified code counts as a recent proof (P02-S9 step-up). */
export const MFA_PROOF_MINUTES = 15
/** A primary factor and one backup. */
export const MFA_MAX_FACTORS = 2

export type MfaPurpose = "sign_in" | "enroll"

export function isMfaEnabled(): boolean {
  return getServerEnv().MFA_ENABLED
}

export function requireMfaEnabled(): void {
  if (!isMfaEnabled()) {
    throw new ApiError(404, "mfa_disabled", "Two-step verification is off.")
  }
}

// ---------------------------------------------------------------------------
// Provider tokens
// ---------------------------------------------------------------------------

const amrSchema = z.array(
  z.object({ method: z.string(), timestamp: z.number().optional() })
)

export type ProviderAssurance = {
  aal: "aal1" | "aal2"
  methods: string[]
}

/**
 * The assurance level the provider stated in an access token it issued: the
 * JWT's `aal` and `amr` claims. The token is not verified here: it arrived
 * over TLS straight from the provider in answer to our own call, and is never
 * accepted from a client. Anything unreadable is aal1.
 */
export function parseProviderAssurance(accessToken: string): ProviderAssurance {
  const fallback: ProviderAssurance = { aal: "aal1", methods: [] }
  const [, payload] = accessToken.split(".")
  if (!payload) return fallback
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    )
    if (typeof claims !== "object" || claims === null) return fallback
    const aal = Reflect.get(claims, "aal")
    const amr = amrSchema.safeParse(Reflect.get(claims, "amr"))
    return {
      aal: aal === "aal2" ? "aal2" : "aal1",
      methods: amr.success ? amr.data.map((entry) => entry.method) : [],
    }
  } catch {
    return fallback
  }
}

/** The assurance an aal2 session starts with after a verified code. */
export function verifiedAssurance(input: {
  factorId: string
  authMethod: string
  now?: Date
}): SessionAssurance {
  const verifiedAt = input.now ?? new Date()
  return {
    aal: "aal2",
    factorId: input.factorId,
    verifiedAt,
    proofExpiresAt: new Date(
      verifiedAt.getTime() + MFA_PROOF_MINUTES * 60 * 1000
    ),
    authMethod: input.authMethod,
  }
}

// ---------------------------------------------------------------------------
// Pending tickets
// ---------------------------------------------------------------------------

/** What a sign-in ticket completes once its code is verified. */
export const signInCompletionSchema = z.object({
  identity: z.object({
    provider: z.string().min(1),
    subject: z.string().min(1),
    email: z.string().min(1),
    displayName: z.string(),
    emailVerified: z.boolean(),
  }),
  inviteTokenHash: z.string().length(64).nullable(),
  passwordReset: z.boolean(),
  authMethod: z.string().min(1),
  /**
   * A reset by an enrolled person: the new password, encrypted
   * (lib/server/crypto.ts, base64). It is set only once the code is
   * verified, with the aal2 token, so the mailbox alone changes nothing.
   */
  newPasswordCiphertext: z.string().min(1).max(4096).nullable().default(null),
})
export type SignInCompletion = z.input<typeof signInCompletionSchema>

const factorListSchema = z.array(
  z.object({ id: z.string().min(1), friendlyName: z.string().nullable() })
)

export type PendingTicket = {
  id: string
  purpose: MfaPurpose
  authProvider: string
  authSubject: string
  userId: string | null
  sessionId: string | null
  factorId: string | null
  factors: ProviderFactor[]
  completion: unknown
  providerToken: string
  attempts: number
}

/**
 * Opens a ticket and returns its raw value (set it with setMfaTicketCookie).
 * Replaces any open ticket for the same identity and purpose.
 */
export async function createPendingTicket(input: {
  purpose: MfaPurpose
  authProvider: string
  authSubject: string
  userId?: string | null
  sessionId?: string | null
  factorId?: string | null
  factors?: ProviderFactor[]
  completion?: SignInCompletion | null
  providerToken: string
}): Promise<string> {
  const ticket = randomToken()
  const sql = getDatabase()
  await sql`
    select create_mfa_pending_login(
      ${sha256(ticket)},
      ${input.purpose},
      ${input.authProvider},
      ${input.authSubject},
      ${input.userId ?? null},
      ${input.sessionId ?? null},
      ${input.factorId ?? null},
      ${sql.json(input.factors ?? [])},
      ${sql.json(JSON.parse(JSON.stringify(input.completion ?? {})))},
      ${encryptSecret(input.providerToken)}
    )
  `
  return ticket
}

/** The factors a sign-in ticket may be answered with; null when gone. */
export async function readPendingTicket(ticket: string): Promise<{
  purpose: MfaPurpose
  factors: ProviderFactor[]
  expiresAt: Date
} | null> {
  const [row] = await getDatabase()<
    { purpose: MfaPurpose; factors: unknown; expiresAt: Date }[]
  >`
    select purpose, factors, expires_at as "expiresAt"
    from read_mfa_pending_login(${sha256(ticket)})
  `
  if (!row) return null
  const factors = factorListSchema.safeParse(row.factors)
  return {
    purpose: row.purpose,
    factors: factors.success ? factors.data : [],
    expiresAt: row.expiresAt,
  }
}

/**
 * Counts one code attempt against the ticket and returns it, or null when it
 * expired or used up its attempts.
 */
export async function takeTicketAttempt(
  ticket: string
): Promise<PendingTicket | null> {
  const [row] = await getDatabase()<
    (Omit<PendingTicket, "providerToken" | "factors"> & {
      factors: unknown
      providerTokenCiphertext: Buffer
    })[]
  >`
    select
      id::text as id,
      purpose,
      auth_provider as "authProvider",
      auth_subject as "authSubject",
      user_id::text as "userId",
      session_id::text as "sessionId",
      factor_id as "factorId",
      factors,
      completion,
      provider_token_ciphertext as "providerTokenCiphertext",
      attempts
    from take_mfa_pending_attempt(${sha256(ticket)}, ${MFA_MAX_ATTEMPTS})
  `
  if (!row) return null
  const { providerTokenCiphertext, factors, ...rest } = row
  const parsedFactors = factorListSchema.safeParse(factors)
  return {
    ...rest,
    factors: parsedFactors.success ? parsedFactors.data : [],
    providerToken: decryptSecret(providerTokenCiphertext),
  }
}

/** Spends the ticket; true for exactly one caller. */
export async function consumeTicket(ticket: string): Promise<boolean> {
  const [row] = await getDatabase()<{ consumed: boolean }[]>`
    select consume_mfa_pending_login(${sha256(ticket)}) as consumed
  `
  return row?.consumed === true
}

export async function discardTicket(ticket: string): Promise<void> {
  await getDatabase()`select discard_mfa_pending_login(${sha256(ticket)})`
}

/** Deletes expired tickets in batches; called by the retention cron. */
export async function purgeMfaPendingLogins(
  batchSize = 5_000,
  maxBatches = 20
): Promise<number> {
  let total = 0
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const [row] = await getDatabase()<{ count: number }[]>`
      select purge_mfa_pending_logins(${batchSize}) as count
    `
    const count = row?.count ?? 0
    total += count
    if (count < batchSize) break
  }
  return total
}

// ---------------------------------------------------------------------------
// Ticket cookie
// ---------------------------------------------------------------------------

export async function setMfaTicketCookie(ticket: string): Promise<void> {
  ;(await cookies()).set(MFA_TICKET_COOKIE, ticket, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !isLocalBootstrapEnabled(),
    // Only the MFA routes read it.
    path: "/api/auth/mfa",
    maxAge: MFA_TICKET_TTL_SECONDS,
    priority: "high",
  })
}

export async function readMfaTicketCookie(): Promise<string | null> {
  const value = (await cookies()).get(MFA_TICKET_COOKIE)?.value
  return value && value.length >= 32 && value.length <= 128 ? value : null
}

export async function clearMfaTicketCookie(): Promise<void> {
  ;(await cookies()).set(MFA_TICKET_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !isLocalBootstrapEnabled(),
    path: "/api/auth/mfa",
    maxAge: 0,
  })
}

export function ticketExpiredError(): ApiError {
  return new ApiError(
    401,
    "mfa_ticket_invalid",
    "Your sign-in has expired. Sign in again."
  )
}
