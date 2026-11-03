import "server-only"

import type { TransactionSql } from "postgres"

import { listingHref } from "@/lib/listings/areas"
import { outboxKeys } from "@/lib/outbox/keys"
import {
  outboxCountsSchema,
  outboxResponseSchema,
  type OutboxCounts,
  type OutboxItem,
  type OutboxResponse,
} from "@/lib/outbox/contract"
import {
  OUTBOX_GROUP_KEYS,
  outboxGroupOf,
  type OutboxState,
} from "@/lib/outbox/vocabulary"
import { withTenant } from "@/lib/server/db"
import { visibilityPredicate } from "@/lib/server/permissions"
import { throughWire, type PrefetchEntry } from "@/lib/server/prefetch"
import type { Session } from "@/lib/server/session"

/**
 * The Outbox read model (DIRECTION §7.1): every write that is neither just
 * a saved draft nor settled on Google, across the replies, listing changes
 * and posts this session may see. Read-only, one tenant transaction.
 *
 * Each source keeps its own table and its own states; this file only reads
 * them and maps each row to one Outbox state (lib/outbox/vocabulary.ts):
 *
 * - Replies: `review.workflow_status`, the reply's `publish_status` and
 *   Google's own `google_reply_state`, the latest publish attempt (a
 *   scheduled retry, an ambiguous answer) and the latest approval decision
 *   (an approver's send-back).
 * - Listing changes: the `mutation_operation` receipts of the listing
 *   editors' surfaces (LISTING_SURFACES). An approved change request and
 *   the dispatch it ran show as one row, the request's.
 * - Posts: `gbp_local_post.status` and Google's `google_state`.
 *
 * Bulk changes are not read yet: one bulk operation spans many target
 * listings, and its row needs a per-target visibility rule of its own.
 *
 * Only confirmed state may read "On Google" (`live`): a reply Google shows
 * as APPROVED, a receipt `confirmed_applied` (readback verified), a post
 * Google shows as LIVE. Those rows appear for a day ("Confirmed today") and
 * then leave. Everything sent or accepted but unconfirmed is `sending` or
 * `waiting`.
 *
 * Every source query is narrowed by `visibilityPredicate` on its location,
 * so a member assigned to some listings sees only those, and RLS (the tenant
 * transaction) plus an explicit organisation filter keep other tenants out.
 */

/** How long a settled problem or an unconfirmed send stays listed. */
const WINDOW = "30 days"
/** How long a confirmed write stays listed, as "Confirmed today". */
const CONFIRMED_WINDOW = "24 hours"
/** Rows read per source, newest first. */
const SOURCE_LIMIT = 200

/** The listing editors' receipt surfaces, and where each is edited. */
const LISTING_SURFACES: Record<string, { title: string; segment: string }> = {
  hours: { title: "Opening hours", segment: "hours" },
  profile: { title: "Business profile", segment: "profile" },
  business_info: { title: "Business information", segment: "profile" },
  business_information: { title: "Business information", segment: "profile" },
  attributes: { title: "Attributes", segment: "profile" },
  business_attributes: { title: "Attributes", segment: "profile" },
  lodging: { title: "Lodging details", segment: "profile" },
  food_menus: { title: "Food menu", segment: "menu" },
  media: { title: "Photo", segment: "photos" },
  place_actions: { title: "Booking links", segment: "booking" },
}

/** Settled failures that only say a request was replaced or pulled. */
const RETIRED_REQUEST_CODES = [
  "approval_withdrawn",
  "approval_superseded",
  "approval_invalidated",
]

type Place = {
  locationId: string
  locationName: string
  clientId: string | null
  clientName: string | null
  clientIsHome: boolean | null
}

function placeOf(row: Place) {
  // A business's home client is the business itself, never "a client".
  const client = row.clientId && !row.clientIsHome
  return {
    locationId: row.locationId,
    locationName: row.locationName,
    clientId: client ? row.clientId : null,
    clientName: client ? row.clientName : null,
  }
}

const iso = (value: Date | string) => new Date(value).toISOString()

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

export type ReplyRow = Place & {
  reviewId: string
  workflowStatus: string
  reviewerName: string | null
  reviewerAnonymous: boolean
  starRating: number | null
  publishStatus: string | null
  googleReplyState: string | null
  attemptStatus: string | null
  nextAttemptAt: Date | null
  sentBackAt: Date | null
  at: Date
}

