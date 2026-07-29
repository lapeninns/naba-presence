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

function shutdown(signal) {
  stopReconciliation()
  stopRetention()
  log("info", "scheduler.stopped", { signal })
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
log("info", "scheduler.started", {
  reconcileIntervalSeconds: reconcileIntervalMs / 1000,
  retentionIntervalSeconds: retentionIntervalMs / 1000,
})
