import { AsyncLocalStorage } from "node:async_hooks"

import { metrics } from "@opentelemetry/api"
import { after } from "next/server"

import { telemetryDisabledReason } from "@/lib/server/telemetry-status"

/**
 * Per-request and per-tick metrics (audit W7-1, PERFORMANCE_OPTIMISATION.md
 * §1.2): route latency, tenant transactions and Google calls per request,
 * cron tick duration, jobs claimed by kind and scheduler tick age. Recorded by
 * `route()` (lib/server/route.ts), `withTenant` (db.ts), the Google transport,
 * the jobs tick and the health tick; documented in docs/observability.md.
 *
 * Cardinality is bounded on purpose: attributes are a route template (path
 * segments that look like identifiers become `:id`, and a process keeps at
 * most MAX_ROUTE_LABELS distinct ones), a method, a status class, a Google
 * API host, a job kind or a tick name. Never a tenant, user or request id.
 *
 * Instruments come from the global meter provider, which instrumentation.ts
 * registers before any route module loads.
 */

const meter = metrics.getMeter("nabapresence.http")

const routeDuration = meter.createHistogram(
  "nabapresence.http.server.duration",
  {
    description: "API route duration, from the wrapper's entry to its response",
    unit: "ms",
  }
)
const routeDbTransactions = meter.createHistogram(
  "nabapresence.http.server.db_transactions",
  {
    description: "Tenant-scoped transactions (withTenant) one API request ran",
    unit: "{transaction}",
    advice: { explicitBucketBoundaries: [0, 1, 2, 3, 5, 8, 13, 21, 50, 100] },
  }
)
const routeGoogleCalls = meter.createHistogram(
  "nabapresence.http.server.google_calls",
  {
    description:
      "Google API requests one API request or cron tick made, per Google API",
    unit: "{request}",
    advice: { explicitBucketBoundaries: [1, 2, 3, 5, 8, 13, 21, 50, 100, 500] },
  }
)
const cronTickDuration = meter.createHistogram(
  "nabapresence.cron.tick.duration",
  {
    description: "Cron-authenticated tick duration (Vercel Cron or scheduler)",
    unit: "ms",
  }
)
const jobsClaimed = meter.createCounter("nabapresence.jobs.claimed", {
  description: "Jobs the jobs tick claimed, by kind",
})
const schedulerTickAge = meter.createGauge("nabapresence.scheduler.tick.age", {
  description:
    "Seconds since each scheduled tick last completed, read by the health tick",
  unit: "s",
})

type RequestCounters = {
  dbTransactions: number
  googleCalls: Map<string, number>
}

const requestScope = new AsyncLocalStorage<RequestCounters>()

/** Distinct route labels one process records before folding into `other`. */
export const MAX_ROUTE_LABELS = 300

const ROUTE_LABELS_KEY = Symbol.for("nabapresence.request-metrics.routes")

function seenRoutes(): Set<string> {
  const holder = globalThis as unknown as Record<symbol, Set<string>>
  holder[ROUTE_LABELS_KEY] ??= new Set()
  return holder[ROUTE_LABELS_KEY]
}

const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.*\d)[\w-]{12,}|[\w-]{32,})$/i

/**
 * A bounded route label for `pathname`: identifier-like segments (numbers,
 * UUIDs, long or digit-bearing tokens such as Google resource names) become
 * `:id`, and past MAX_ROUTE_LABELS distinct labels everything new is `other`.
 */
export function routeLabel(pathname: string): string {
  const label =
    pathname
      .split("/")
      .map((segment) =>
        segment === "" ? segment : ID_SEGMENT.test(segment) ? ":id" : segment
      )
      .join("/")
      .slice(0, 120) || "/"
  const seen = seenRoutes()
  if (seen.has(label)) return label
  if (seen.size >= MAX_ROUTE_LABELS) return "other"
  seen.add(label)
  return label
}

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])

/** The method, or `OTHER` for anything non-standard. */
export const methodLabel = (method: string) => {
  const upper = method.toUpperCase()
  return METHODS.has(upper) ? upper : "OTHER"
}

/** `2xx`, `4xx`, ...; anything outside 100-599 is `5xx`. */
export function statusClass(status: number): string {
  return status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : "5xx"
}

/** Counts one tenant transaction against the current request, if any. */
export function countDbTransaction(): void {
  const counters = requestScope.getStore()
  if (counters) counters.dbTransactions += 1
}

/** Counts one Google API request against the current request, if any. */
export function countGoogleCall(api: string): void {
  const counters = requestScope.getStore()
  if (counters) {
    counters.googleCalls.set(api, (counters.googleCalls.get(api) ?? 0) + 1)
  }
}