/** One reply row's Outbox state, or null when it does not belong there. */
export function replyState(row: ReplyRow): OutboxState | null {
  switch (row.workflowStatus) {
    case "awaiting_approval":
      return "approval"
    case "publish_requested":
      if (row.attemptStatus === "retryable") return "retrying"
      if (row.attemptStatus === "ambiguous") return "uncertain"
      return "sending"
    case "published":
      if (row.googleReplyState === "REJECTED") return "rejected"
      if (
        row.publishStatus === "published" &&
        row.googleReplyState === "APPROVED"
      )
        return "live"
      return "waiting"
    case "rejected":
      return "rejected"
    case "failed":
      return row.attemptStatus === "ambiguous" ? "uncertain" : "failed"
    case "drafted":
      return row.sentBackAt ? "changes" : null
    default:
      return null
  }
}

const REPLY_QUEUE: Partial<Record<OutboxState, string>> = {
  approval: "approval",
  sending: "publishing",
  retrying: "publishing",
  uncertain: "publishing",
  failed: "failed",
  waiting: "done",
  live: "done",
}

function replyItem(row: ReplyRow): OutboxItem | null {
  const state = replyState(row)
  if (!state) return null
  const name = row.reviewerAnonymous
    ? "an anonymous reviewer"
    : row.reviewerName?.trim() || "a reviewer"
  const params = new URLSearchParams()
  const queue = REPLY_QUEUE[state]
  if (queue) params.set("queue", queue)
  params.set("selected", row.reviewId)
  return {
    id: `reply:${row.reviewId}`,
    kind: "reply",
    state,
    title: `Reply to ${name}`,
    detail: row.starRating ? `${row.starRating}-star review` : null,
    ...placeOf(row),
    at: iso(state === "changes" && row.sentBackAt ? row.sentBackAt : row.at),
    retryAt:
      state === "retrying" && row.nextAttemptAt ? iso(row.nextAttemptAt) : null,
    href: `/inbox?${params}`,
  }
}

async function readReplies(sql: TransactionSql, session: Session) {
  return sql<ReplyRow[]>`
    select
      r.id::text as "reviewId",
      r.workflow_status as "workflowStatus",
      r.reviewer_display_name as "reviewerName",
      r.reviewer_is_anonymous as "reviewerAnonymous",
      r.star_rating as "starRating",
      rr.publish_status as "publishStatus",
      rr.google_reply_state as "googleReplyState",
      pa.status as "attemptStatus",
      pa.next_attempt_at as "nextAttemptAt",
      sent_back.created_at as "sentBackAt",
      greatest(r.updated_at, coalesce(rr.updated_at, r.updated_at)) as at,
      l.id::text as "locationId",
      l.name as "locationName",
      c.id::text as "clientId",
      c.name as "clientName",
      c.is_home as "clientIsHome"
    from review r
    join location l on l.id = r.location_id
    left join client c on c.id = l.client_id
    left join review_reply rr on rr.review_id = r.id
    left join lateral (
      select a.status, a.next_attempt_at
      from publish_attempt a
      where a.review_reply_id = rr.id
      order by a.attempt_no desc, a.started_at desc
      limit 1
    ) pa on true
    left join lateral (
      -- An approver's send-back returns the review to 'drafted'; it stays
      -- "Sent back" until its author writes a newer draft.
      select ad.created_at
      from approval_decision ad
      where ad.review_id = r.id
        and r.workflow_status = 'drafted'
      order by ad.created_at desc
      limit 1
    ) last_decision on true
    left join lateral (
      select ad.created_at
      from approval_decision ad
      where ad.review_id = r.id
        and ad.created_at = last_decision.created_at
        and ad.decision = 'rejected'
        and not exists (
          select 1 from draft d
          where d.review_id = r.id and d.created_at > ad.created_at
        )
      limit 1
    ) sent_back on true
    where r.organisation_id = ${session.organisationId}
      and ${visibilityPredicate(sql, session, sql`r.location_id`)}
      and (
        r.workflow_status in ('awaiting_approval', 'publish_requested')
        or (
          r.workflow_status in ('failed', 'rejected')
          and r.updated_at > now() - ${WINDOW}::interval
        )
        or (
          r.workflow_status = 'drafted'
          and sent_back.created_at > now() - ${WINDOW}::interval
        )
        or (
          -- Sent from here (an imported reply has no publisher), and
          -- either unconfirmed or confirmed in the last day.
          r.workflow_status = 'published'
          and rr.published_by is not null
          and rr.updated_at > now() - ${WINDOW}::interval
          and not (
            rr.publish_status = 'published'
            and rr.google_reply_state = 'APPROVED'
            and coalesce(rr.google_reply_updated_at, rr.updated_at)
              <= now() - ${CONFIRMED_WINDOW}::interval
          )
        )
      )
    order by at desc
    limit ${SOURCE_LIMIT + 1}
  `
}

