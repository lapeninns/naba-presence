import type { OutboxCounts } from "@/lib/outbox/contract"
import { readOutboxCounts } from "@/lib/server/outbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** How many Outbox rows each group holds, for the navigation's badge. */
export const GET = route({
  roles: ["owner", "admin", "member"],
  handler: async ({ session, tenant }): Promise<OutboxCounts> =>
    tenant((sql) => readOutboxCounts(sql, session)),
})
