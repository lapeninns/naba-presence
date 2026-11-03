import type { OutboxResponse } from "@/lib/outbox/contract"
import { readOutbox } from "@/lib/server/outbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * The Outbox (DIRECTION §7.1): this session's writes on their way to Google,
 * waiting for a person, failed, or confirmed in the last day. Read-only and
 * narrowed to the listings the session can see (lib/server/outbox.ts).
 * Viewers cannot send, so they have no Outbox.
 */
export const GET = route({
  roles: ["owner", "admin", "member"],
  handler: async ({ session, tenant }): Promise<OutboxResponse> =>
    tenant((sql) => readOutbox(sql, session)),
})
