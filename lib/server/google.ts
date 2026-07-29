import "server-only"

import { createHash } from "node:crypto"

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api"
import type { Sql, TransactionSql } from "postgres"

import {
  googleAccountsRequest,
  googleBatchReviewsRequest,
  googleNotificationSettingRequest,
  googleReplyRequest,
} from "@/lib/domain/google-contract"
import {
  classifyMutationFailure,
  isRetryableGoogleStatus,
  retryDelayMs,
} from "@/lib/domain/retry"
import { decryptSecret, encryptSecret } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

const OAUTH_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/business.manage",
].join(" ")

export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/callback/google"

let nextGoogleRequestAt = 0
const googleTracer = trace.getTracer("nabapresence.google")
const googleMeter = metrics.getMeter("nabapresence.google")
const googleRequestDuration = googleMeter.createHistogram(
  "nabapresence.google.request.duration",
  {
    description: "Google API request duration including retry pacing",
    unit: "ms",
  }
)
const googleRequestCount = googleMeter.createCounter(
  "nabapresence.google.request.count",
  {
    description: "Google API request outcomes",
  }
)

async function paceGoogleRequest() {
  const interval = 1000 / getServerEnv().GOOGLE_REQUESTS_PER_SECOND
  const now = Date.now()
  const wait = Math.max(0, nextGoogleRequestAt - now)
  nextGoogleRequestAt = Math.max(now, nextGoogleRequestAt) + interval
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
}

export class GoogleMutationAmbiguousError extends ApiError {
  constructor(message = "Google did not confirm whether the write succeeded.") {
    super(502, "google_mutation_ambiguous", message)
  }
}

function isAbortError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
}

function googleTimeoutError() {
  return new ApiError(
    502,
    "google_timeout",
    "The Google provider timed out."
  )
}

export type GoogleTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  refresh_token_expires_in?: number
  scope: string
  token_type: string
  id_token?: string
}

export type GoogleConnectionRow = {
  id: string
  organisation_id: string
  access_token_ciphertext: Buffer
  refresh_token_ciphertext: Buffer | null
  access_token_expires_at: Date | null
  status: string
}

async function recordConnectionFailure(
  sql: TransactionSql,
  connection: GoogleConnectionRow,
  errorCode: string
) {
  await sql`
    update google_connection
    set
      status = ${errorCode === "invalid_grant" ? "revoked" : "expired"},
      last_error_code = ${errorCode}
    where id = ${connection.id}
  `
  await sql`
    insert into connection_task (
      organisation_id,
      google_connection_id,
      task_type,
      status,
      reason_code
    )
    values (
      ${connection.organisation_id},
      ${connection.id},
      'reconnect',
      'open',
      ${errorCode}
    )
    on conflict (
      organisation_id,
      google_connection_id,
      task_type
    ) where status = 'open' do update
    set reason_code = excluded.reason_code
  `
  await sql`
    insert into audit_log (
      organisation_id,
      actor_user_id,
      action,
      subject_type,
      subject_id,
      metadata
    )
    values (
      ${connection.organisation_id},
      null,
      'google.connection.reconnect_required',
      'google_connection',
      ${connection.id},
      ${sql.json({ reasonCode: errorCode })}
    )
  `
}

async function persistConnectionFailure(
  connection: GoogleConnectionRow,
  errorCode: string
) {
  // Invariant: callers must not hold an open transaction. This helper owns
  // the short tenant-scoped transaction that persists reconnect state.
  await getDatabase().begin(async (sql) => {
    await sql`
      select set_config(
        'app.organisation_id',
        ${connection.organisation_id},
        true
      )
    `
    await recordConnectionFailure(sql, connection, errorCode)
  })
}

