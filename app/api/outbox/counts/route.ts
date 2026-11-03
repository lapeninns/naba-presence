import { NextResponse } from "next/server"

import { decodeOutboxQuery, type OutboxCounts } from "@/lib/outbox/contract"
import { readOutboxCounts } from "@/lib/server/outbox"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** One session's own work: never kept by a shared cache. */
const PRIVATE = { "cache-control": "private, no-store" }

/**
 * How many Outbox rows each group holds in one scope, for the page's group
 * filters and the navigation's failures badge.
 */
export const GET = route({
  roles: ["owner", "admin", "member"],
  query: (params) => {
    const { clientId, locationId } = decodeOutboxQuery(params)
    return { clientId, locationId }
  },
  handler: async ({ session, query, tenant }) =>
    NextResponse.json<OutboxCounts>(
      await tenant((sql) => readOutboxCounts(sql, session, query)),
      {
        headers: PRIVATE,
      }
    ),
})
