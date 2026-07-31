import "server-only"

import { createHash } from "node:crypto"

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api"
import type { Sql, TransactionSql } from "postgres"

import {
  GOOGLE_PLACE_ACTION_TYPES,
  googleAttributeMetadataRequest,
  googleAccountsRequest,
  googleAccountManagementRequest,
  googleBusinessCallsRequest,
  googleBatchReviewsRequest,
  googleLocationHoursPatchRequest,
  googleLocationAttributesPatchRequest,
  googleLocationAttributesRequest,
  googleLocationPatchRequest,
  googleLocationCreateRequest,
  googleLocationDeleteRequest,
  googleLocationUpdatedRequest,
  googleLocationsSearchRequest,
  googleLodgingRequest,
  googleLocationProfilePatchRequest,
  googleLocationRequest,
  googleMediaBinaryUploadRequest,
  googleMediaCreateRequest,
  googleMediaDeleteRequest,
  googleMediaGetRequest,
  googleMediaListRequest,
  googleMediaPatchRequest,
  googleMediaStartUploadRequest,
  googleLocalPostCreateRequest,
  googleLocalPostDeleteRequest,
  googleLocalPostGetRequest,
  googleLocalPostPatchRequest,
  googleLocalPostsListRequest,
  googleFoodMenusGetRequest,
  googleFoodMenusPatchRequest,
  googleNotificationSettingRequest,
  googlePerformanceRequest,
  googlePlaceActionLinkCreateRequest,
  googlePlaceActionLinkDeleteRequest,
  googlePlaceActionLinkGetRequest,
  googlePlaceActionLinkPatchRequest,
  googlePlaceActionLinksListRequest,
  googleReplyRequest,
  googleVerificationRequest,
  googleHealthcareRequest,
  googleCategoriesRequest,
  googleChainsSearchRequest,
  googleSearchKeywordImpressionsRequest,
  type GooglePerformanceMetric,
  type GooglePlaceActionType,
  type GoogleHoursUpdateMask,
  type GoogleLocationReadField,
  type GoogleMediaCategory,
  type GoogleNotificationType,
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
const nextGoogleConnectionRequestAt = new Map<string, number>()
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

/**
 * Scheduled Google work is single-flight via withAdvisoryLock, so this
 * process-local limiter is fleet pacing for sync. Interactive publishes are
 * per-process and individually rare.
 */
async function paceGoogleRequest(connectionKey?: string) {
  const interval = 1000 / getServerEnv().GOOGLE_REQUESTS_PER_SECOND
  const now = Date.now()
  const connectionNextAt = connectionKey
    ? (nextGoogleConnectionRequestAt.get(connectionKey) ?? 0)
    : 0
  const requestAt = Math.max(now, nextGoogleRequestAt, connectionNextAt)
  const wait = requestAt - now
  nextGoogleRequestAt =
    requestAt + interval * (0.9 + Math.random() * 0.2)
  if (connectionKey) {
    nextGoogleConnectionRequestAt.set(
      connectionKey,
      requestAt + 4 * interval
    )
  }
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
  email_verified?: boolean
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
    connectionKey?: string
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
          await paceGoogleRequest(options.connectionKey)
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
          const contentType = response.headers.get("content-type") ?? ""
          const body = text
            ? contentType.includes("json")
              ? JSON.parse(text)
              : text
            : null
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

export function googleAccounts(
  accessToken: string,
  pageToken?: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleAccountsRequest(pageToken)
  return googleRequest<{
    accounts?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function googleLocations(
  accessToken: string,
  accountName: string,
  pageToken?: string,
  options: { connectionKey?: string } = {}
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
    accessToken,
    {},
    options
  )
}

export function getGoogleLocation(
  accessToken: string,
  locationName: string,
  readMask: GoogleLocationReadField[],
  options: { connectionKey?: string; maxAttempts?: number } = {}
) {
  const request = googleLocationRequest(locationName, readMask)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleLocationHours(
  accessToken: string,
  input: {
    locationName: string
    updateMask: GoogleHoursUpdateMask[]
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  const request = googleLocationHoursPatchRequest(input)
  return googleRequest<Record<string, unknown> | null>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      // Google guarantees validateOnly does not apply the patch, so retries
      // are safe. The real write stays single-attempt and ambiguity-aware.
      mode: input.validateOnly ? "safe" : "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}

export function patchGoogleLocation(
  accessToken: string,
  input: {
    locationName: string
    updateMask: string[]
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function getGoogleLocationAttributes(
  accessToken: string,
  locationName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationAttributesRequest(locationName)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleLocationAttributes(
  accessToken: string,
  input: {
    locationName: string
    attributeMask: string[]
    attributes: Array<Record<string, unknown>>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationAttributesPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function listGoogleAttributeMetadata(
  accessToken: string,
  input: { locationName: string; languageCode?: string; pageToken?: string },
  options: { connectionKey?: string } = {}
) {
  const request = googleAttributeMetadataRequest(input)
  return googleRequest<{
    attributeMetadata?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function listGoogleCategories(
  accessToken: string,
  input: {
    regionCode: string
    languageCode: string
    query?: string
    pageToken?: string
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleCategoriesRequest(input)
  return googleRequest<{
    categories?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function searchGoogleChains(
  accessToken: string,
  query: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleChainsSearchRequest(query)
  return googleRequest<{ chains?: Array<Record<string, unknown>> }>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function createGoogleLocation(
  accessToken: string,
  input: {
    accountName: string
    requestId: string
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function deleteGoogleLocation(
  accessToken: string,
  locationName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationDeleteRequest(locationName)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}

export function getGoogleUpdatedLocation(
  accessToken: string,
  locationName: string,
  readMask: string[],
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationUpdatedRequest(locationName, readMask)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function searchGoogleLocations(
  accessToken: string,
  payload: Record<string, unknown>,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocationsSearchRequest(payload)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function googleVerificationApi(
  accessToken: string,
  input: {
    path: string
    method?: "GET" | "POST"
    payload?: Record<string, unknown>
  },
  options: { connectionKey?: string; mutation?: boolean } = {}
) {
  const request = googleVerificationRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: options.mutation ? "mutation" : "safe",
    }
  )
}

export function googleAccountManagementApi(
  accessToken: string,
  input: {
    path: string
    method?: "GET" | "POST" | "PATCH" | "DELETE"
    payload?: Record<string, unknown>
    updateMask?: string[]
  },
  options: { connectionKey?: string; mutation?: boolean } = {}
) {
  const request = googleAccountManagementRequest(input)
  return googleRequest<Record<string, unknown> | null>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: options.mutation ? "mutation" : "safe",
    }
  )
}

export function googleLodgingApi(
  accessToken: string,
  input: {
    locationName: string
    operation: "get" | "getGoogleUpdated" | "patch"
    updateMask?: string[]
    payload?: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLodgingRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      ...options,
      mode: input.operation === "patch" ? "mutation" : "safe",
    }
  )
}

export function googleBusinessCallsApi(
  accessToken: string,
  input: {
    locationName: string
    operation: "settings" | "patch" | "insights"
    updateMask?: string[]
    payload?: Record<string, unknown>
    filter?: string
    pageToken?: string
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleBusinessCallsRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      ...options,
      mode: input.operation === "patch" ? "mutation" : "safe",
    }
  )
}

export function googleHealthcareApi(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    resource: "serviceList" | "healthProviderAttributes" | "insuranceNetworks"
    method?: "GET" | "PATCH"
    updateMask?: string[]
    payload?: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleHealthcareRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      ...options,
      mode: input.method === "PATCH" ? "mutation" : "safe",
    }
  )
}

export function patchGoogleLocationProfile(
  accessToken: string,
  input: {
    locationName: string
    updateMask: Array<"title" | "profile" | "phoneNumbers" | "websiteUri">
    validateOnly: boolean
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  const request = googleLocationProfilePatchRequest(input)
  return googleRequest<Record<string, unknown> | null>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: input.validateOnly ? "safe" : "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}

export type GooglePerformancePoint = {
  metric: GooglePerformanceMetric
  date: string
  value: number
}

export async function googlePerformanceMetrics(
  accessToken: string,
  input: {
    locationName: string
    metrics: readonly GooglePerformanceMetric[]
    startDate: string
    endDate: string
  },
  options: { connectionKey?: string } = {}
): Promise<GooglePerformancePoint[]> {
  const request = googlePerformanceRequest(input)
  const response = await googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
  return normalizeGooglePerformanceResponse(response, input.metrics)
}

export function normalizeGooglePerformanceResponse(
  response: Record<string, unknown>,
  expectedMetrics: readonly GooglePerformanceMetric[]
): GooglePerformancePoint[] {
  const known = new Set<GooglePerformanceMetric>(expectedMetrics)
  const series = Array.isArray(response.multiDailyMetricTimeSeries)
    ? response.multiDailyMetricTimeSeries
    : []
  const points: GooglePerformancePoint[] = []
  for (const entry of series) {
    if (!entry || typeof entry !== "object") continue
    const wrapped = entry as Record<string, unknown>
    const raw =
      wrapped.dailyMetricTimeSeries &&
      typeof wrapped.dailyMetricTimeSeries === "object"
        ? (wrapped.dailyMetricTimeSeries as Record<string, unknown>)
        : wrapped
    const metric = raw.dailyMetric
    if (typeof metric !== "string" || !known.has(metric as GooglePerformanceMetric)) {
      continue
    }
    const timeSeries =
      raw.timeSeries && typeof raw.timeSeries === "object"
        ? (raw.timeSeries as Record<string, unknown>)
        : null
    const values = Array.isArray(timeSeries?.datedValues)
      ? timeSeries.datedValues
      : []
    for (const value of values) {
      if (!value || typeof value !== "object") continue
      const record = value as Record<string, unknown>
      const date =
        record.date && typeof record.date === "object"
          ? (record.date as Record<string, unknown>)
          : null
      const year = Number(date?.year)
      const month = Number(date?.month)
      const day = Number(date?.day)
      const count = Number(record.value)
      if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        continue
      }
      points.push({
        metric: metric as GooglePerformanceMetric,
        date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        value: count,
      })
    }
  }
  return points
}

export type GoogleSearchKeywordPoint = {
  keyword: string
  impressions: number | null
  threshold: number | null
}

export function normalizeGoogleSearchKeywordResponse(
  response: Record<string, unknown>
): GoogleSearchKeywordPoint[] {
  const counts = Array.isArray(response.searchKeywordsCounts)
    ? response.searchKeywordsCounts
    : []
  const points: GoogleSearchKeywordPoint[] = []
  for (const entry of counts) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const keyword =
      typeof record.searchKeyword === "string"
        ? record.searchKeyword.trim().toLocaleLowerCase("en-GB")
        : ""
    const insight =
      record.insightsValue && typeof record.insightsValue === "object"
        ? (record.insightsValue as Record<string, unknown>)
        : null
    const value = insight?.value === undefined ? null : Number(insight.value)
    const threshold =
      insight?.threshold === undefined ? null : Number(insight.threshold)
    const validValue =
      value !== null && Number.isSafeInteger(value) && value >= 0
    const validThreshold =
      threshold !== null && Number.isSafeInteger(threshold) && threshold >= 0
    if (!keyword || validValue === validThreshold) continue
    points.push({
      keyword,
      impressions: validValue ? value : null,
      threshold: validThreshold ? threshold : null,
    })
  }
  return points
}

export async function googleSearchKeywordImpressions(
  accessToken: string,
  input: { locationName: string; month: string },
  options: { connectionKey?: string; maxPages?: number } = {}
): Promise<GoogleSearchKeywordPoint[]> {
  const points: GoogleSearchKeywordPoint[] = []
  let pageToken: string | undefined
  const maxPages = Math.min(100, Math.max(1, options.maxPages ?? 100))
  for (let page = 0; page < maxPages; page += 1) {
    const request = googleSearchKeywordImpressionsRequest({
      ...input,
      pageToken,
    })
    const response = await googleRequest<Record<string, unknown>>(
      request.url,
      accessToken,
      request.init,
      { connectionKey: options.connectionKey }
    )
    points.push(...normalizeGoogleSearchKeywordResponse(response))
    pageToken =
      typeof response.nextPageToken === "string" && response.nextPageToken
        ? response.nextPageToken
        : undefined
    if (!pageToken) return points
  }
  throw new ApiError(
    502,
    "google_keyword_page_limit",
    "Google search-keyword pagination exceeded the safety limit."
  )
}

export type GooglePlaceActionLink = {
  name: string
  providerType: string
  isEditable: boolean
  uri: string
  placeActionType: GooglePlaceActionType
  isPreferred: boolean
  createTime: string | null
  updateTime: string | null
}

function normalizeGooglePlaceActionLink(
  value: unknown
): GooglePlaceActionLink | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (
    typeof record.name !== "string" ||
    typeof record.uri !== "string" ||
    !record.uri ||
    typeof record.placeActionType !== "string" ||
    !(GOOGLE_PLACE_ACTION_TYPES as readonly string[]).includes(
      record.placeActionType
    )
  ) {
    return null
  }
  return {
    name: record.name,
    providerType:
      typeof record.providerType === "string"
        ? record.providerType
        : "PROVIDER_TYPE_UNSPECIFIED",
    isEditable: record.isEditable === true,
    uri: record.uri,
    placeActionType: record.placeActionType as GooglePlaceActionType,
    isPreferred: record.isPreferred === true,
    createTime: typeof record.createTime === "string" ? record.createTime : null,
    updateTime: typeof record.updateTime === "string" ? record.updateTime : null,
  }
}

export async function listGooglePlaceActionLinks(
  accessToken: string,
  locationName: string,
  options: { connectionKey?: string } = {}
): Promise<GooglePlaceActionLink[]> {
  const links: GooglePlaceActionLink[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const request = googlePlaceActionLinksListRequest({
      locationName,
      pageToken,
    })
    const response = await googleRequest<Record<string, unknown>>(
      request.url,
      accessToken,
      request.init,
      options
    )
    const raw = Array.isArray(response.placeActionLinks)
      ? response.placeActionLinks
      : []
    for (const item of raw) {
      const link = normalizeGooglePlaceActionLink(item)
      if (link) links.push(link)
    }
    pageToken =
      typeof response.nextPageToken === "string" && response.nextPageToken
        ? response.nextPageToken
        : undefined
    if (!pageToken) return links
  }
  throw new ApiError(
    502,
    "google_place_action_page_limit",
    "Google Place Action pagination exceeded the safety limit."
  )
}

export async function createGooglePlaceActionLink(
  accessToken: string,
  input: {
    locationName: string
    payload: {
      uri: string
      placeActionType: GooglePlaceActionType
      isPreferred: boolean
    }
  },
  options: { connectionKey?: string } = {}
) {
  const request = googlePlaceActionLinkCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export async function getGooglePlaceActionLink(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googlePlaceActionLinkGetRequest(name)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export async function patchGooglePlaceActionLink(
  accessToken: string,
  input: {
    name: string
    payload: {
      uri: string
      placeActionType: GooglePlaceActionType
      isPreferred: boolean
    }
  },
  options: { connectionKey?: string } = {}
) {
  const request = googlePlaceActionLinkPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export async function deleteGooglePlaceActionLink(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googlePlaceActionLinkDeleteRequest(name)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}

export function googleReviews(
  accessToken: string,
  accountName: string,
  locationName: string,
  pageToken?: string,
  options: { connectionKey?: string } = {}
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
    accessToken,
    {},
    options
  )
}

export function googleLocalPosts(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    pageToken?: string
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostsListRequest(input)
  return googleRequest<{
    localPosts?: Array<Record<string, unknown>>
    nextPageToken?: string
  }>(request.url, accessToken, request.init, options)
}

export function getGoogleFoodMenus(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleFoodMenusGetRequest(name)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleFoodMenus(
  accessToken: string,
  input: { name: string; menus: Array<Record<string, unknown>> },
  options: { connectionKey?: string } = {}
) {
  const request = googleFoodMenusPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export async function googleMediaItems(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    customer: boolean
  },
  options: { connectionKey?: string } = {}
) {
  const items: Array<Record<string, unknown>> = []
  let pageToken: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const request = googleMediaListRequest({ ...input, pageToken })
    const response = await googleRequest<{
      mediaItems?: Array<Record<string, unknown>>
      nextPageToken?: string
    }>(request.url, accessToken, request.init, options)
    items.push(...(response.mediaItems ?? []))
    pageToken = response.nextPageToken || undefined
    if (!pageToken) return items
  }
  throw new ApiError(
    502,
    "google_media_page_limit",
    "Google media pagination exceeded the safety limit."
  )
}

export function createGoogleMediaItem(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    payload: {
      mediaFormat: "PHOTO" | "VIDEO"
      locationAssociation: { category: GoogleMediaCategory }
      sourceUrl?: string
      dataRef?: { resourceName: string }
      description?: string
    }
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export async function uploadGoogleMediaBytes(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    bytes: ArrayBuffer
    contentType: string
  },
  options: { connectionKey?: string } = {}
) {
  const start = googleMediaStartUploadRequest(input)
  const dataRef = await googleRequest<{ resourceName?: string }>(
    start.url,
    accessToken,
    start.init,
    { ...options, mode: "mutation" }
  )
  if (!dataRef.resourceName) {
    throw new ApiError(
      502,
      "media_data_ref_missing",
      "Google did not return a media upload reference."
    )
  }
  const upload = googleMediaBinaryUploadRequest({
    resourceName: dataRef.resourceName,
    bytes: input.bytes,
    contentType: input.contentType,
  })
  await googleRequest<unknown>(upload.url, accessToken, upload.init, {
    ...options,
    mode: "mutation",
  })
  return { resourceName: dataRef.resourceName }
}

export function getGoogleMediaItem(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaGetRequest(name)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleMediaItem(
  accessToken: string,
  input: { name: string; category: GoogleMediaCategory },
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function deleteGoogleMediaItem(
  accessToken: string,
  name: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleMediaDeleteRequest(name)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}

export function createGoogleLocalPost(
  accessToken: string,
  input: {
    accountName: string
    locationName: string
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostCreateRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function getGoogleLocalPost(
  accessToken: string,
  postName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostGetRequest(postName)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
}

export function patchGoogleLocalPost(
  accessToken: string,
  input: {
    postName: string
    updateMask: string[]
    payload: Record<string, unknown>
  },
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostPatchRequest(input)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    { ...options, mode: "mutation" }
  )
}

export function deleteGoogleLocalPost(
  accessToken: string,
  postName: string,
  options: { connectionKey?: string } = {}
) {
  const request = googleLocalPostDeleteRequest(postName)
  return googleRequest<null>(request.url, accessToken, request.init, {
    ...options,
    mode: "mutation",
  })
}

export function googleBatchReviews(
  accessToken: string,
  accountName: string,
  locationNames: string[],
  pageToken?: string,
  options: { connectionKey?: string } = {}
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
  }>(request.url, accessToken, request.init, options)
}

export function updateGoogleReply(
  accessToken: string,
  reviewName: string,
  body: string,
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  const request = googleReplyRequest(reviewName, body)
  return googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    {
      connectionKey: options.connectionKey,
      mode: "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}

export function getGoogleReview(
  accessToken: string,
  reviewName: string,
  options: {
    connectionKey?: string
    timeoutMs?: number
    maxAttempts?: number
  } = {}
) {
  return googleRequest<Record<string, unknown>>(
    `https://mybusiness.googleapis.com/v4/${reviewName}`,
    accessToken,
    {},
    {
      connectionKey: options.connectionKey,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts,
    }
  )
}

export function deleteGoogleReply(
  accessToken: string,
  reviewName: string,
  options: { connectionKey?: string; timeoutMs?: number } = {}
) {
  return googleRequest<Record<string, never>>(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    accessToken,
    { method: "DELETE" },
    {
      connectionKey: options.connectionKey,
      mode: "mutation",
      timeoutMs: options.timeoutMs,
    }
  )
}

export function getGoogleNotificationSetting(
  accessToken: string,
  accountName: string,
  options: { connectionKey?: string } = {}
) {
  return googleRequest<{
    name: string
    pubsubTopic?: string
    notificationTypes?: string[]
  }>(
    `https://mybusinessnotifications.googleapis.com/v1/${accountName}/notificationSetting`,
    accessToken,
    {},
    options
  )
}

export function updateGoogleNotificationSetting(
  accessToken: string,
  accountName: string,
  pubsubTopic: string,
  notificationTypes: readonly GoogleNotificationType[],
  options: { connectionKey?: string } = {}
) {
  const request = googleNotificationSettingRequest(
    accountName,
    pubsubTopic,
    notificationTypes
  )
  return googleRequest<{
    name: string
    pubsubTopic?: string
    notificationTypes?: string[]
  }>(request.url, accessToken, request.init, {
    connectionKey: options.connectionKey,
    mode: "mutation",
  })
}
