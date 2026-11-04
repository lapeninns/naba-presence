/**
 * `GET /api/outbox` and `GET /api/outbox/counts`: the Outbox read model
 * (DIRECTION §7.1). Read-only; every row is one write on its way to Google
 * or back from it, read from the tables that already hold it (replies,
 * listing change receipts, posts, bulk listing changes). Client-safe.
 *
 * Query strings use the snake_case wire names the other list routes use
 * (`client_id`, `location_id`; lib/contracts/review-values.ts `WIRE`). Pages
 * keep camelCase in their own address (`/outbox?clientId=`).
 */
import { z } from "zod"

import {
  OUTBOX_GROUP_KEYS,
  OUTBOX_STATES,
  type OutboxGroupKey,
} from "./vocabulary"
import { OUTBOX_PAGE_SIZE, OUTBOX_QUERY_PARAMS } from "./wire"

export { encodeOutboxQuery, OUTBOX_PAGE_SIZE } from "./wire"

export const OUTBOX_KINDS = ["reply", "listing_change", "post", "bulk"] as const
export type OutboxKind = (typeof OUTBOX_KINDS)[number]

/** Maximum rows per page. */
export const OUTBOX_MAX_PAGE_SIZE = 100

export const outboxItemSchema = z.object({
  /** `<kind>:<source id>` (a bulk row adds `:<state>`): unique across kinds. */
  id: z.string(),
  kind: z.enum(OUTBOX_KINDS),
  state: z.enum(OUTBOX_STATES),
  /** The object: "Reply to Sam K.", "Opening hours", "Post", "Bulk change". */
  title: z.string(),
  /** A short second line: the post's opening words, "3 listings". */
  detail: z.string().nullable(),
  /** Null for a bulk row that spans more than one listing. */
  locationId: z.string().nullable(),
  /** The listing's name, or "4 listings" for a bulk row. */
  locationName: z.string(),
  /** Null in business mode (the home client), unfiled, or mixed clients. */
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  /** When the row entered its state, as far as the source records it. */
  at: z.string(),
  /** A scheduled retry, for `retrying`. */
  retryAt: z.string().nullable(),
  /** The existing screen that can act on it. The Outbox never sends. */
  href: z.string(),
})
export type OutboxItem = z.infer<typeof outboxItemSchema>

/**
 * What the Outbox reads, from either the route's query string or the
 * page's address. Unknown or malformed ids are refused (400), as the
 * reviews list does; an id the session cannot see reads as empty.
 */
export const outboxQuerySchema = z.object({
  clientId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  group: z.enum(OUTBOX_GROUP_KEYS).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(OUTBOX_MAX_PAGE_SIZE)
    .default(OUTBOX_PAGE_SIZE),
})
export type OutboxQuery = z.infer<typeof outboxQuerySchema>
/** The scope alone: what the counts read and the cache keys carry. */
export type OutboxScope = Pick<OutboxQuery, "clientId" | "locationId">

export const outboxResponseSchema = z.object({
  items: z.array(outboxItemSchema),
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
  /** A source hit its row cap; the oldest rows of that source are left out. */
  truncated: z.boolean(),
  /** Sources that could not be read: their rows are missing, not settled. */
  unavailable: z.array(z.enum(OUTBOX_KINDS)),
  /**
   * Kinds whose sending to Google is paused by an operator switch. Shown,
   * never acted on: paused rows stay where they are until it resumes.
   */
  paused: z.array(z.enum(OUTBOX_KINDS)),
  generatedAt: z.string(),
})
export type OutboxResponse = z.infer<typeof outboxResponseSchema>

export const outboxCountsSchema = z.object({
  ...(Object.fromEntries(
    OUTBOX_GROUP_KEYS.map((key) => [key, z.number().int().nonnegative()])
  ) as Record<OutboxGroupKey, z.ZodNumber>),
  /** Counts omit older rows beyond the source cap or an unreadable source. */
  partial: z.boolean(),
})
export type OutboxCounts = z.infer<typeof outboxCountsSchema>

/** Parses the route's query string; throws a ZodError on a bad value. */
export function decodeOutboxQuery(params: URLSearchParams): OutboxQuery {
  const read = (key: keyof typeof OUTBOX_QUERY_PARAMS) =>
    params.get(OUTBOX_QUERY_PARAMS[key]) || undefined
  return outboxQuerySchema.parse({
    clientId: read("clientId"),
    locationId: read("locationId"),
    group: read("group"),
    cursor: read("cursor"),
    limit: read("limit"),
  })
}

const UUID = z.uuid()
const GROUP = z.enum(OUTBOX_GROUP_KEYS)

/**
 * The page's own address (`/outbox?clientId=&locationId=&group=`), read
 * leniently: a value that does not parse is ignored rather than refused, so
 * a stale link still opens the Outbox.
 */
export function outboxViewFromSearch(params: {
  get(name: string): string | null
}): { clientId?: string; locationId?: string; group?: OutboxGroupKey } {
  const clientId = UUID.safeParse(params.get("clientId"))
  const locationId = UUID.safeParse(params.get("locationId"))
  const group = GROUP.safeParse(params.get("group"))
  return {
    clientId: clientId.success ? clientId.data : undefined,
    locationId: locationId.success ? locationId.data : undefined,
    group: group.success ? group.data : undefined,
  }
}
