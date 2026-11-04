import type { OutboxQuery } from "./contract"

/** Default rows per page. */
export const OUTBOX_PAGE_SIZE = 50

export const OUTBOX_QUERY_PARAMS = {
  clientId: "client_id",
  locationId: "location_id",
  group: "group",
  cursor: "cursor",
  limit: "limit",
} as const

// The dashboard badge encodes its request before loading the response schema.
// Keep this module free of runtime schema imports.
export function encodeOutboxQuery(
  query: Partial<OutboxQuery>
): URLSearchParams {
  const params = new URLSearchParams()
  if (query.clientId) params.set(OUTBOX_QUERY_PARAMS.clientId, query.clientId)
  if (query.locationId)
    params.set(OUTBOX_QUERY_PARAMS.locationId, query.locationId)
  if (query.group) params.set(OUTBOX_QUERY_PARAMS.group, query.group)
  if (query.cursor) params.set(OUTBOX_QUERY_PARAMS.cursor, query.cursor)
  if (query.limit && query.limit !== OUTBOX_PAGE_SIZE)
    params.set(OUTBOX_QUERY_PARAMS.limit, String(query.limit))
  return params
}
