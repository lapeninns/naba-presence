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
  interval("RETENTION_INTERVAL_SECONDS", 86400, 3600) * 1000
const jobsIntervalMs = interval("JOBS_INTERVAL_SECONDS", 60, 10) * 1000
const performanceIntervalMs =
  interval("PERFORMANCE_INTERVAL_SECONDS", 21600, 3600) * 1000
const keywordIntervalMs =
  interval("KEYWORD_INTERVAL_SECONDS", 86400, 3600) * 1000
const presenceResourceIntervalMs =
  interval("PRESENCE_RESOURCE_RECONCILE_INTERVAL_SECONDS", 900, 300) * 1000
const sweepIntervalMs = interval("SWEEP_INTERVAL_SECONDS", 86400, 3600) * 1000
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

async function post(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${cronSecret}`,
      "content-type": "application/json",
      "x-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
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

// ---------------------------------------------------------------------------
// Cursor walks
// ---------------------------------------------------------------------------

const MAX_PAGES = 1000
/**
 * How many consecutive ticks may fail on the same organisation before the
 * walk is sent back to the head. Resuming is the point of the watermark, but
 * a page that fails every time would otherwise starve every organisation
 * BEFORE it just as surely as restarting starved the ones after it.
 */
const CURSOR_STALL_LIMIT = 3
/** tick name -> { cursor, stalledTicks } for the walk in progress. */
const walks = new Map()
/** tick name -> consecutive advisory-lock skips. */
const skips = new Map()

function walkCursor(name) {
  return walks.get(name)?.cursor
}

function rememberCursor(name, cursor) {
  if (cursor) walks.set(name, { cursor, stalledTicks: 0 })
  else walks.delete(name)
}

function noteWalkFailure(name, startedFrom) {
  const state = walks.get(name)
  if (!state) return
  if (state.cursor !== startedFrom) {
    // The tick got at least one page further before it died, so the next one
    // resumes somewhere new; that is progress, not a stall.
    state.stalledTicks = 0
    return
  }
  state.stalledTicks += 1
  if (state.stalledTicks < CURSOR_STALL_LIMIT) return
  walks.delete(name)
  log("warn", `${name}.cursor_reset`, {
    cursor: state.cursor,
    stalledTicks: state.stalledTicks,
  })
}

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

/**
 * Drives one cursor-paged tick.
 *
 * The cursor lives in `walks` rather than in a call-local variable: a page
 * that throws (a 5xx, or the 55s client abort) used to discard it, so the
 * next tick restarted at the head of the tenant order and every organisation
 * after the slow one was never reached again. It survives a failed tick, not
 * a process restart, which is why a restart is a fresh walk from the head.
 *
 * `requestPage(cursor)` performs one page; `onPage(result)` accumulates it.
 */
async function paginate(name, requestPage, onPage) {
  const resumedFrom = walkCursor(name)
  let cursor = resumedFrom
  let pages = 0
  try {
    do {
      const result = await requestPage(cursor)
      if (result?.skipped === true) {
        return { skipped: true, resumedFrom, pages }
      }
      onPage(result)
      cursor = result?.nextCursor ?? undefined
      rememberCursor(name, cursor)
      pages += 1
      if (cursor && pages >= MAX_PAGES) {
        throw new Error(`${name} cursor exceeded ${MAX_PAGES} pages.`)
      }
    } while (cursor)
    return { skipped: false, resumedFrom, pages }
  } catch (error) {
    noteWalkFailure(name, resumedFrom)
    throw error
  }
}

function completion(name, walk, startedAt, context) {
  noteRun(name)
  log("info", `${name}.completed`, {
    ...context,
    pages: walk.pages,
    resumedFrom: walk.resumedFrom ?? null,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

async function runReconciliation() {
  const startedAt = performance.now()
  let organisations = 0
  let failures = 0
  const walk = await paginate(
    "reconciliation",
    (cursor) =>
      post("/api/sync/reconcile", {
        organisationCursor: cursor,
        maxOrganisations: 100,
      }),
    (page) => {
      organisations += page.processed ?? 0
      failures += page.failures?.length ?? 0
    }
  )
  if (walk.skipped) {
    return noteSkip("reconciliation", { cursor: walk.resumedFrom ?? null })
  }
  if (failures) log("warn", "reconcile.partial", { failures })
  completion("reconciliation", walk, startedAt, { organisations, failures })
}

async function runRetention() {
  const startedAt = performance.now()
  let organisations = 0
  let failures = 0
  const walk = await paginate(
    "retention",
    (cursor) => {
      const query = new URLSearchParams({ batch_size: "100" })
      if (cursor) query.set("cursor", cursor)
      return post(`/api/cron/retention?${query}`, {})
    },
    (page) => {
      organisations += page.organisations?.length ?? 0
      failures += page.failures?.length ?? 0
    }
  )
  if (walk.skipped) {
    return noteSkip("retention", { cursor: walk.resumedFrom ?? null })
  }
  // The route isolates a failing tenant and reports it rather than aborting
  // the page, so without this the only trace of a starving organisation is a
  // counter that is quietly short.
  if (failures) log("warn", "retention.partial", { failures })
  completion("retention", walk, startedAt, { organisations, failures })
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
  const result = await post("/api/cron/health", {})
  if (result?.skipped === true) return noteSkip("health")
  noteRun("health")
  log("info", "health.completed", {
    organisations: result?.organisations ?? 0,
    opened: result?.opened ?? 0,
    resolved: result?.resolved ?? 0,
    sent: result?.sent ?? 0,
    failed: result?.failed ?? 0,
    errors: result?.errors ?? 0,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

async function runJobs() {
  const startedAt = performance.now()
  const result = await post("/api/jobs/run", {})
  if (result?.skipped === true) return noteSkip("jobs")
  noteRun("jobs")
  log("info", "jobs.completed", {
    ...result,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

function countOutcomes(page) {
  return (
    page.organisations?.reduce(
      (sum, organisation) => sum + (organisation.outcomes?.length ?? 0),
      0
    ) ?? 0
  )
}

function logTruncation(name, page, cursor) {
  if (!page.truncated) return
  // The route stopped on its own wall-clock budget and handed back a cursor;
  // nothing else says which organisations it did not reach.
  log("warn", `${name}.truncated`, {
    organisationCursor: cursor ?? null,
    skippedOrganisations: page.skippedOrganisations ?? 0,
  })
}

async function runPerformance() {
  const startedAt = performance.now()
  let organisations = 0
  let locations = 0
  const walk = await paginate(
    "performance",
    (cursor) =>
      post("/api/sync/performance", {
        organisationCursor: cursor,
        maxOrganisations: 100,
        maxLocations: 25,
      }),
    (page) => {
      organisations += page.organisations?.length ?? 0
      locations += countOutcomes(page)
      logTruncation("performance", page, page.nextCursor)
    }
  )
  if (walk.skipped) {
    return noteSkip("performance", { cursor: walk.resumedFrom ?? null })
  }
  completion("performance", walk, startedAt, { organisations, locations })
}

async function runKeywords() {
  const startedAt = performance.now()
  let organisations = 0
  let locations = 0
  const walk = await paginate(
    "keywords",
    (cursor) =>
      post("/api/sync/keywords", {
        organisationCursor: cursor,
        maxOrganisations: 100,
        maxLocations: 10,
      }),
    (page) => {
      organisations += page.organisations?.length ?? 0
      locations += countOutcomes(page)
      logTruncation("keywords", page, page.nextCursor)
    }
  )
  if (walk.skipped) {
    return noteSkip("keywords", { cursor: walk.resumedFrom ?? null })
  }
  completion("keywords", walk, startedAt, { organisations, locations })
}

async function runPresenceResources() {
  const startedAt = performance.now()
  let succeeded = 0
  let failed = 0
  let reapedProposals = 0
  const walk = await paginate(
    "presence_resources",
    (cursor) =>
      post("/api/sync/presence-resources", {
        organisationCursor: cursor,
        maxOrganisations: 10,
        maxLocations: 5,
      }),
    (page) => {
      succeeded +=
        page.outcomes?.filter((outcome) => outcome.status === "succeeded")
          .length ?? 0
      failed +=
        page.outcomes?.filter((outcome) => outcome.status === "failed")
          .length ?? 0
      reapedProposals += page.reapedProposals ?? 0
      logTruncation("presence_resources", page, page.nextCursor)
    }
  )
  if (walk.skipped) {
    return noteSkip("presence_resources", { cursor: walk.resumedFrom ?? null })
  }
  completion("presence_resources", walk, startedAt, {
    succeeded,
    failed,
    reapedProposals,
  })
}

/**
 * Tombstones reviews the provider has deleted. Nothing drove this before, so
 * `provider_deleted_at` was never set outside a hand-made request and a
 * deleted review stayed in the inbox for ever.
 *
 * A cron-token POST queues the whole fleet in one statement
 * (`enqueueFleetSweep` in app/api/sync/sweep/route.ts) and ignores any body;
 * the job runner then walks each location's history, since sweep is one of
 * the sync types claim_due_jobs claims. The walk below therefore ends after
 * its first page (`nextCursor` is always null).
 */
async function runSweep() {
  const startedAt = performance.now()
  let organisations = 0
  let failures = 0
  const walk = await paginate(
    "sweep",
    () => post("/api/sync/sweep", {}),
    (page) => {
      organisations += page.processed ?? 0
      failures += page.failures?.length ?? 0
    }
  )
  if (walk.skipped) {
    return noteSkip("sweep", { cursor: walk.resumedFrom ?? null })
  }
  if (failures) log("warn", "sweep.partial", { failures })
  completion("sweep", walk, startedAt, { organisations, failures })
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

function recurring(name, task, everyMs, initialDelayMs, options = {}) {
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
        // Which organisation the walk died on, so a starving fleet is
        // nameable from the log alone.
        cursor: walkCursor(name) ?? null,
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
const stopRetention = retentionEnabled
  ? recurring(
      "retention",
      runRetention,
      retentionIntervalMs,
      30_000,
      DAILY_RETRIES
    )
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

function shutdown(signal) {
  stopReconciliation()
  stopRetention()
  stopJobs()
  stopHealth()
  stopPerformance()
  stopKeywords()
  stopPresenceResources()
  stopSweep()
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
})
