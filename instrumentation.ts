import type { Instrumentation } from "next"
import { registerOTel } from "@vercel/otel"

import { redactForLog } from "@/lib/domain/redaction"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [
      { OTLPMetricExporter },
      { PeriodicExportingMetricReader },
    ] = await Promise.all([
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
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis,
        }),
      ],
    })
    const { assertProductionSafety } = await import(
      "@/lib/server/startup"
    )
    await assertProductionSafety()
    return
  }
  registerOTel({ serviceName: "nabapresence" })
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  console.error(
    JSON.stringify(
      redactForLog({
        timestamp: new Date().toISOString(),
        level: "error",
        event: "next.request_error",
        service: "nabapresence",
        error,
        digest:
          error && typeof error === "object" && "digest" in error
            ? error.digest
            : undefined,
        method: request.method,
        routePath: context.routePath,
        routeType: context.routeType,
        routerKind: context.routerKind,
      })
    )
  )
}
