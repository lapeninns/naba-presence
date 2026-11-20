import "server-only"

import * as Sentry from "@sentry/node"

import { log } from "@/lib/server/logger"
import { requestContext } from "@/lib/server/request-context"

export function startErrorTracking() {
  const dsn = process.env.SENTRY_DSN?.trim()
  if (!dsn) return
  try {
    Sentry.init({
      dsn,
      defaultIntegrations: false,
      skipOpenTelemetrySetup: true,
      sendDefaultPii: false,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      maxBreadcrumbs: 4,
    })
  } catch {
    log.warn("error_tracking.initialization_failed")
  }
}

type Failure = {
  event: "next.request_error" | "api.unhandled_error"
  requestId?: string
  route?: string
  method?: string
}

export async function reportException(error: unknown, failure: Failure) {
  if (!Sentry.isEnabled()) return
  const identity = requestContext()
  try {
    // Preserve call sites, not the original message/cause (which can contain
    // customer data, SQL, request bodies or upstream credentials).
    const safe = new Error(failure.event)
    const frames =
      error instanceof Error
        ? error.stack
            ?.slice(Error.prototype.toString.call(error).length)
            .split("\n")
            .filter((line) => /^\s+at /.test(line))
        : undefined
    if (frames?.length) safe.stack = [safe.toString(), ...frames].join("\n")
    Sentry.withScope((scope) => {
      scope.clear()
      scope.setTag("operation", failure.event)
      scope.setContext("request_correlation", {
        id: identity?.requestId ?? failure.requestId,
      })
      scope.setContext("actor", {
        authenticated: identity?.authenticated ?? null,
      })
      scope.addBreadcrumb({
        category: "http",
        message: failure.event,
        data: { route: failure.route, method: failure.method },
      })
      Sentry.captureException(safe)
    })
    await Sentry.flush(750)
  } catch {
    log.warn("error_tracking.capture_failed")
  }
}
