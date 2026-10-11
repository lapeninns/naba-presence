import "server-only"

import { createHmac } from "node:crypto"
import { isIP } from "node:net"

import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

/**
 * Application abuse limits (ledger SEC-07, SEC-08; migration 0085).
 *
 * Each protected action has a scope, and each scope counts hits per key kind
 * in fixed windows held in Postgres, so every instance shares one count:
 * a login is counted against the client IP and, separately, against the
 * email it names. Any key over its limit refuses the request with 429 and
 * `details.retryAfter` (seconds), mirrored in the Retry-After header by
 * apiError.
 *
 * Keys are HMAC-SHA256 digests under NEXTAUTH_SECRET, never plaintext, so the
 * table says nothing about who tried to sign in. A refused attempt is counted
 * like any other: hammering a limited key keeps it limited until the window
 * ends. Counting is the same whether or not the email has an account, so the
 * limit itself reveals nothing about which mailboxes exist (SEC-09).
 *
 * The client IP comes only from a header the platform overwrites
 * (clientIpFromHeaders). With no trusted header there is no IP key, and the
 * scope's other keys still apply; a scope keyed by IP alone is then
 * unlimited, which is the self-hosted default until CLIENT_IP_HEADER names
 * the proxy's header.
 *
 * It fails closed: an error reading the counter propagates as a 500. Every
 * protected action needs the same database anyway, so failing open would buy
 * nothing but an unthrottled path during an incident.
 *
 * The limits below are engineering defaults pending product and security
 * sign-off (decision D-21).
 */

export type AbuseKeyKind = "ip" | "email" | "user" | "token" | "organisation"

type Window = { limit: number; windowSeconds: number }

const MINUTES_15 = 15 * 60
const HOUR = 60 * 60

export const ABUSE_POLICIES = {
  // Password guessing: per IP leaves room for an office behind one NAT; per
  // email stops a distributed guesser on one account. Any per-account limit
  // lets a stranger who knows the address lock its owner out of password
  // sign-in for a window, because their wrong guesses count against it too.
  // The email limit is three times the IP limit so that takes at least three
  // addresses each at their own cap, not one (D-21, SEC-07).
  login: {
    code: "auth_rate_limited",
    ip: { limit: 30, windowSeconds: MINUTES_15 },
    email: { limit: 90, windowSeconds: MINUTES_15 },
  },
  // The next three send mail. Per email bounds what one address receives,
  // and with it the same trade-off: one address can spend another's
  // allowance and hold back its confirmation or recovery mail for the hour.
  register: {
    code: "auth_rate_limited",
    ip: { limit: 20, windowSeconds: HOUR },
    email: { limit: 5, windowSeconds: HOUR },
  },
  resend_confirmation: {
    code: "auth_rate_limited",
    ip: { limit: 20, windowSeconds: HOUR },
    email: { limit: 3, windowSeconds: HOUR },
  },
  reset_request: {
    code: "auth_rate_limited",
    ip: { limit: 20, windowSeconds: HOUR },
    email: { limit: 3, windowSeconds: HOUR },
  },
  reset_complete: {
    code: "auth_rate_limited",
    ip: { limit: 20, windowSeconds: MINUTES_15 },
    token: { limit: 5, windowSeconds: MINUTES_15 },
  },
  // The emailed confirmation link (GET /auth/confirm), which verifies a token
  // and can accept an invitation. A redirect, so a refusal lands on sign-in.
  confirm_email: {
    code: "auth_rate_limited",
    ip: { limit: 30, windowSeconds: MINUTES_15 },
  },
  // Token probing: an unknown token is as expensive to the prober as a real
  // one, and per IP is what bounds enumeration.
  invitation_lookup: {
    code: "auth_rate_limited",
    ip: { limit: 60, windowSeconds: MINUTES_15 },
  },
  invitation_accept: {
    code: "auth_rate_limited",
    ip: { limit: 30, windowSeconds: MINUTES_15 },
    user: { limit: 10, windowSeconds: MINUTES_15 },
  },
  // TOTP code guessing (P02-S8). Each ticket also caps itself at five
  // attempts (lib/server/mfa.ts); these bound a person or address opening
  // ticket after ticket. Per user covers enrollment, which runs in a session.
  mfa_verify: {
    code: "auth_rate_limited",
    ip: { limit: 30, windowSeconds: MINUTES_15 },
    token: { limit: 10, windowSeconds: MINUTES_15 },
    user: { limit: 20, windowSeconds: MINUTES_15 },
  },
  // Enrollment re-checks the password (and, for a backup, a current code).
  mfa_enroll: {
    code: "auth_rate_limited",
    ip: { limit: 20, windowSeconds: MINUTES_15 },
    user: { limit: 10, windowSeconds: HOUR },
  },
  // Viewers of a shared report reload it; probers walk tokens.
  report_share: {
    code: "auth_rate_limited",
    ip: { limit: 120, windowSeconds: MINUTES_15 },
  },
  // Counted before the support secret is compared.
  support_impersonation: {
    code: "auth_rate_limited",
    ip: { limit: 10, windowSeconds: HOUR },
  },
  // Bursts inside the monthly AI allowance: per person, and per organisation
  // so many members cannot drain it in one go.
  ai_draft: {
    code: "draft_rate_limited",
    user: { limit: 30, windowSeconds: 10 * 60 },
    organisation: { limit: 120, windowSeconds: 10 * 60 },
  },
} as const satisfies Record<
  string,
  { code: string } & Partial<Record<AbuseKeyKind, Window>>