/**
 * Runs one API request (or cron tick) and records its duration and
 * per-request counts once it settles. `cron` also records the tick duration.
 */
export async function withRequestMetrics(
  input: { method: string; pathname: string; cron: boolean },
  handle: () => Promise<Response>
): Promise<Response> {
  const counters: RequestCounters = {
    dbTransactions: 0,
    googleCalls: new Map(),
  }
  const startedAt = performance.now()
  let status = 500
  try {
    const response = await requestScope.run(counters, handle)
    status = response.status
    return response
  } finally {
    const durationMs = performance.now() - startedAt
    const route = routeLabel(input.pathname)
    const method = methodLabel(input.method)
    const attributes = {
      "http.route": route,
      "http.request.method": method,
      "http.response.status_class": statusClass(status),
    }
    routeDuration.record(durationMs, attributes)
    routeDbTransactions.record(counters.dbTransactions, {
      "http.route": route,
      "http.request.method": method,
    })
    for (const [api, count] of counters.googleCalls) {
      routeGoogleCalls.record(count, {
        "http.route": route,
        "server.address": api,
      })
    }
    if (input.cron) cronTickDuration.record(durationMs, attributes)
    flushMetricsAfterResponse()
  }
}

/** Records the kinds of one claimed batch (lib/server/jobs.ts). */
export function recordJobsClaimed(kinds: readonly string[]): void {
  const byKind = new Map<string, number>()
  for (const kind of kinds) byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  for (const [kind, count] of byKind) jobsClaimed.add(count, { kind })
}

/**
 * Records each tick's age, from the health tick's liveness read. A tick that
 * never completed is not recorded (its stale state already alerts).
 */
export function recordSchedulerTickAges(
  ticks: readonly { name: string; lastCompletedAt: string | null }[],
  now: Date = new Date()
): void {
  for (const tick of ticks) {
    if (!tick.lastCompletedAt) continue
    const age = (now.getTime() - Date.parse(tick.lastCompletedAt)) / 1000
    if (Number.isFinite(age)) schedulerTickAge.record(age, { tick: tick.name })
  }
}

type Flushable = { forceFlush?: () => Promise<void> }

const FLUSH_KEY = Symbol.for("nabapresence.request-metrics.flush")

type FlushState = { running: Promise<void> | null; again: boolean }

function flushState(): FlushState {
  const holder = globalThis as unknown as Record<symbol, FlushState>
  holder[FLUSH_KEY] ??= { running: null, again: false }
  return holder[FLUSH_KEY]
}

/**
 * Exports this instance's metrics once the response is sent, on Vercel only.
 * A Vercel function instance is frozen between invocations, so the periodic
 * reader's 60 s timer may never fire; without this an instance that serves a
 * few short requests and is reclaimed exports nothing. `after()` keeps the
 * invocation alive (waitUntil) until the export finishes. Concurrent requests
 * on one instance share the export in flight and queue at most one more,
 * so the collector sees at most one export per request and usually fewer.
 * Self-hosted (no `VERCEL`), the periodic reader is enough.
 *
 * Traces need no help: @vercel/otel already flushes its span processors
 * through the request context's waitUntil when a root span ends.
 */
export function flushMetricsAfterResponse(
  options: {
    env?: Record<string, string | undefined>
    schedule?: (task: () => Promise<void>) => void
    provider?: Flushable
  } = {}
): void {
  const env = options.env ?? process.env
  if (!env.VERCEL || telemetryDisabledReason(env) !== null) return
  const provider =
    options.provider ?? (metrics.getMeterProvider() as unknown as Flushable)
  if (typeof provider.forceFlush !== "function") return
  const schedule = options.schedule ?? scheduleAfterResponse
  schedule(() => coalescedFlush(provider))
}

function coalescedFlush(provider: Flushable): Promise<void> {
  const state = flushState()
  if (state.running) {
    state.again = true
    return state.running
  }
  const run = async (): Promise<void> => {
    try {
      do {
        state.again = false
        // Export failures are recorded by the exporter wrapper
        // (telemetry-status.ts); a flush must never fail the request.
        await provider.forceFlush?.().catch(() => {})
      } while (state.again)
    } finally {
      state.running = null
    }
  }
  state.running = run()
  return state.running
}

function scheduleAfterResponse(task: () => Promise<void>): void {
  try {
    after(task)
  } catch {
    // `after` throws outside a request scope (a handler called directly in a
    // test or a script); losing that one flush is fine.
  }
}
