"use client"

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query"

import { requestOptions } from "@/lib/queries/request-options"

import { fetchOutbox, fetchOutboxCounts } from "./api"
import type { OutboxItem, OutboxResponse, OutboxScope } from "./contract"
import { outboxKeys } from "./keys"
import { outboxGroupOf, type OutboxGroupKey } from "./vocabulary"

/** How often a list with rows still with Google asks again. */
export const OUTBOX_SETTLING_MS = 60_000

/**
 * The Outbox list, one page at a time, for one scope and group filter.
 * While a loaded row is still with Google the list re-reads every minute,
 * so a row that settles moves group without a reload.
 */
export function useOutbox(scope: OutboxScope, group?: OutboxGroupKey) {
  return useInfiniteQuery({
    queryKey: outboxKeys.list(scope, group),
    queryFn: (ctx) =>
      fetchOutbox(
        { ...scope, group, cursor: ctx.pageParam ?? undefined },
        requestOptions(ctx)
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last: OutboxResponse) => last.nextCursor,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      (query.state.data?.pages ?? []).some((page) =>
        page.items.some((item) => outboxGroupOf(item.state) === "google")
      )
        ? OUTBOX_SETTLING_MS
        : false,
  })
}

/** Every loaded row, in order, each once. */
export function flattenOutbox(
  data: { pages: OutboxResponse[] } | undefined
): OutboxItem[] {
  if (!data) return []
  const seen = new Set<string>()
  return data.pages
    .flatMap((page) => page.items)
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}

/**
 * The group counts for one scope: the page's filter counts and the
 * navigation's failures badge. `enabled` is false for anyone without an
 * Outbox (viewers), so they never ask.
 */
export function useOutboxCounts(
  scope: OutboxScope,
  options: { enabled?: boolean; background?: boolean } = {}
) {
  const scoped = Boolean(scope.clientId || scope.locationId)
  return useQuery({
    enabled: options.enabled ?? true,
    queryKey: outboxKeys.counts(scope),
    queryFn: (ctx) =>
      fetchOutboxCounts(scope, {
        ...requestOptions(ctx),
        ...(options.background ? { background: true } : {}),
      }),
    placeholderData: keepPreviousData,
    // The shell refreshes unscoped counts. A scoped count must follow its
    // own pending work, even when a different group is selected in the list.
    refetchInterval: (query) =>
      scoped && (query.state.data?.google ?? 0) > 0
        ? OUTBOX_SETTLING_MS
        : false,
  })
}
