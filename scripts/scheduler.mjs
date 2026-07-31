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

const reconcileIntervalMs =
  interval("RECONCILE_INTERVAL_SECONDS", 900, 60) * 1000
const retentionIntervalMs =
  interval("RETENTION_INTERVAL_SECONDS", 86400, 3600) * 1000
const jobsIntervalMs =
  interval("JOBS_INTERVAL_SECONDS", 60, 10) * 1000
const performanceIntervalMs =
  interval("PERFORMANCE_INTERVAL_SECONDS", 21600, 3600) * 1000
const performanceEnabled = process.env.GBP_PERFORMANCE_ENABLED === "true"
const keywordIntervalMs =
  interval("KEYWORD_INTERVAL_SECONDS", 86400, 3600) * 1000
const keywordsEnabled = process.env.GBP_KEYWORDS_ENABLED === "true"
const presenceResourceIntervalMs =
  interval("PRESENCE_RESOURCE_RECONCILE_INTERVAL_SECONDS", 900, 300) * 1000

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

async function runReconciliation() {
  const startedAt = performance.now()
  let organisationCursor
  let organisations = 0
  let pages = 0
  do {
    const result = await post("/api/sync/reconcile", {
      organisationCursor,
      maxOrganisations: 100,
    })
    organisations += result.processed ?? 0
    if (result.failures?.length) {
      log("warn", "reconcile.partial", {
        failures: result.failures.length,
      })
    }
    organisationCursor = result.nextCursor ?? undefined
    pages += 1
    if (pages > 1000) {
      throw new Error("Reconciliation cursor exceeded 1000 pages.")
    }
  } while (organisationCursor)
  log("info", "reconciliation.completed", {
    organisations,
    pages,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

async function runRetention() {
  const startedAt = performance.now()
  let cursor
  let organisations = 0
  let pages = 0
  do {
    const query = new URLSearchParams({ batch_size: "100" })
    if (cursor) query.set("cursor", cursor)
    const result = await post(`/api/cron/retention?${query}`, {})
    organisations += result.organisations?.length ?? 0
    cursor = result.nextCursor ?? undefined
    pages += 1
    if (pages > 1000) {
      throw new Error("Retention cursor exceeded 1000 pages.")
    }
  } while (cursor)
  log("info", "retention.completed", {
    organisations,
    pages,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

async function runJobs() {
  const startedAt = performance.now()
  const result = await post("/api/jobs/run", {})
  log("info", "jobs.completed", {
    ...result,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

async function runPerformance() {
  const startedAt = performance.now()
  let organisationCursor
  let organisations = 0
  let locations = 0
  let pages = 0
  do {
    const result = await post("/api/sync/performance", {
      organisationCursor,
      maxOrganisations: 100,
      maxLocations: 25,
    })
    organisations += result.organisations?.length ?? 0
    locations +=
      result.organisations?.reduce(
        (sum, organisation) => sum + (organisation.outcomes?.length ?? 0),
        0
      ) ?? 0
    organisationCursor = result.nextCursor ?? undefined
    pages += 1
    if (pages > 1000) {
      throw new Error("Performance cursor exceeded 1000 pages.")
    }
  } while (organisationCursor)
  log("info", "performance.completed", {
    organisations,
    locations,
    pages,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

async function runKeywords() {
  const startedAt = performance.now()
  let organisationCursor
  let organisations = 0
  let locations = 0
  let pages = 0
  do {
    const result = await post("/api/sync/keywords", {
      organisationCursor,
      maxOrganisations: 100,
      maxLocations: 10,
    })
    organisations += result.organisations?.length ?? 0
    locations +=
      result.organisations?.reduce(
        (sum, organisation) => sum + (organisation.outcomes?.length ?? 0),
        0
      ) ?? 0
    organisationCursor = result.nextCursor ?? undefined
    pages += 1
    if (pages > 1000) {
      throw new Error("Keyword cursor exceeded 1000 pages.")
    }
  } while (organisationCursor)
  log("info", "keywords.completed", {
    organisations,
    locations,
    pages,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

async function runPresenceResources() {
  const startedAt = performance.now()
  let organisationCursor
  let succeeded = 0
  let failed = 0
  let pages = 0
  do {
    const result = await post("/api/sync/presence-resources", {
      organisationCursor,
      maxOrganisations: 10,
      maxLocations: 5,
    })
    succeeded += result.outcomes?.filter((outcome) => outcome.status === "succeeded").length ?? 0
    failed += result.outcomes?.filter((outcome) => outcome.status === "failed").length ?? 0
    organisationCursor = result.nextCursor ?? undefined
    pages += 1
    if (pages > 1000) throw new Error("Presence-resource cursor exceeded 1000 pages.")
  } while (organisationCursor)
  log("info", "presence_resources.completed", {
    succeeded,
    failed,
    pages,
    durationMs: Math.round(performance.now() - startedAt),
  })
}

function recurring(name, task, everyMs, initialDelayMs) {
  let running = false
  const execute = async () => {
    if (running) {
      log("info", `${name}.skipped`, { reason: "previous_run_active" })
      return
    }
    running = true
    try {
      await task()
    } catch (error) {
      log("error", `${name}.failed`, {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }
  const initial = setTimeout(() => void execute(), initialDelayMs)
  const timer = setInterval(() => void execute(), everyMs)
  return () => {
    clearTimeout(initial)
    clearInterval(timer)
  }
}

const stopReconciliation = recurring(
  "reconciliation",
  runReconciliation,
  reconcileIntervalMs,
  5_000
)
const stopRetention = recurring(
  "retention",
  runRetention,
  retentionIntervalMs,
  30_000
)
const stopJobs = recurring("jobs", runJobs, jobsIntervalMs, 10_000)
const stopPerformance = performanceEnabled
  ? recurring(
      "performance",
      runPerformance,
      performanceIntervalMs,
      20_000
    )
  : () => {}
const stopKeywords = keywordsEnabled
  ? recurring("keywords", runKeywords, keywordIntervalMs, 25_000)
  : () => {}
const stopPresenceResources = recurring(
  "presence_resources",
  runPresenceResources,
  presenceResourceIntervalMs,
  35_000
)

function shutdown(signal) {
  stopReconciliation()
  stopRetention()
  stopJobs()
  stopPerformance()
  stopKeywords()
  stopPresenceResources()
  log("info", "scheduler.stopped", { signal })
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
log("info", "scheduler.started", {
  reconcileIntervalSeconds: reconcileIntervalMs / 1000,
  retentionIntervalSeconds: retentionIntervalMs / 1000,
  jobsIntervalSeconds: jobsIntervalMs / 1000,
  performanceEnabled,
  performanceIntervalSeconds: performanceIntervalMs / 1000,
  keywordsEnabled,
  keywordIntervalSeconds: keywordIntervalMs / 1000,
  presenceResourceIntervalSeconds: presenceResourceIntervalMs / 1000,
})
