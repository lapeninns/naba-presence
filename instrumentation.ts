import type { Instrumentation } from "next"
import { registerOTel } from "@vercel/otel"

import { redactForLog } from "@/lib/domain/redaction"
import {
  INTERNAL_REQUEST_ID_HEADER,
  isRequestId,
} from "@/lib/domain/request-id"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { telemetryDisabledReason, withExportStatus } =
      await import("@/lib/server/telemetry-status")
    // Metrics are exported only to a configured collector, and every export
    // records its outcome for the readiness endpoint. With no endpoint the
    // SDK would post to localhost:4318 every interval and fail unseen; the
    // readiness endpoint reports telemetry as disabled instead.
    if (telemetryDisabledReason() === null) {
      const [{ OTLPMetricExporter }, { PeriodicExportingMetricReader }] =
        await Promise.all([
          import("@opentelemetry/exporter-metrics-otlp-http"),
          import("@opentelemetry/sdk-metrics"),
        ])
      const configuredInterval = Number(
        process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 60_000
      )
      const exportIntervalMillis =
        Number.isFinite(configuredInterval) && configuredInterval >= 1_000
          ? configuredInterval
          : 60_000
      registerOTel({
        serviceName: "nabapresence",
        metricReaders: [
          new PeriodicExportingMetricReader({
            exporter: withExportStatus(new OTLPMetricExporter()),
            exportIntervalMillis,
          }),
        ],
      })
    } else {
      registerOTel({ serviceName: "nabapresence" })
    }
    const { assertProductionSafety } = await import("@/lib/server/startup")
    await assertProductionSafety()
    if (process.env.SENTRY_DSN) {
      const { startErrorTracking } = await import("@/lib/server/error-tracking")
      startErrorTracking()
    }
    return
  }
  registerOTel({ serviceName: "nabapresence" })
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  const requestHeader = request.headers[INTERNAL_REQUEST_ID_HEADER]
  const requestId =
    context.routeType === "render" &&
    typeof requestHeader === "string" &&
    isRequestId(requestHeader)
      ? requestHeader
      : undefined
  const details = {
    error,
    // The error boundaries display this digest as a support reference.
    digest:
      error && typeof error === "object" && "digest" in error
        ? error.digest
        : undefined,
    requestId,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { log } = await import("@/lib/server/logger")
    log.error("next.request_error", details)
    if (process.env.SENTRY_DSN) {
      const { reportException } = await import("@/lib/server/error-tracking")
      await reportException(error, {
        event: "next.request_error",
        requestId,
        method: request.method,
        route: context.routePath,
      })
    }
    return
  }
  console.error(
    JSON.stringify(
      redactForLog({ ...details, event: "next.request_error" }, 0, true)
    )
  )
}
