import { apiFetch, type RequestOptions } from "@/lib/api/client"

import {
  encodeOutboxQuery,
  type OutboxQuery,
  type OutboxScope,
} from "./contract"

export type { OutboxCounts, OutboxResponse } from "./contract"

const withQuery = (path: string, params: URLSearchParams) => {
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

// The schemas load on demand (see `ResponseSchema` in lib/api/client): the
// counts back a navigation badge on every page, and the contract pulls in zod.
export function fetchOutbox(
  query: Partial<OutboxQuery> = {},
  options?: RequestOptions
) {
  return apiFetch(withQuery("/api/outbox", encodeOutboxQuery(query)), {
    schema: () => import("./contract").then((m) => m.outboxResponseSchema),
    ...options,
  })
}

export function fetchOutboxCounts(
  scope: OutboxScope = {},
  options?: RequestOptions
) {
  return apiFetch(withQuery("/api/outbox/counts", encodeOutboxQuery(scope)), {
    schema: () => import("./contract").then((m) => m.outboxCountsSchema),
    ...options,
  })
}
