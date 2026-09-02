import type { QueryFunctionContext } from "@tanstack/react-query"

import type { RequestOptions } from "@/lib/api/client"

/**
 * Translate a React Query `queryFn` context into the per-request options
 * every `lib/api` read function accepts.
 *
 * - `signal` is React Query's abort signal for this fetch: superseded
 *   requests (a new inbox search keystroke, a rapid filter toggle, an
 *   unmounted observer) are cancelled instead of racing the live one.
 * - `background` is true when the query already holds data — React Query's
 *   definition of a refetch (`isRefetching`), which is what every
 *   window-focus and interval refetch is. A background 401 must not
 *   redirect to /sign-in (see the 401 rule on `apiFetch`); an initial load,
 *   a new filter key or a fresh mount has nothing on screen and stays
 *   foreground. A "load more" page on an infinite query is user-initiated,
 *   so it stays foreground even though pages are cached.
 */
export function requestOptions(
  ctx: Pick<QueryFunctionContext, "client" | "queryKey" | "signal">
): RequestOptions {
  const state = ctx.client.getQueryState(ctx.queryKey)
  // A query that already failed (its previous background refetch threw the
  // 401) is retried as foreground, so "Try again" can redirect to /sign-in
  // instead of failing the same way forever.
  const background =
    state?.data !== undefined &&
    state.status !== "error" &&
    state.fetchMeta?.fetchMore === undefined
  return { signal: ctx.signal, background }
}