// ---------------------------------------------------------------------------
// Listing changes
// ---------------------------------------------------------------------------

export type ChangeRow = Place & {
  id: string
  surface: string
  action: string
  state: string
  errorCode: string | null
  isRequest: boolean
  at: Date
}

export function changeState(row: ChangeRow): OutboxState | null {
  switch (row.state) {
    case "awaiting_approval":
      return "approval"
    case "sent":
      return "sending"
    case "awaiting_confirmation":
      return "waiting"
    case "uncertain":
      return "uncertain"
    case "rejected":
      return "rejected"
    case "failed":
      if (row.errorCode === "approval_rejected") return "changes"
      if (RETIRED_REQUEST_CODES.includes(row.errorCode ?? "")) return null
      return "failed"
    case "confirmed_applied":
      return "live"
    default:
      return null
  }
}

function changeTitle(row: ChangeRow): string {
  if (row.surface === "media") {
    if (row.action === "create") return "New photo"
    if (row.action === "delete") return "Photo removal"
    return "Photo details"
  }
  return LISTING_SURFACES[row.surface]?.title ?? "Listing change"
}

function changeItem(row: ChangeRow): OutboxItem | null {
  const state = changeState(row)
  if (!state) return null
  const segment = LISTING_SURFACES[row.surface]?.segment
  return {
    id: `listing_change:${row.id}`,
    kind: "listing_change",
    state,
    title: changeTitle(row),
    detail: row.isRequest ? "Change request" : null,
    ...placeOf(row),
    at: iso(row.at),
    retryAt: null,
    href: listingHref(row.locationId, segment),
  }
}

