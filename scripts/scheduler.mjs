import { SCHEDULER_TICK_PATHS } from "./scheduler-ticks.mjs"

const baseUrl = new URL(
  process.env.SCHEDULER_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    "http://127.0.0.1:3000"
)
const cronSecret = process.env.CRON_SECRET

if (!cronSecret || cronSecret.length < 16) {
  throw new Error("CRON_SECRET with at least 16 characters is required.")
}

function interval(name, fallbackSeconds, minimumSeconds) {
  const value = Number(process.env[name] ?? fallbackSeconds)
  return Math.max(
    minimumSeconds,
    Number.isFinite(value) ? value : fallbackSeconds
  )
}

// Same semantics as featureFlag() in lib/server/env.ts: unset means the
// documented default, not "off". A scheduler that read unset as "off" while
// the web process read it as "on" left a surface enabled in the UI with
// nothing ever ingesting for it.
function featureFlag(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === "") return fallback
  return value === "true"
}

const reconcileIntervalMs =
  interval("RECONCILE_INTERVAL_SECONDS", 900, 60) * 1000
const retentionIntervalMs =
  interval("RETENTION_INTERVAL_SECONDS", 300, 60) * 1000
const jobsIntervalMs = interval("JOBS_INTERVAL_SECONDS", 60, 10) * 1000
const performanceIntervalMs =
  interval("PERFORMANCE_INTERVAL_SECONDS", 21600, 3600) * 1000
const keywordIntervalMs =
  interval("KEYWORD_INTERVAL_SECONDS", 86400, 3600) * 1000
const presenceResourceIntervalMs =
  interval("PRESENCE_RESOURCE_RECONCILE_INTERVAL_SECONDS", 900, 300) * 1000
const sweepIntervalMs = interval("SWEEP_INTERVAL_SECONDS", 86400, 3600) * 1000
// Matches vercel.json's hourly /api/billing/reconcile.
const billingReconcileIntervalMs =
  interval("BILLING_RECONCILE_INTERVAL_SECONDS", 3600, 600) * 1000
// Matches vercel.json's */15 schedule for /api/cron/health.
const healthIntervalMs = interval("HEALTH_INTERVAL_SECONDS", 900, 300) * 1000
// The two flags the scheduler reads. The GBP surfaces return a benign no-op
// when their kill switch is off, so gating them here only duplicated the web
// process's decision. Retention and the health tick answer a paused switch
// with a 503, which would otherwise be logged as a failed tick for as long as
// the pause lasts.
const retentionEnabled = featureFlag("RETENTION_ENABLED", true)
const notificationsEnabled = featureFlag("NOTIFICATIONS_ENABLED", true)

function log(level, event, context = {}) {
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: "nabapresence-scheduler",
    ...context,
  })
  if (level === "error") console.error(record)
  else console.info(record)
}

/**
 * One cron tick: a GET with the cron bearer, as Vercel Cron fires it
 * (scripts/scheduler-ticks.mjs).
 */
