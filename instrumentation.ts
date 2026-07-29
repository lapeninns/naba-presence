import type { Instrumentation } from "next"
import { registerOTel } from "@vercel/otel"

import { redactForLog } from "@/lib/domain/redaction"

export function register() {
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
