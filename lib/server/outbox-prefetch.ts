import "server-only"

import {
  outboxCountsSchema,
  outboxResponseSchema,
  type OutboxQuery,
} from "@/lib/outbox/contract"
import { outboxKeys } from "@/lib/outbox/keys"
import { withTenant } from "@/lib/server/db"
import { readOutboxPage } from "@/lib/server/outbox"
import { throughWire, type PrefetchEntry } from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

/**
 * /outbox: the first page of the list and the scope's counts in the first
 * HTML, from one read, under the keys the view's hooks read on their first
 * render (lib/outbox/queries.ts). Not for viewers, whom the routes refuse.
 *
 * Kept out of lib/server/outbox.ts so the routes do not import the prefetch
 * module (and, through it, the Google transport the max-duration scan
 * follows).
 */
export function outboxPrefetch(
  query: Omit<OutboxQuery, "cursor">
): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (session.role === "viewer") return []
    const scope = { clientId: query.clientId, locationId: query.locationId }
    let read: ReturnType<typeof load> | undefined
    const load = () =>
      withTenant(session.organisationId, (sql) =>
        readOutboxPage(sql, session, query)
      )
    // Both entries share the one read; it starts with the first to ask.
    const once = () => (read ??= load())
    return [
      {
        queryKey: outboxKeys.list(scope, query.group),
        load: async () => ({
          pages: [throughWire(outboxResponseSchema, (await once()).page)],
          pageParams: [null],
        }),
      },
      {
        queryKey: outboxKeys.counts(scope),
        load: async () =>
          throughWire(outboxCountsSchema, (await once()).counts),
      },
    ]
  }
}