async function tick(name) {
  const path = SCHEDULER_TICK_PATHS[name]
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "x-request-id": crypto.randomUUID(),
    },
    signal: AbortSignal.timeout(55_000),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status}: ${result?.error ?? "request_failed"}`
    )
  }
  return result
}

/** tick name -> consecutive advisory-lock skips. */
const skips = new Map()

function noteSkip(name, context = {}) {
  const consecutive = (skips.get(name) ?? 0) + 1
  skips.set(name, consecutive)
  // Warn, not info, and never alongside a `.completed` line: a lock miss did
  // no work, and logging it as a finished run made a wedged lease look
  // exactly like an idle fleet.
  log("warn", `${name}.skipped`, {
    reason: "lease_held",
    consecutive,
    ...context,
  })
}

function noteRun(name) {
  skips.delete(name)
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

function completion(name, startedAt, context) {
  noteRun(name)
  log("info", `${name}.completed`, {
    ...context,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

/**
 * The recurring per-location syncs (reconcile, performance, keywords) and
 * the review sweep. A fire only queues: one statement arms a checkpoint for
 * every linked location in every organisation (lib/server/recurring-sync.ts,
 * `enqueueFleetSweep`), and the jobs tick drains them every minute with its
 * per-organisation fairness, leases and time budget. Nothing pages, so
 * nothing is left behind on a cursor.
 */
async function runEnqueue(name) {
  const startedAt = performance.now()
  const result = await tick(name)
  if (result?.skipped === true) return noteSkip(name)
  completion(name, startedAt, {
    organisations: result?.processed ?? 0,
    queued: result?.queued ?? 0,
  })
}

const runReconciliation = () => runEnqueue("reconciliation")
const runPerformance = () => runEnqueue("performance")
const runKeywords = () => runEnqueue("keywords")
/**
 * Tombstones reviews the provider has deleted. Nothing drove this before, so
 * `provider_deleted_at` was never set outside a hand-made request and a
 * deleted review stayed in the inbox for ever.
 */
const runSweep = () => runEnqueue("sweep")

/**
 * One retention dispatcher fire (lib/server/retention/cycle.ts). The cycle
 * and its cursor live in the database, so a fire is one request: it resumes
 * the running cycle or opens the day's at or after 03:00 UTC, and the next
 * fire carries on where its time budget stopped it.
 */
async function runRetention() {
  const startedAt = performance.now()
  const result = await tick("retention")
  if (result?.skipped === true) return noteSkip("retention")
  const failures = result?.failures?.length ?? 0
  // The route isolates a failing tenant and records it on the cycle rather
  // than aborting the fire, so log it here too.
  if (failures) log("warn", "retention.partial", { failures })
  completion("retention", startedAt, {
    cycleDate: result?.cycle?.cycleDate ?? null,
    cycleStatus: result?.cycle?.status ?? null,
    cycleCompleted: result?.completed === true,
    organisations: result?.organisations?.length ?? 0,
    failures,
  })
}

/**
 * The health tick: evaluates every organisation into incidents, sends what
 * is due and checks the platform, under the `naba:health` lease that also
 * stamps its heartbeat. Vercel ran it every 15 minutes; the self-hosted
 * scheduler never did, so on a self-hosted deployment no notification was
 * ever evaluated or sent and ops health reported the tick as stale for ever.
 */
async function runHealth() {
  const startedAt = performance.now()
  const result = await tick("health")
  if (result?.skipped === true) return noteSkip("health")
  completion("health", startedAt, {
    organisations: result?.organisations ?? 0,
    opened: result?.opened ?? 0,
    resolved: result?.resolved ?? 0,
    sent: result?.sent ?? 0,
    failed: result?.failed ?? 0,
    errors: result?.errors ?? 0,
  })
}

/**
 * Cursor-paged ticks: one page per fire, resumed by the route from
 * `cron_cursor` (lib/server/cron-cursor.ts), as on Vercel. The cursor used
 * to live in this process and was lost on every restart.
 */
function logTruncation(name, result) {
  if (!result?.truncated) return
  // The route stopped on its own wall-clock budget and stored a cursor;
  // nothing else says how many organisations it did not reach.
  log("warn", `${name}.truncated`, {
    nextCursor: result.nextCursor ?? null,
    skippedOrganisations: result.skippedOrganisations ?? 0,
  })
}

async function runPresenceResources() {
  const startedAt = performance.now()
  const result = await tick("presence_resources")
  if (result?.skipped === true) return noteSkip("presence_resources")
  logTruncation("presence_resources", result)
  const outcomes = result?.outcomes ?? []
  completion("presence_resources", startedAt, {
    succeeded: outcomes.filter((outcome) => outcome.status === "succeeded")
      .length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
    reapedProposals: result?.reapedProposals ?? 0,
    nextCursor: result?.nextCursor ?? null,
  })
}

/**
 * The hourly Stripe reconciliation (P07-S4). It completes doing nothing
 * while billing is disabled.
 */
async function runBillingReconcile() {
  const startedAt = performance.now()
  const result = await tick("billing_reconcile")
  if (result?.skipped === true) return noteSkip("billing_reconcile")
  completion("billing_reconcile", startedAt, {
    enabled: result?.enabled ?? null,
    processed: result?.processed ?? 0,
    failures: result?.failures?.length ?? 0,
    nextCursor: result?.nextCursor ?? null,
  })
}

async function runJobs() {
  const startedAt = performance.now()
  const result = await tick("jobs")
  if (result?.skipped === true) return noteSkip("jobs")
  completion("jobs", startedAt, { ...result })
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const RETRY_BASE_MS = 60_000

/**
 * Jittered exponential back-off, capped well below the tick's own interval so
 * a retry can never collide with the next scheduled run. Jitter keeps two
 * replicas recovering from the same blip from retrying in lockstep.
 */
function retryDelayMs(attempt, everyMs) {
  const cap = Math.min(everyMs / 4, 15 * 60_000)
  const backoff = Math.min(cap, RETRY_BASE_MS * 2 ** (attempt - 1))
  return Math.round(backoff * (0.5 + Math.random() / 2))
}

// Test-only: SCHEDULER_INITIAL_DELAY_MS_<TICK> (for example
// SCHEDULER_INITIAL_DELAY_MS_RECONCILIATION=0) brings one tick's first fire
// forward. It can only shorten the delay below, never lengthen it, so the
// ticks keep their stagger unless a caller asks otherwise. The parity suite
// (tests/integration/routes/scheduler-parity.test.ts) fires reconciliation at
// once instead of waiting 5 s, while jobs keeps its 10 s.
const initialDelaysMs = {}

function initialDelay(name, fallbackMs) {
  const value =
    process.env[`SCHEDULER_INITIAL_DELAY_MS_${name.toUpperCase()}`] ?? ""
  const delay = /^\d+$/.test(value)
    ? Math.min(Number(value), fallbackMs)
    : fallbackMs
  initialDelaysMs[name] = delay
  return delay
}

function recurring(name, task, everyMs, defaultInitialDelayMs, options = {}) {
  const initialDelayMs = initialDelay(name, defaultInitialDelayMs)
  const maxRetries = options.retries ?? 0
  let running = false
  let retryTimer
  const execute = async (attempt = 0) => {
    if (running) {
      log("warn", `${name}.skipped`, { reason: "previous_run_active" })
      return
    }
    running = true
    try {
      await task()
    } catch (error) {
      const retrying = attempt < maxRetries
      log("error", `${name}.failed`, {
        error: error instanceof Error ? error.message : String(error),
        attempt: attempt + 1,
        retrying,
      })
      if (retrying) {
        clearTimeout(retryTimer)
        retryTimer = setTimeout(
          () => void execute(attempt + 1),
          retryDelayMs(attempt + 1, everyMs)
        )
      }
    } finally {
      running = false
    }
  }
  const initial = setTimeout(() => void execute(), initialDelayMs)
  const timer = setInterval(() => void execute(), everyMs)
  return () => {
    clearTimeout(initial)
    clearTimeout(retryTimer)
    clearInterval(timer)
  }
}

// A day-long interval means one transient 502 costs a full day of purges or
// of keyword ingestion, so the long-period ticks get a small bounded retry.
// The 60-second jobs tick does not: its next run is sooner than any back-off.
const DAILY_RETRIES = { retries: 3 }

const stopReconciliation = recurring(
  "reconciliation",
  runReconciliation,
  reconcileIntervalMs,
  5_000
)
// Five-minute dispatcher: the next fire is the retry.
const stopRetention = retentionEnabled
  ? recurring("retention", runRetention, retentionIntervalMs, 30_000)
  : () => {}
const stopJobs = recurring("jobs", runJobs, jobsIntervalMs, 10_000)
const stopHealth = notificationsEnabled
  ? recurring("health", runHealth, healthIntervalMs, 50_000)
  : () => {}
const stopPerformance = recurring(
  "performance",
  runPerformance,
  performanceIntervalMs,
  20_000,
  DAILY_RETRIES
)
const stopKeywords = recurring(
  "keywords",
  runKeywords,
  keywordIntervalMs,
  25_000,
  DAILY_RETRIES
)
const stopPresenceResources = recurring(
  "presence_resources",
  runPresenceResources,
  presenceResourceIntervalMs,
  35_000
)
const stopSweep = recurring(
  "sweep",
  runSweep,
  sweepIntervalMs,
  45_000,
  DAILY_RETRIES
)

const stopBillingReconcile = recurring(
  "billing_reconcile",
  runBillingReconcile,
  billingReconcileIntervalMs,
  55_000
)

function shutdown(signal) {
  stopReconciliation()
  stopRetention()
  stopJobs()
  stopHealth()
  stopPerformance()
  stopKeywords()
  stopPresenceResources()
  stopSweep()
  stopBillingReconcile()
  log("info", "scheduler.stopped", { signal })
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
log("info", "scheduler.started", {
  reconcileIntervalSeconds: reconcileIntervalMs / 1000,
  retentionEnabled,
  retentionIntervalSeconds: retentionIntervalMs / 1000,
  jobsIntervalSeconds: jobsIntervalMs / 1000,
  notificationsEnabled,
  healthIntervalSeconds: healthIntervalMs / 1000,
  performanceIntervalSeconds: performanceIntervalMs / 1000,
  keywordIntervalSeconds: keywordIntervalMs / 1000,
  presenceResourceIntervalSeconds: presenceResourceIntervalMs / 1000,
  sweepIntervalSeconds: sweepIntervalMs / 1000,
  billingReconcileIntervalSeconds: billingReconcileIntervalMs / 1000,
  initialDelaysMs,
})