export function googleOAuthUrl(input: {
  state: string
  codeChallenge: string
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
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

function googleApiTarget(url: string): string {
  const proxyBase = process.env.GOOGLE_API_PROXY_BASE
  if (!proxyBase) return url
  const providerUrl = new URL(url)
  return new URL(
    `${providerUrl.pathname}${providerUrl.search}`,
    proxyBase
  ).toString()
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
}> {
  return googleRequest(
    "https://openidconnect.googleapis.com/v1/userinfo",
    accessToken
  )
}

async function refreshAccessToken(
  sql: TransactionSql,
  connection: GoogleConnectionRow
): Promise<string> {
  if (!connection.refresh_token_ciphertext) {
    await recordConnectionFailure(
      sql,
      connection,
      "refresh_token_missing"
    )
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  const env = getServerEnv()
  const response = await fetch(
    googleApiTarget("https://oauth2.googleapis.com/token"),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: decryptSecret(connection.refresh_token_ciphertext),
        grant_type: "refresh_token",
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
  }
  if (!response.ok) {
    await recordConnectionFailure(
      sql,
      connection,
      body.error ?? "refresh_failed"
    )
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  await sql`
    update google_connection
    set
      access_token_ciphertext = ${encryptSecret(body.access_token)},
      access_token_expires_at = now() + (${body.expires_in} * interval '1 second'),
      last_refresh_at = now(),
      status = 'active',
      last_error_code = null
    where id = ${connection.id}
  `
  return body.access_token
}

async function loadConnection(
  sql: TransactionSql,
  connectionId: string
): Promise<GoogleConnectionRow> {
  const [connection] = await sql<GoogleConnectionRow[]>`
    select *
    from google_connection
    where id = ${connectionId}
      and status = 'active'
    limit 1
  `
  if (!connection) {
    throw new ApiError(
      404,
      "connection_not_found",
      "Google connection not found."
    )
  }
  return connection
}

async function connectionAccessTokenInTransaction(
  sql: TransactionSql,
  connectionId: string
) {
  const connection = await loadConnection(sql, connectionId)
  if (
    !connection.access_token_expires_at ||
    connection.access_token_expires_at.getTime() <= Date.now() + 60_000
  ) {
    return refreshAccessToken(sql, connection)
  }
  return decryptSecret(connection.access_token_ciphertext)
}

async function refreshAccessTokenOutsideTransaction(
  sql: Sql,
  connection: GoogleConnectionRow
) {
  if (!connection.refresh_token_ciphertext) {
    await persistConnectionFailure(connection, "refresh_token_missing")
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  const env = getServerEnv()
  const response = await fetch(
    googleApiTarget("https://oauth2.googleapis.com/token"),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID ?? "",
        client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: decryptSecret(connection.refresh_token_ciphertext),
        grant_type: "refresh_token",
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
  }
  if (!response.ok) {
    await persistConnectionFailure(connection, body.error ?? "refresh_failed")
    throw new ApiError(
      401,
      "google_reconnect_required",
      "Google access has expired. Reconnect this account."
    )
  }
  await sql.begin(async (transaction) => {
    await transaction`
      select set_config(
        'app.organisation_id',
        ${connection.organisation_id},
        true
      )
    `
    await transaction`
      update google_connection
      set
        access_token_ciphertext = ${encryptSecret(body.access_token)},
        access_token_expires_at =
          now() + (${body.expires_in} * interval '1 second'),
        last_refresh_at = now(),
        status = 'active',
        last_error_code = null
      where id = ${connection.id}
    `
  })
  return body.access_token
}

export function connectionAccessToken(
  sql: TransactionSql,
  connectionId: string
): Promise<string>
export function connectionAccessToken(
  sql: Sql,
  organisationId: string,
  connectionId: string
): Promise<string>
export async function connectionAccessToken(
  sql: Sql | TransactionSql,
  organisationOrConnectionId: string,
  connectionId?: string
): Promise<string> {
  if (connectionId !== undefined) {
    const connection = await (sql as Sql).begin(async (transaction) => {
      await transaction`
        select set_config(
          'app.organisation_id',
          ${organisationOrConnectionId},
          true
        )
      `
      return loadConnection(transaction, connectionId)
    })
    if (
      !connection.access_token_expires_at ||
      connection.access_token_expires_at.getTime() <= Date.now() + 60_000
    ) {
      return refreshAccessTokenOutsideTransaction(sql as Sql, connection)
    }
    return decryptSecret(connection.access_token_ciphertext)
  }
  return connectionAccessTokenInTransaction(
    sql as TransactionSql,
    organisationOrConnectionId
  )
}

export async function googleRequest<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
  options: {
    mode?: "safe" | "mutation"
    maxAttempts?: number
    timeoutMs?: number
  } = {}
): Promise<T> {
  const mode = options.mode ?? "safe"
  const maxAttempts = mode === "mutation" ? 1 : (options.maxAttempts ?? 5)
  const timeoutMs =
    options.timeoutMs ??
    (mode === "mutation"
      ? getServerEnv().GOOGLE_MUTATION_TIMEOUT_MS
      : getServerEnv().GOOGLE_TIMEOUT_MS)
  const deadline = Date.now() + timeoutMs
  const providerHost = new URL(url).hostname
  const method = init.method ?? "GET"
  return googleTracer.startActiveSpan(
    "google.api.request",
    {
      attributes: {
        "server.address": providerHost,
        "http.request.method": method,
        "nabapresence.google.mode": mode,
      },
    },
    async (span) => {
      const startedAt = performance.now()
      let outcome = "error"
      let finalStatus = 0
      let attempts = 0
      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          attempts = attempt
          await paceGoogleRequest()
          const remainingMs = deadline - Date.now()
          if (remainingMs <= 0) {
            throw googleTimeoutError()
          }
          let response: Response
          try {
            response = await fetch(googleApiTarget(url), {
              ...init,
              headers: {
                accept: "application/json",
                authorization: `Bearer ${accessToken}`,
                ...(init.body ? { "content-type": "application/json" } : {}),
                ...init.headers,
              },
              cache: "no-store",
              signal: AbortSignal.timeout(remainingMs),
            })
          } catch (error) {
            if (mode === "mutation") {
              throw new GoogleMutationAmbiguousError(
                isAbortError(error)
                  ? "Google mutation timed out."
                  : error instanceof Error
                    ? error.message
                    : undefined
              )
            }
            if (isAbortError(error) && Date.now() >= deadline) {
              throw googleTimeoutError()
            }
            if (attempt === maxAttempts) throw error
            await new Promise((resolve) =>
              setTimeout(resolve, retryDelayMs(attempt))
            )
            continue
          }
          finalStatus = response.status
          const text = await response.text()
          const body = text ? JSON.parse(text) : null
          if (response.ok) {
            outcome = "success"
            return body as T
          }
          if (
            isRetryableGoogleStatus(response.status) &&
            attempt < maxAttempts
          ) {
            const retryAfter = Number(response.headers.get("retry-after"))
            const retryAfterMs =
              Number.isFinite(retryAfter) && retryAfter > 0
                ? Math.min(retryAfter * 1000, 30_000)
                : retryDelayMs(attempt)
            await new Promise((resolve) =>
              setTimeout(resolve, Math.min(retryAfterMs, timeoutMs))
            )
            continue
          }
          const reason =
            body?.error?.message ??
            body?.error_description ??
            "Google request failed."
          const code = body?.error?.status ?? body?.error ?? "google_api_error"
          if (mode === "mutation") {
            const classification = classifyMutationFailure({
              kind: "http",
              status: response.status,
            })
            if (classification === "ambiguous") {
              throw new GoogleMutationAmbiguousError(String(reason))
            }
            if (classification === "retryable") {
              throw new ApiError(429, "google_rate_limited", String(reason))
            }
          }
          throw new ApiError(response.status, String(code), String(reason))
        }
        throw new ApiError(
          502,
          "google_retry_exhausted",
          "Google retry limit reached."
        )
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        const attributes = {
          "server.address": providerHost,
          "http.request.method": method,
          "http.response.status_code": finalStatus,
          "nabapresence.google.mode": mode,
          outcome,
        }
        googleRequestDuration.record(performance.now() - startedAt, attributes)
        googleRequestCount.add(1, attributes)
        span.setAttributes({
          ...attributes,
          "nabapresence.google.attempts": attempts,
        })
        span.end()
      }
    }
  )
}

export function googleAccounts(accessToken: string, pageToken?: string) {
  const request = googleAccountsRequest(pageToken)
  return googleRequest<{
    accounts?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init)
}

export function googleLocations(
  accessToken: string,
  accountName: string,
  pageToken?: string
) {
  const params = new URLSearchParams({
    readMask:
      "name,title,storeCode,phoneNumbers,categories,storefrontAddress,metadata",
    pageSize: "100",
  })
  if (pageToken) params.set("pageToken", pageToken)
  return googleRequest<{
    locations?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params}`,
    accessToken
  )
}

export function googleReviews(
  accessToken: string,
  accountName: string,
  locationName: string,
  pageToken?: string
) {
  const params = new URLSearchParams({
    pageSize: "50",
    orderBy: "updateTime desc",
  })
  if (pageToken) params.set("pageToken", pageToken)
  const locationId = locationName.replace(/^locations\//, "")
  return googleRequest<{
    reviews?: Array<Record<string, unknown>>
    nextPageToken?: string
    averageRating?: number
    totalReviewCount?: number
  }>(
    `https://mybusiness.googleapis.com/v4/${accountName}/locations/${locationId}/reviews?${params}`,
    accessToken
  )
}

export function googleBatchReviews(
  accessToken: string,
  accountName: string,
  locationNames: string[],
  pageToken?: string
) {
  const request = googleBatchReviewsRequest(
    accountName,
    locationNames,
    pageToken
  )
  return googleRequest<{
    locationReviews?: Array<{
      name?: string
      review?: Record<string, unknown>
    }>
    nextPageToken?: string
  }>(request.url, accessToken, request.init)
}

export function updateGoogleReply(
  accessToken: string,
  reviewName: string,
  body: string,
  options: { timeoutMs?: number } = {}
) {
  const request = googleReplyRequest(reviewName, body)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { mode: "mutation", timeoutMs: options.timeoutMs }
  )
}