async function readChanges(sql: TransactionSql, session: Session) {
  return sql<ChangeRow[]>`
    select
      o.id::text as id,
      o.surface,
      o.action,
      o.state,
      o.error_code as "errorCode",
      o.change_request is not null as "isRequest",
      o.updated_at as at,
      l.id::text as "locationId",
      l.name as "locationName",
      c.id::text as "clientId",
      c.name as "clientName",
      c.is_home as "clientIsHome"
    from mutation_operation o
    join location l on l.id = o.location_id
    left join client c on c.id = l.client_id
    where o.organisation_id = ${session.organisationId}
      and o.surface in ${sql(Object.keys(LISTING_SURFACES))}
      and ${visibilityPredicate(sql, session, sql`o.location_id`)}
      and (
        o.state in ('awaiting_approval', 'sent', 'uncertain')
        or (
          o.state in ('awaiting_confirmation', 'rejected', 'failed')
          and o.updated_at > now() - ${WINDOW}::interval
        )
        or (
          o.state = 'confirmed_applied'
          and o.updated_at > now() - ${CONFIRMED_WINDOW}::interval
        )
      )
      and not (
        o.state = 'failed'
        and o.error_code in ${sql(RETIRED_REQUEST_CODES)}
      )
      -- An approved change request takes its dispatch's state, so the
      -- dispatch's own receipt would be the same change twice.
      and not exists (
        select 1 from mutation_operation req
        where req.organisation_id = o.organisation_id
          and req.change_request is not null
          and req.receipt ->> 'dispatchIntentId' = o.intent_id::text
      )
      -- A later write to the same thing settles an earlier failure.
      and not (
        o.state in ('failed', 'rejected')
        and exists (
          select 1 from mutation_operation later
          where later.organisation_id = o.organisation_id
            and later.location_id = o.location_id
            and later.surface = o.surface
            and later.target_ref is not distinct from o.target_ref
            and later.created_at > o.created_at
            and later.state <> 'saved_locally'
        )
      )
    order by o.updated_at desc
    limit ${SOURCE_LIMIT + 1}
  `
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export type PostRow = Place & {
  id: string
  status: string
  googleState: string | null
  lastErrorCode: string | null
  topicType: string
  summary: string
  at: Date
}

export function postState(row: PostRow): OutboxState | null {
  switch (row.status) {
    case "awaiting_approval":
      return "approval"
    case "publishing":
      return "sending"
    case "published":
      if (row.googleState === "LIVE") return "live"
      if (row.googleState === "REJECTED") return "rejected"
      return "waiting"
    case "failed":
      return row.googleState === "REJECTED" ||
        row.lastErrorCode === "google_post_rejected"
        ? "rejected"
        : "failed"
    case "ambiguous":
      return "uncertain"
    default:
      return null
  }
}

const POST_TITLE: Record<string, string> = {
  EVENT: "Event post",
  OFFER: "Offer post",
}

function postItem(row: PostRow): OutboxItem | null {
  const state = postState(row)
  if (!state) return null
  const summary = row.summary.replace(/\s+/g, " ").trim()
  return {
    id: `post:${row.id}`,
    kind: "post",
    state,
    title: POST_TITLE[row.topicType] ?? "Post",
    detail: summary
      ? summary.length > 80
        ? `${summary.slice(0, 79).trimEnd()}…`
        : summary
      : null,
    ...placeOf(row),
    at: iso(row.at),
    retryAt: null,
    href: listingHref(row.locationId, "posts"),
  }
}

async function readPosts(sql: TransactionSql, session: Session) {
  return sql<PostRow[]>`
    select
      p.id::text as id,
      p.status,
      p.google_state as "googleState",
      p.last_error_code as "lastErrorCode",
      p.topic_type as "topicType",
      p.summary,
      p.updated_at as at,
      l.id::text as "locationId",
      l.name as "locationName",
      c.id::text as "clientId",
      c.name as "clientName",
      c.is_home as "clientIsHome"
    from gbp_local_post p
    join location l on l.id = p.location_id
    left join client c on c.id = l.client_id
    where p.organisation_id = ${session.organisationId}
      and ${visibilityPredicate(sql, session, sql`p.location_id`)}
      and (
        p.status in ('awaiting_approval', 'publishing', 'ambiguous')
        or (
          p.status = 'failed'
          and p.updated_at > now() - ${WINDOW}::interval
        )
        or (
          p.status = 'published'
          and p.updated_at > now() - ${WINDOW}::interval
          and not (
            p.google_state = 'LIVE'
            and p.updated_at <= now() - ${CONFIRMED_WINDOW}::interval
          )
        )
      )
    order by p.updated_at desc
    limit ${SOURCE_LIMIT + 1}
  `
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * Everything in this session's Outbox, newest first. Runs in the caller's
 * tenant transaction. Viewers have no Outbox: the routes refuse them before
 * this runs, and it answers them with nothing as a second line.
 */
export async function readOutbox(
  sql: TransactionSql,
  session: Session,
  now: Date = new Date()
): Promise<OutboxResponse> {
  if (session.role === "viewer") {
    return { items: [], truncated: false, generatedAt: now.toISOString() }
  }
  const replies = await readReplies(sql, session)
  const changes = await readChanges(sql, session)
  const posts = await readPosts(sql, session)
  const truncated = [replies, changes, posts].some(
    (rows) => rows.length > SOURCE_LIMIT
  )
  const items = [
    ...replies.slice(0, SOURCE_LIMIT).map(replyItem),
    ...changes.slice(0, SOURCE_LIMIT).map(changeItem),
    ...posts.slice(0, SOURCE_LIMIT).map(postItem),
  ]
    .filter((item): item is OutboxItem => item !== null)
    .sort((a, b) => b.at.localeCompare(a.at))
  return { items, truncated, generatedAt: now.toISOString() }
}

/** How many rows each group holds. */
export function countOutbox(items: readonly OutboxItem[]): OutboxCounts {
  const counts = Object.fromEntries(
    OUTBOX_GROUP_KEYS.map((key) => [key, 0])
  ) as OutboxCounts
  for (const item of items) counts[outboxGroupOf(item.state)] += 1
  return counts
}

export async function readOutboxCounts(
  sql: TransactionSql,
  session: Session
): Promise<OutboxCounts> {
  return countOutbox((await readOutbox(sql, session)).items)
}

/** /outbox: the list and its counts in the first HTML. Not for viewers. */
export function outboxPrefetch(): (session: Session) => PrefetchEntry[] {
  return (session) => {
    if (session.role === "viewer") return []
    const list = withTenant(session.organisationId, (sql) =>
      readOutbox(sql, session)
    )
    return [
      {
        queryKey: outboxKeys.list,
        load: async () => throughWire(outboxResponseSchema, await list),
      },
      {
        queryKey: outboxKeys.counts,
        load: async () =>
          throughWire(outboxCountsSchema, countOutbox((await list).items)),
      },
    ]
  }
}
