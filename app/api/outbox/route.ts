import { decodeOutboxQuery, type OutboxResponse } from "@/lib/outbox/contract"
import { readOutbox } from "@/lib/server/outbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * The Outbox (DIRECTION §7.1): writes waiting for a person, with Google,
 * failed, or confirmed in the last day, one page at a time. Read-only and
 * narrowed to the listings the session can see, then to `client_id` /
 * `location_id` when given (lib/server/outbox.ts). Viewers cannot send, so
 * they have no Outbox.
 */
export const GET = route({
  roles: ["owner", "admin", "member"],
  query: (params) => decodeOutboxQuery(params),
  handler: async ({ session, query, tenant }): Promise<OutboxResponse> =>
    tenant((sql) => readOutbox(sql, session, query)),
})
