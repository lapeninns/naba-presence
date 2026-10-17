import type { notificationPreferencesUpdateSchema } from "@/lib/contracts/operational-notifications"
import type { z } from "zod"

import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import * as React from "react"

import { clientCapabilityHeaders } from "@/lib/contracts/client-capabilities"
import type { Store } from "@/lib/notifications/pending-store"

import { apiFetch, type RequestOptions } from "./client"

// Schemas load on demand (see `ResponseSchema` in ./client): the bell in the
// app bar reads unread notifications on every page, and the contract pulls
// in zod.
const contract = () => import("@/lib/contracts/operational-notifications")

export type NotificationFilter = "all" | "unread" | "open"

export function fetchNotifications(
  filter: NotificationFilter,
  cursor?: string,
  options?: RequestOptions
) {
  const query = new URLSearchParams({ filter })
  if (cursor) query.set("cursor", cursor)
  return apiFetch(`/api/notifications?${query}`, {
    schema: () => contract().then((m) => m.notificationListResponseSchema),
    headers: clientCapabilityHeaders(),
    ...options,
  })
}
export const markNotificationsRead = (incidentIds: string[], read = true) =>
  apiFetch("/api/notifications/read", {
    method: "POST",
    body: { incidentIds, read },
    schema: () => contract().then((m) => m.notificationsReadResponseSchema),
  })
export const resolveNotification = (incidentId: string) =>
  apiFetch(`/api/notifications/${incidentId}/resolve`, {
    method: "POST",
    body: {},
    schema: () => contract().then((m) => m.notificationResolvedResponseSchema),
  })
export const fetchNotificationPreferences = (options?: RequestOptions) =>
  apiFetch("/api/notifications/preferences", {
    schema: () =>
      contract().then((m) => m.notificationPreferencesResponseSchema),
    headers: clientCapabilityHeaders(),
    ...options,
  })
export const updateNotificationPreferences = (
  changes: z.infer<typeof notificationPreferencesUpdateSchema>["changes"]
) =>
  apiFetch("/api/notifications/preferences", {
    method: "PUT",
    body: { changes },
    schema: () =>
      contract().then((m) => m.notificationPreferencesResponseSchema),
    headers: clientCapabilityHeaders(),
  })

// ---------------------------------------------------------------------------
// Pending changes: the part the shell's bell needs
// ---------------------------------------------------------------------------
// Here, beside the module the bell and the page already share, and not in a
// module of its own: see lib/notifications/pending-store.ts. The page's
// overlay, count and commit are in lib/notifications/pending-changes.ts.

const stores = new WeakMap<QueryClient, Store>()

export function storeFor(client: QueryClient): Store {
  let store = stores.get(client)
  if (!store) {
    const listeners = new Set<() => void>()
    store = {
      changes: [],
      published: [],
      pin: null,
      publishedPin: null,
      listeners,
      subscribe: (onChange) => {
        listeners.add(onChange)
        return () => void listeners.delete(onChange)
      },
      delta: null,
    }
    stores.set(client, store)
  }
  return store
}

/**
 * How far this session's pending changes move the "open and unread" count.
 * The page's list and the shell's bell both add it to what the server last
 * said, so they agree while a change is out and roll back together. The store
 * tells it when a pending change or the cache moves. `prefer`
 * names the cached list whose rows are read first ("badge", for the bell).
 */
export function usePendingUnreadDelta(prefer?: string): number {
  const client = useQueryClient()
  const store = storeFor(client)
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.delta?.(client, prefer) ?? 0,
    // Nothing is pending while the server renders: the bell shows the
    // cache's own count, and hydration matches it.
    () => 0
  )
}
