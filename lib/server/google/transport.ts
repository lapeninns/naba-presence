import "server-only"

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api"

import {
  classifyMutationFailure,
  isRetryableGoogleStatus,
  retryDelayMs,
} from "@/lib/domain/retry"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"

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
