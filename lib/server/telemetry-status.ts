import type { TelemetryStatus } from "@/lib/contracts/operations"

/**
 * Whether metrics leave the process, as the readiness endpoint reports it
 * (lib/server/readiness.ts).
 *
 * `instrumentation.ts` registers the OTLP metric exporter only when an
 * endpoint is configured, and wraps it so every export records its outcome
 * here. Before this the exporter was registered unconditionally: with no
 * endpoint it posted to the SDK default (localhost:4318) once a minute, failed
 * silently, and nothing said telemetry was off.
 *
 * The record lives on `globalThis` because instrumentation and route handlers
 * are separate bundles in the same Node process: a module-level variable
 * would be two variables. It is per process, so on Vercel each function
 * instance reports its own exports, and a fresh instance reads `configured`
 * until its first export interval has passed.
 */

type ExportRecord = {
  lastExportAt: Date | null
  lastFailureAt: Date | null
  lastErrorName: string | null
  consecutiveFailures: number
}

const STORE_KEY = Symbol.for("nabapresence.telemetry-export-status")

/** Failed exports in a row before the exporter reads as failing, not noisy. */
export const TELEMETRY_FAILING_AFTER = 2

function store(): ExportRecord {
  const holder = globalThis as unknown as Record<symbol, ExportRecord>
  holder[STORE_KEY] ??= {
    lastExportAt: null,
    lastFailureAt: null,
    lastErrorName: null,
    consecutiveFailures: 0,
  }
  return holder[STORE_KEY]
}

type TelemetryEnv = Record<string, string | undefined>

/**
 * Why metric export is off, or null when an OTLP endpoint is configured.
 * Mirrors what the OpenTelemetry SDK itself reads: the SDK switch, the
 * metrics exporter selector, and the generic or metrics-specific endpoint.
 */
export function telemetryDisabledReason(
  env: TelemetryEnv = process.env
): TelemetryStatus["reason"] {
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") {
    return "sdk_disabled"
  }
  if (env.OTEL_METRICS_EXPORTER?.trim().toLowerCase() === "none") {
    return "exporter_none"
  }
  const endpoint =
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() ||
    env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  return endpoint ? null : "no_endpoint"
}

/** Records one export's outcome; called by the exporter wrapper only. */
export function recordTelemetryExport(
  outcome: { ok: true } | { ok: false; error?: unknown },
  now: Date = new Date()
): void {
  const record = store()
  if (outcome.ok) {
    record.lastExportAt = now
    record.consecutiveFailures = 0
    return
  }
  record.lastFailureAt = now
  record.consecutiveFailures += 1
  // Only the error's class name (TypeError, OTLPExporterError): never its
  // message, which can echo the endpoint, nor its headers, which is where a
  // collector token lives.
  record.lastErrorName =
    outcome.error instanceof Error ? outcome.error.name : "export_failed"
}

/** Clears the record (tests). */
export function resetTelemetryExportStatus(): void {
  const record = store()
  record.lastExportAt = null
  record.lastFailureAt = null
  record.lastErrorName = null
  record.consecutiveFailures = 0
}

/**
 * The metric exporter's state in this process:
 * - `disabled`: no endpoint, or the SDK or the metrics exporter switched off
 *   (`reason` says which); nothing is exported.
 * - `configured`: an endpoint is set and no export has finished yet.
 * - `exporting`: the latest export succeeded.
 * - `failing`: the latest TELEMETRY_FAILING_AFTER or more exports failed.
 * A single failure after a success still reads `exporting`: one dropped
 * batch is noise, two in a row is a collector that is not taking them.
 */
export function telemetryStatus(
  env: TelemetryEnv = process.env
): TelemetryStatus {
  const reason = telemetryDisabledReason(env)
  const record = store()
  const times = {
    lastExportAt: record.lastExportAt?.toISOString() ?? null,
    lastFailureAt: record.lastFailureAt?.toISOString() ?? null,
    consecutiveFailures: record.consecutiveFailures,
    lastErrorName: record.lastErrorName,
  }
  if (reason) return { state: "disabled", reason, ...times }
  if (record.consecutiveFailures >= TELEMETRY_FAILING_AFTER) {
    return { state: "failing", reason: null, ...times }
  }
  if (record.lastExportAt) return { state: "exporting", reason: null, ...times }
  return { state: "configured", reason: null, ...times }
}

/** The subset of the SDK's PushMetricExporter the wrapper needs to see. */
type ExportResult = { code: number; error?: Error }
type MetricExporterLike = {
  export(metrics: unknown, resultCallback: (result: ExportResult) => void): void
}

/**
 * Wraps an exporter so each export's result is recorded before it reaches
 * the SDK. `ExportResultCode.SUCCESS` is 0 in @opentelemetry/core; anything
 * else is a failure. Every other method passes through untouched.
 */
export function withExportStatus<T extends MetricExporterLike>(exporter: T): T {
  const original = exporter.export.bind(exporter)
  exporter.export = (metrics, resultCallback) =>
    original(metrics, (result) => {
      recordTelemetryExport(
        result.code === 0 ? { ok: true } : { ok: false, error: result.error }
      )
      resultCallback(result)
    })
  return exporter
}
