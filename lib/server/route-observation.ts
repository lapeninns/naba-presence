import "server-only"

import { apiError, serverRequestId } from "@/lib/server/http"
import { withRequestContext } from "@/lib/server/request-context"
import { withRequestMetrics } from "@/lib/server/request-metrics"

export function observeRoute(
  request: Request,
  cron: boolean,
  run: (rid: ReturnType<typeof serverRequestId>) => Promise<Response>
) {
  const rid = serverRequestId(request)
  return withRequestContext(rid.id, () =>
    withRequestMetrics(
      { method: request.method, pathname: new URL(request.url).pathname, cron },
      () => run(rid)
    )
  )
}

export async function observeRouteError(
  error: unknown,
  id: string,
  method: string
) {
  const response = apiError(error, id)
  if (response.status === 500 && process.env.SENTRY_DSN) {
    const { reportException } = await import("@/lib/server/error-tracking")
    await reportException(error, { event: "api.unhandled_error", method })
  }
  return response
}