>

export type AbuseScope = keyof typeof ABUSE_POLICIES

export type AbuseSubject = Partial<
  Record<AbuseKeyKind, string | null | undefined>
>

/** What a route's `limits` hook returns; the wrapper fills in `ip`. */
export type AbuseLimit = { scope: AbuseScope } & AbuseSubject

const KEY_KINDS: readonly AbuseKeyKind[] = [
  "ip",
  "email",
  "user",
  "token",
  "organisation",
]

const MESSAGES: Record<string, string> = {
  auth_rate_limited: "Too many attempts. Try again later.",
  draft_rate_limited:
    "Too many drafts were requested in a short time. Wait a moment and try again.",
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

/**
 * The header that carries the client IP, or null when none is trusted.
 * Vercel overwrites x-vercel-forwarded-for on every request, so a value a
 * client sends there never reaches the app; plain x-forwarded-for is never
 * trusted by default because anything in front of the platform can append
 * to it.
 */
export function trustedClientIpHeader(): string | null {
  const configured = getServerEnv().CLIENT_IP_HEADER
  if (configured) return configured
  return process.env.VERCEL ? "x-vercel-forwarded-for" : null
}

/** Eight 16-bit groups of an address isIP() already accepted as IPv6. */
function expandIpv6(address: string): number[] | null {
  let text = address
  const lastColon = text.lastIndexOf(":")
  const lastPart = text.slice(lastColon + 1)
  if (lastPart.includes(".")) {
    // A trailing dotted quad (::ffff:192.0.2.1) is the last two groups.
    const [a, b, c, d] = lastPart.split(".").map(Number)
    const high = ((a << 8) | b).toString(16)
    const low = ((c << 8) | d).toString(16)
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`
  }
  const groups = (part: string) =>
    part === "" ? [] : part.split(":").map((group) => parseInt(group, 16))
  const halves = text.split("::")
  if (halves.length === 1) {
    const all = groups(text)
    return all.length === 8 ? all : null
  }
  const left = groups(halves[0])
  const right = groups(halves[1])
  const missing = 8 - left.length - right.length
  if (missing < 1) return null
  return [...left, ...Array<number>(missing).fill(0), ...right]
}

/**
 * Normalises one address into the key it is limited by: IPv4 as is (an
 * IPv4-mapped IPv6 address too), IPv6 by its /64, the smallest block one
 * subscriber is usually given, so rotating through a single allocation does
 * not mint fresh buckets.
 */
export function normaliseClientIp(raw: string): string | null {
  let value = raw.trim()
  if (value.startsWith("[")) value = value.slice(1, value.indexOf("]"))
  const version = isIP(value)
  if (version === 4) return value
  if (version !== 6) return null
  const groups = expandIpv6(value.toLowerCase())
  if (!groups) return null
  const mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  if (mapped) {
    return [
      groups[6] >> 8,
      groups[6] & 255,
      groups[7] >> 8,
      groups[7] & 255,
    ].join(".")
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`
}

/**
 * The client IP from the trusted header's first hop, or null. The first hop
 * is the address the platform saw connect; any later entries are proxies.
 */
export function clientIpFromHeaders(
  headers: Pick<Headers, "get">,
  headerName: string | null = trustedClientIpHeader()
): string | null {
  if (!headerName) return null
  const value = headers.get(headerName)
  if (!value) return null
  return normaliseClientIp(value.split(",")[0] ?? "")
}

export function clientIpFromRequest(request: Request): string | null {
  return clientIpFromHeaders(request.headers)
}

// ---------------------------------------------------------------------------
// Keys and counting
// ---------------------------------------------------------------------------

function normaliseKeyValue(kind: AbuseKeyKind, value: string): string {
  const trimmed = value.trim()
  return kind === "email" ? trimmed.toLowerCase() : trimmed
}

/** The stored key: HMAC of kind and value, so the two never collide. */
export function abuseKeyHash(
  kind: AbuseKeyKind,
  value: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(`naba-abuse:${kind}:${normaliseKeyValue(kind, value)}`)
    .digest("hex")
}

export type AbuseDecision = { allowed: boolean; retryAfterSeconds: number }

/**
 * Counts one hit for every key the subject names and the scope limits, and
 * answers whether all of them fit. Kinds the scope does not limit, and keys
 * that are empty, are ignored. Off (ABUSE_LIMITS_ENABLED=false) counts nothing
 * and allows everything.
 */
export async function checkAbuseBudget(
  scope: AbuseScope,
  subject: AbuseSubject
): Promise<AbuseDecision> {
  const env = getServerEnv()
  if (!env.ABUSE_LIMITS_ENABLED) return { allowed: true, retryAfterSeconds: 0 }
  const policy: Partial<Record<AbuseKeyKind, Window>> = ABUSE_POLICIES[scope]
  let allowed = true
  let retryAfterSeconds = 0
  for (const kind of KEY_KINDS) {
    const window = policy[kind]
    const value = subject[kind]
    if (!window || !value || value.trim() === "") continue
    const [row] = await getDatabase()<
      { allowed: boolean; retryAfterSeconds: number }[]
    >`
      select allowed, retry_after_seconds as "retryAfterSeconds"
      from take_abuse_budget(
        ${`${scope}_${kind}`},
        ${abuseKeyHash(kind, value, env.NEXTAUTH_SECRET)},
        ${window.limit},
        ${window.windowSeconds}
      )
    `
    if (row && !row.allowed) {
      allowed = false
      retryAfterSeconds = Math.max(retryAfterSeconds, row.retryAfterSeconds)
    }
  }
  if (!allowed) {
    log.warn("abuse.limit_exceeded", { scope, retryAfterSeconds })
  }
  return { allowed, retryAfterSeconds }
}

/** The 429 a limited request answers with. */
export function abuseLimitedError(
  scope: AbuseScope,
  retryAfterSeconds: number
): ApiError {
  const code = ABUSE_POLICIES[scope].code
  return new ApiError(429, code, MESSAGES[code] ?? MESSAGES.auth_rate_limited, {
    retryable: true,
    details: { retryAfter: retryAfterSeconds },
  })
}

/** checkAbuseBudget, throwing the 429 when any key is over its limit. */
export async function takeAbuseBudget(
  scope: AbuseScope,
  subject: AbuseSubject
): Promise<void> {
  const decision = await checkAbuseBudget(scope, subject)
  if (!decision.allowed) {
    throw abuseLimitedError(scope, decision.retryAfterSeconds)
  }
}

/** Deletes ended windows in batches; called by the retention cron. */
export async function purgeAbuseRateBuckets(
  batchSize = 5_000,
  maxBatches = 20
): Promise<number> {
  let total = 0
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const [row] = await getDatabase()<{ count: number }[]>`
      select purge_abuse_rate_buckets(${batchSize}) as count
    `
    const count = row?.count ?? 0
    total += count
    if (count < batchSize) break
  }
  return total
}
