import "server-only"

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api"

import {
  classifyMutationFailure,
  isRetryableGoogleStatus,
  retryDelayMs,
} from "@/lib/domain/retry"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  persistConnectionFailure,
  reconnectRequiredError,
  recordListingAccessLoss,
} from "./connection-failures"
import { accessTokenOwner, forgetAccessToken } from "./credentials"

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
  nextGoogleRequestAt = requestAt + interval * (0.9 + Math.random() * 0.2)
  if (connectionKey) {
    nextGoogleConnectionRequestAt.set(connectionKey, requestAt + 4 * interval)
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

export function isAbortError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
}

export function googleTimeoutError() {
  return new ApiError(502, "google_timeout", "The Google provider timed out.")
}

export function googleApiTarget(url: string): string {
  const proxyBase = process.env.GOOGLE_API_PROXY_BASE
  if (!proxyBase) return url
  const providerUrl = new URL(url)
  return new URL(
    `${providerUrl.pathname}${providerUrl.search}`,
    proxyBase
  ).toString()
}

function providerError(body: unknown): {
  readonly code?: unknown
  readonly description?: unknown
  readonly reason?: unknown
} {
  if (typeof body !== "object" || body === null) return {}
  const error = Reflect.get(body, "error")
  const description = Reflect.get(body, "error_description")
  if (typeof error !== "object" || error === null) {
    return { code: error, description }
  }
  return {
    code: Reflect.get(error, "status") ?? error,
    description,
    reason: Reflect.get(error, "message"),
  }
}

function hasScopeInsufficientReason(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false
  const error = Reflect.get(body, "error")
  if (typeof error !== "object" || error === null) return false
  const details = Reflect.get(error, "details")
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (
        typeof detail === "object" &&
        detail !== null &&
        Reflect.get(detail, "reason") === "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
      ) {
        return true
      }
    }
  }
  const message = Reflect.get(error, "message")
  return (
    typeof message === "string" &&
    /insufficient authentication scopes/i.test(message)
  )
}

/**
 * The failure code for an answer that says the credential itself is no good,
 * or null for everything else.
 *
 * 401 is Google refusing the token. 403 counts only when it is about the
 * token's scopes: Business Profile also answers 403 when the login has lost
 * manager access to one account or location, or when the API is disabled for
 * the Cloud project, and neither is fixed by reconnecting - flagging the
 * shared login for reconnect over one venue would send someone through
 * Google's consent screen for nothing.
 */
export function credentialFailureCode(
  status: number,
  body: unknown
): "google_unauthenticated" | "insufficient_scope" | null {
  if (status === 401) return "google_unauthenticated"
  if (status === 403 && hasScopeInsufficientReason(body)) {
    return "insufficient_scope"
  }
  return null
}

/** `ErrorInfo.reason` values on a 403 that describe the Cloud project, not the login. */
const OPERATOR_REASONS = new Set([
  "SERVICE_DISABLED",
  "API_DISABLED",
  "ACCESS_NOT_CONFIGURED",
  "CONSUMER_INVALID",
  "BILLING_DISABLED",
  "RATE_LIMIT_EXCEEDED",
  "RESOURCE_EXHAUSTED",
])

function errorInfoReasons(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return []
  const error = Reflect.get(body, "error")
  if (typeof error !== "object" || error === null) return []
  const details = Reflect.get(error, "details")
  if (!Array.isArray(details)) return []
  return details.flatMap((detail) => {
    const reason =
      typeof detail === "object" && detail !== null
        ? Reflect.get(detail, "reason")
        : undefined
    return typeof reason === "string" ? [reason] : []
  })
}

/**
 * A 403 that is the operator's to fix: the Business Profile API is not
 * enabled for the Cloud project, access has not been approved (quota 0), or
 * billing is off. Every tenant sees it at once, and neither a reconnect nor a
 * listing-level warning helps.
 */
export function operatorFailureCode(status: number, body: unknown): string | null {
  if (status !== 403) return null
  const reason = errorInfoReasons(body).find((entry) => OPERATOR_REASONS.has(entry))
  return reason ? `google_operator_${reason.toLowerCase()}` : null
}

/** `locations/{id}` from a Business Profile URL, or null for anything else. */
export function locationNameFromUrl(url: string): {
  locationName: string
  /** True when the URL addresses the location itself or its review list. */
  locationScoped: boolean
} | null {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }
  const match = /\/locations\/([^/:]+)(\/[^:]*)?/.exec(path)
  if (!match) return null
  const rest = match[2] ?? ""
  return {
    locationName: `locations/${match[1]}`,
    locationScoped: rest === "" || rest === "/reviews" || rest === "/",
  }
}

/**
 * The failure code for an answer that says this login can no longer reach
 * ONE location, or null. A 403 PERMISSION_DENIED anywhere under a location
 * (that is not about scopes or the Cloud project), or a 404 for the location
 * itself or its review list. A 404 for a single review, post or photo is an
 * ordinary missing resource and does not count.
 */
export function listingAccessFailureCode(
  status: number,
  body: unknown,
  url: string
): "listing_permission_denied" | "listing_not_found" | null {
  const location = locationNameFromUrl(url)
  if (!location) return null
  if (status === 403) {
    if (hasScopeInsufficientReason(body)) return null
    if (operatorFailureCode(status, body)) return null
    return "listing_permission_denied"
  }
  if (status === 404 && location.locationScoped) return "listing_not_found"
  return null
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
          if (remainingMs <= 0) throw googleTimeoutError()
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
          const body: unknown = text
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
          // Before the mutation classification: a rejected credential means
          // Google refused the call outright, so nothing was written and the
          // work must wait for a reconnect rather than fail.
          const credentialFailure = credentialFailureCode(
            response.status,
            body
          )
          const owner = credentialFailure
            ? accessTokenOwner(accessToken)
            : null
          if (credentialFailure && owner) {
            forgetAccessToken(accessToken)
            // Carries the generation the token was issued under: a 401 on a
            // token from before a reconnect is dropped, not recorded against
            // the credential that replaced it.
            await persistConnectionFailure(owner, credentialFailure)
            throw reconnectRequiredError()
          }
          const operatorFailure = operatorFailureCode(response.status, body)
          if (operatorFailure) {
            log.error("google.operator_configuration_error", {
              providerHost,
              status: response.status,
              code: operatorFailure,
            })
          }
          const listingFailure = listingAccessFailureCode(
            response.status,
            body,
            url
          )
          const listingOwner =
            listingFailure && !credentialFailure
              ? accessTokenOwner(accessToken)
              : null
          if (listingFailure && listingOwner) {
            const location = locationNameFromUrl(url)
            if (location) {
              // Best effort: marking the listing must never replace the
              // provider error the caller is about to see.
              await recordListingAccessLoss(
                listingOwner,
                location.locationName,
                listingFailure
              ).catch((error) =>
                log.warn("google.listing_access_record_failed", { error })
              )
            }
          }
          const error = providerError(body)
          const reason =
            error.reason ?? error.description ?? "Google request failed."
          const code = error.code ?? "google_api_error"
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
