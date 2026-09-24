import "server-only"

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

import { persistConnectionFailure } from "./connection-failures"
import { riscPrefixHash } from "./risc-fingerprint"
import { googleApiTarget } from "./transport"

/**
 * Google Cross-Account Protection (RISC) receiver logic.
 *
 * Verification follows developers.google.com/identity/protocols/risc:
 * signature against the keys named by Google's RISC discovery document,
 * issuer https://accounts.google.com/, audience one of our OAuth client
 * ids. Security event tokens describe past events and carry no expiry, so
 * none is required; `iat` must be present and not in the future. Replays are
 * dropped on the event's `jti` (risc_event, 0052).
 *
 * What each event does, through the connection service:
 *   token-revoked          the matching stored refresh token -> needs reconnect
 *   tokens-revoked         every connection of that Google account -> needs reconnect
 *   account-disabled       likewise, as google_account_disabled
 *   account-purged         likewise, as google_account_purged
 *   sessions-revoked,
 *   account-enabled,
 *   account-credential-change-required, verification
 *                          recorded only: platform sign-in is not Google sign-in,
 *                          and a connection that still works keeps working
 *
 * Refresh-time `invalid_grant` and API 401s stay the fallback: RISC delivery
 * has limited retries and Google does not send events for Workspace users.
 */

const RISC_DISCOVERY =
  "https://accounts.google.com/.well-known/risc-configuration"
const ISSUER = "https://accounts.google.com/"

const EVENT = {
  tokenRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/token-revoked",
  tokensRevoked:
    "https://schemas.openid.net/secevent/oauth/event-type/tokens-revoked",
  accountDisabled:
    "https://schemas.openid.net/secevent/risc/event-type/account-disabled",
  accountPurged:
    "https://schemas.openid.net/secevent/risc/event-type/account-purged",
  verification:
    "https://schemas.openid.net/secevent/risc/event-type/verification",
} as const

type Keys = ReturnType<typeof createRemoteJWKSet>
let cachedKeys: { at: number; keys: Keys; issuer: string } | undefined
const DISCOVERY_TTL_MS = 60 * 60 * 1000

async function signingKeys(): Promise<{ keys: Keys; issuer: string }> {
  if (cachedKeys && Date.now() - cachedKeys.at < DISCOVERY_TTL_MS)
    return cachedKeys
  const response = await fetch(googleApiTarget(RISC_DISCOVERY), {
    cache: "no-store",
    signal: AbortSignal.timeout(getServerEnv().GOOGLE_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new ApiError(
      503,
      "risc_discovery_unavailable",
      "RISC keys unavailable."
    )
  }
  const discovery = (await response.json()) as {
    issuer?: unknown
    jwks_uri?: unknown
  }
  if (typeof discovery.jwks_uri !== "string") {
    throw new ApiError(503, "risc_discovery_invalid", "RISC keys unavailable.")
  }
  cachedKeys = {
    at: Date.now(),
    keys: createRemoteJWKSet(new URL(googleApiTarget(discovery.jwks_uri))),
    issuer: typeof discovery.issuer === "string" ? discovery.issuer : ISSUER,
  }
  return cachedKeys
}

export function invalidRiscToken() {
  return new ApiError(
    400,
    "invalid_risc_token",
    "The security event token is invalid."
  )
}

export async function verifyRiscToken(token: string): Promise<JWTPayload> {
  const audience = getServerEnv().GOOGLE_CLIENT_ID
  if (!audience) {
    throw new ApiError(
      503,
      "google_not_configured",
      "Google OAuth is not configured."
    )
  }
  const { keys, issuer } = await signingKeys()
  let payload: JWTPayload
  try {
    ;({ payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      requiredClaims: ["jti", "iat"],
      clockTolerance: 60,
    }))
  } catch {
    throw invalidRiscToken()
  }
  if (
    typeof payload.iat === "number" &&
    payload.iat * 1000 > Date.now() + 60_000
  ) {
    throw invalidRiscToken()
  }
  return payload
}

type Subject = {
  subject_type?: string
  sub?: string
  iss?: string
  token_type?: string
  token_identifier_alg?: string
  token?: string
}

async function connectionsFor(subject: Subject) {
  const database = getDatabase()
  if (subject.token && subject.token_identifier_alg) {
    const sha512x2 =
      subject.token_identifier_alg === "hash_base64_sha512_sha512"
        ? subject.token
        : null
    const prefix =
      subject.token_identifier_alg === "prefix"
        ? riscPrefixHash(subject.token)
        : null
    if (!sha512x2 && !prefix) return []
    return database<{ organisationId: string; connectionId: string }[]>`
      select organisation_id::text as "organisationId", connection_id::text as "connectionId"
      from risc_connections_for_token(${sha512x2}, ${prefix})
    `
  }
  if (subject.sub) {
    return database<{ organisationId: string; connectionId: string }[]>`
      select organisation_id::text as "organisationId", connection_id::text as "connectionId"
      from risc_connections_for_subject(${subject.sub})
    `
  }
  return []
}

export type RiscOutcome = {
  duplicate: boolean
  eventTypes: string[]
  matchedConnections: number
}

/** Apply a verified event token. Idempotent on its jti. */
export async function applyRiscEvent(
  payload: JWTPayload
): Promise<RiscOutcome> {
  const events =
    typeof payload.events === "object" && payload.events !== null
      ? (payload.events as Record<
          string,
          { subject?: Subject; reason?: string }
        >)
      : {}
  const eventTypes = Object.keys(events)
  // A row still at 'received' is an event whose earlier delivery failed
  // part-way (the outcome is only written once every change is applied).
  // Google redelivers it, and treating that as a duplicate would drop the
  // revocation for good; the two-minute wait keeps a delivery that is still
  // being applied from being run twice at once.
  const [claimed] = await getDatabase()<{ jti: string }[]>`
    insert into risc_event (jti, event_types, outcome)
    values (${String(payload.jti)}, ${eventTypes}, 'received')
    on conflict (jti) do update
      set received_at = now()
      where risc_event.outcome = 'received'
        and risc_event.received_at < now() - interval '2 minutes'
    returning jti
  `
  if (!claimed) {
    return { duplicate: true, eventTypes, matchedConnections: 0 }
  }
  let matched = 0
  for (const [type, event] of Object.entries(events)) {
    const code =
      type === EVENT.tokenRevoked || type === EVENT.tokensRevoked
        ? "google_token_revoked"
        : type === EVENT.accountDisabled
          ? "google_account_disabled"
          : type === EVENT.accountPurged
            ? "google_account_purged"
            : null
    if (!code) continue
    const connections = await connectionsFor(event.subject ?? {})
    for (const connection of connections) {
      // No credential generation: the event names the account or the very
      // token stored, so it applies to what the row holds now. A connection
      // disconnected meanwhile is still left alone by the service.
      await persistConnectionFailure(connection, code)
      matched += 1
    }
  }
  await getDatabase()`
    update risc_event
    set matched_connections = ${matched},
        outcome = ${eventTypes.includes(EVENT.verification) ? "verification" : "applied"}
    where jti = ${String(payload.jti)}
  `
  log.info("google.risc_event", { eventTypes, matchedConnections: matched })
  return { duplicate: false, eventTypes, matchedConnections: matched }
}