export function getGoogleReview(
  accessToken: string,
  reviewName: string,
  options: { timeoutMs?: number; maxAttempts?: number } = {}
) {
  return googleRequest<Record<string, unknown>>(
    `https://mybusiness.googleapis.com/v4/${reviewName}`,
    accessToken,
    {},
    {
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
    }
  )
}

export function deleteGoogleReply(
  accessToken: string,
  reviewName: string,
  options: { timeoutMs?: number } = {}
) {
  return googleRequest<Record<string, never>>(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    accessToken,
    { method: "DELETE" },
    { mode: "mutation", timeoutMs: options.timeoutMs }
  )
}

export function getGoogleNotificationSetting(
  accessToken: string,
  accountName: string
) {
  return googleRequest<{
    name: string
    pubsubTopic?: string
    notificationTypes?: string[]
  }>(
    `https://mybusinessnotifications.googleapis.com/v1/${accountName}/notificationSetting`,
    accessToken
  )
}

export function updateGoogleNotificationSetting(
  accessToken: string,
  accountName: string,
  pubsubTopic: string
) {
  const request = googleNotificationSettingRequest(accountName, pubsubTopic)
  return googleRequest<{
    name: string
    pubsubTopic?: string
    notificationTypes?: string[]
  }>(request.url, accessToken, request.init, { mode: "mutation" })
}
