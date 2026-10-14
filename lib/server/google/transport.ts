import "server-only"

import { AsyncLocalStorage } from "node:async_hooks"

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api"

import {
  GOOGLE_API_RETIRED_CODE,
  retiredGoogleApi,
  type RetiredGoogleApi,
} from "@/lib/domain/google-retired-apis"
import {
  classifyMutationFailure,
  isRetryableGoogleStatus,
  retryDelayMs,
} from "@/lib/domain/retry"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  googleTokenUnavailableError,
  handleUnauthenticated,
  persistConnectionFailure,
  reconnectRequiredError,
  recordListingAccessLoss,
} from "./connection-failures"
import { accessTokenOwner, forgetAccessToken } from "./credentials"
import { acquireGoogleBudget, recordGoogleThrottle } from "./rate-budget"

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
 * Smooths bursts inside one process. It is NOT the fleet limit: that is the
 * shared Postgres budget (rate-budget.ts), which every instance draws from
 * before this pacer runs.
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

/**
 * The deadline (epoch ms) of the Google write session a call runs in
 * (lib/server/google-write-session.ts), carried the way the audit actor is
 * (lib/server/audit.ts) so every Google helper inside the session honours it
 * without a parameter. Outside a session there is none and calls keep their
 * own timeouts.
 */
const writeDeadline = new AsyncLocalStorage<number>()

export function withGoogleWriteDeadline<T>(deadline: number, fn: () => T): T {
  return writeDeadline.run(deadline, fn)
}

/**
 * A mutation refused before it was sent because the write session could not
 * wait its full timeout for Google's answer: nothing reached Google, so it is
 * a plain failure (never ambiguous) and the person can simply try again.
 */
export class GoogleWriteBudgetExhaustedError extends ApiError {
  constructor() {
    super(
      503,
      "google_write_budget_exhausted",
      "There was not enough time left to send this change to Google safely. Nothing was sent.",
      { retryable: true }
    )
  }
}

/**
 * The stable answer for a call to an API Google has switched off. 410 because
 * the resource is gone for good: retrying, reconnecting or re-publishing will
 * never make it work, and no request is sent to find that out.
 */
