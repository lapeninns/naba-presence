/**
 * `GET /api/outbox` and `GET /api/outbox/counts`: the Outbox read model
 * (DIRECTION §7.1). Read-only; every row is one write on its way to Google
 * or back from it, from the tables that already hold it (replies, listing
 * change receipts, posts). Client-safe.
 */
import { z } from "zod"

import { OUTBOX_GROUP_KEYS, OUTBOX_STATES } from "./vocabulary"

export const OUTBOX_KINDS = ["reply", "listing_change", "post"] as const
export type OutboxKind = (typeof OUTBOX_KINDS)[number]

export const outboxItemSchema = z.object({
  /** `<kind>:<source id>`: unique across kinds. */
  id: z.string(),
  kind: z.enum(OUTBOX_KINDS),
  state: z.enum(OUTBOX_STATES),
  /** The object: "Reply to Sam K.", "Opening hours", "Post". */
  title: z.string(),
  /** A short second line: the post's opening words, a field list. */
  detail: z.string().nullable(),
  locationId: z.string(),
  locationName: z.string(),
  /** Null in business mode (the home client) and for unfiled listings. */
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  /** When the row entered its state, as far as the source records it. */
  at: z.string(),
  /** A scheduled retry, for `retrying`. */
  retryAt: z.string().nullable(),
  /** The existing screen that can act on it. */
  href: z.string(),
})
export type OutboxItem = z.infer<typeof outboxItemSchema>

export const outboxResponseSchema = z.object({
  items: z.array(outboxItemSchema),
  /** A source hit its row cap; the oldest rows of that source are left out. */
  truncated: z.boolean(),
  generatedAt: z.string(),
})
export type OutboxResponse = z.infer<typeof outboxResponseSchema>

export const outboxCountsSchema = z.object(
  Object.fromEntries(
    OUTBOX_GROUP_KEYS.map((key) => [key, z.number().int().nonnegative()])
  ) as Record<(typeof OUTBOX_GROUP_KEYS)[number], z.ZodNumber>
)
export type OutboxCounts = z.infer<typeof outboxCountsSchema>
