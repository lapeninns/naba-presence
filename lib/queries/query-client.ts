import { QueryClient } from "@tanstack/react-query"

import { ApiClientError } from "@/lib/api/client"

/**
 * One retry for a read that may succeed a second later — a dropped
 * connection, a 5xx, a 408 or a 429 — and none for any other 4xx: a 404,
 * 403, 409 or 422 answers the same again, and retrying only delayed the
 * error state by a second and reported the lost access twice.
 */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount >= 1) return false
  if (!(error instanceof ApiClientError)) return true
  const { status } = error
  return status < 400 || status >= 500 || status === 408 || status === 429
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: true,
        // `offlineFirst`, not the "online" default. On "online", a query is
        // PAUSED whenever `navigator.onLine` is false: status stays "pending",
        // no request is sent and no error is ever thrown. Every pending state
        // in this app is a skeleton, so a sleeping laptop, a VPN flap or a
        // captive portal produced a grey screen that never resolved and never
        // explained itself — and no request timeout can fix that, because
        // there is no request. `offlineFirst` always makes the first attempt,
        // so a wrong offline signal costs nothing and a real outage surfaces
        // as an error with a retry.
        networkMode: "offlineFirst",
      },
      // Same reasoning, and worse consequences: a paused mutation leaves
      // "Publish to Google" on "Publishing…" with no error, forever.
      mutations: { retry: 0, networkMode: "offlineFirst" },
    },
  })
}