export function googleApiRetiredError(api: RetiredGoogleApi) {
  return new ApiError(
    410,
    GOOGLE_API_RETIRED_CODE,
    "Google no longer offers this Business Profile feature.",
    { retryable: false, details: { api } }
  )
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
export function operatorFailureCode(
  status: number,
  body: unknown
): string | null {
  if (status !== 403) return null
  const reason = errorInfoReasons(body).find((entry) =>
    OPERATOR_REASONS.has(entry)
  )
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

/** The safe-mode body read: a read or parse failure is thrown as is. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  const contentType = response.headers.get("content-type") ?? ""
  return text ? (contentType.includes("json") ? JSON.parse(text) : text) : null
}

/** classifyMutationFailure({ kind: "decode" }) is always "ambiguous". */
function decodeAmbiguity(detail: string): GoogleMutationAmbiguousError {
  return new GoogleMutationAmbiguousError(
    `Google answered the write but ${detail}, so whether it applied is unknown.`
  )
}

/**
 * The mutation-mode body read. The request has been dispatched, so a 2xx
 * whose body cannot be read or decoded may still have written: that is
 * uncertain (GoogleMutationAmbiguousError), never a plain failure. A non-2xx
 * status is the provider's own answer, so an unreadable error body only
 * loses detail: the status still decides the classification.
 */
async function readMutationBody(
  response: Response,
  method: string,
  successBody: "json" | "ignored" = "json"
): Promise<unknown> {
  let text: string
  try {
    text = await response.text()
  } catch {
    if (!response.ok || successBody === "ignored") return null
    throw decodeAmbiguity("its response could not be read")
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (!response.ok) {
    if (!text) return null
    if (!contentType.includes("json")) return text
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }
  if (successBody === "ignored") return text || null
  if (!text) {
    if (method.toUpperCase() === "DELETE") return null
    throw decodeAmbiguity("its response was empty")
  }
  if (!contentType.includes("json")) {
    throw decodeAmbiguity("its response was not JSON")
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw decodeAmbiguity("its response was malformed")
  }
}

/**
 * Waits `ms` before a retry, or throws the timeout at once when the wait
 * would reach the call's deadline: the retry could not be sent in time, and
 * sleeping first would only hold a write lock longer for the same answer.
 */
async function sleepBefore(deadline: number, ms: number) {
  if (Date.now() + ms >= deadline) throw googleTimeoutError()
  await new Promise((resolve) => setTimeout(resolve, ms))
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
    /**
     * Mutation mode only. "json" (the default) requires a 2xx to carry a
     * parseable JSON body, except an empty DELETE answer. "ignored" is for a
     * call whose success body the caller never reads (the media byte upload):
     * the status alone confirms it.
     */
    successBody?: "json" | "ignored"
  } = {}
): Promise<T> {
  // Before the budget, the pacer and the span: a retired endpoint must never
  // reach the network, cost quota, or count as a provider failure.
  const retired = retiredGoogleApi(url)
  if (retired) {
    log.warn("google.retired_api_blocked", { api: retired })
    throw googleApiRetiredError(retired)
  }
  const mode = options.mode ?? "safe"
  const maxAttempts = mode === "mutation" ? 1 : (options.maxAttempts ?? 5)
  const timeoutMs =
    options.timeoutMs ??
    (mode === "mutation"
      ? getServerEnv().GOOGLE_MUTATION_TIMEOUT_MS
      : getServerEnv().GOOGLE_TIMEOUT_MS)
  // Inside a write session the call also ends by the session's deadline, so
  // its retries and their sleeps cannot carry it past the lock's budget. A
  // mutation is never started without its full timeout: cut short, its
  // answer would be lost and the write left ambiguous.
  const sessionDeadline = writeDeadline.getStore()
  if (
    mode === "mutation" &&
    sessionDeadline !== undefined &&
    sessionDeadline - Date.now() < timeoutMs
  ) {
    throw new GoogleWriteBudgetExhaustedError()
  }
  const deadline = Math.min(
    Date.now() + timeoutMs,
    sessionDeadline ?? Number.POSITIVE_INFINITY
  )
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
          // Fleet-wide first, so a request that must be deferred never holds
          // a local pacing slot; throws the retryable google_rate_limited
          // when the shared budget will not open before this call's deadline.
          await acquireGoogleBudget(url, mode, deadline)
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
            await sleepBefore(deadline, retryDelayMs(attempt))
            continue
          }
          finalStatus = response.status
          const body: unknown =
            mode === "mutation"
              ? await readMutationBody(response, method, options.successBody)
              : await readBody(response)
          if (response.ok) {
            outcome = "success"
            return body as T
          }
          if (response.status === 429) {
            // Quota is per Cloud project, so every instance must back off,
            // not just this one.
            const retryAfter = Number(response.headers.get("retry-after"))
            await recordGoogleThrottle(
              url,
              mode,
              Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : null
            )
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
            // A wait that would reach the deadline makes this the last
            // attempt: Google's own answer is the error, at once.
            if (Date.now() + retryAfterMs < deadline) {
              await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
              continue
            }
          }
          // Before the mutation classification: a rejected credential means
          // Google refused the call outright, so nothing was written and the
          // work must wait for a reconnect rather than fail.
          const credentialFailure = credentialFailureCode(response.status, body)
          const owner = credentialFailure ? accessTokenOwner(accessToken) : null
          if (credentialFailure && owner) {
            forgetAccessToken(accessToken)
            // Carries the generation the token was issued under: a 401 on a
            // token from before a reconnect is dropped, not recorded against
            // the credential that replaced it.
            if (credentialFailure === "google_unauthenticated") {
              // Expire the access token and let the next call's refresh
              // decide; only a 401 right after a refresh asks for a person.
              const outcome = await handleUnauthenticated(owner)
              if (outcome === "refresh") throw googleTokenUnavailableError()
              throw reconnectRequiredError()
            }
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
