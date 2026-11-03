import { apiFetch, type RequestOptions } from "@/lib/api/client"

export type { OutboxCounts, OutboxResponse } from "./contract"

// The schemas load on demand (see `ResponseSchema` in lib/api/client): the
// counts back a navigation badge on every page, and the contract pulls in zod.
export function fetchOutbox(options?: RequestOptions) {
  return apiFetch("/api/outbox", {
    schema: () => import("./contract").then((m) => m.outboxResponseSchema),
    ...options,
  })
}

export function fetchOutboxCounts(options?: RequestOptions) {
  return apiFetch("/api/outbox/counts", {
    schema: () => import("./contract").then((m) => m.outboxCountsSchema),
    ...options,
  })
}
