import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import { listingHref } from "@/lib/listings/areas"
import {
  OUTBOX_KINDS,
  type OutboxCounts,
  type OutboxItem,
  type OutboxKind,
  type OutboxQuery,
  type OutboxResponse,
  type OutboxScope,
} from "@/lib/outbox/contract"
import {
  OUTBOX_GROUP_KEYS,
  outboxGroupOf,
  outboxGroupRank,
  type OutboxState,
} from "@/lib/outbox/vocabulary"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import {
  loadPauseSnapshot,
  scopesEnabled,
  type PauseScope,
} from "@/lib/server/pause-controls"
import { isManagerialRole, visibilityPredicate } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

/**
 * The Outbox read model (DIRECTION §7.1): every write that is neither just
 * a saved draft nor settled on Google more than a day ago, across the
 * replies, listing changes, posts and bulk listing changes this session may
 * see. Read-only, in the caller's tenant transaction.
 *
 * Each source keeps its own table and its own states; this file only reads
 * them and maps each row to one Outbox state (lib/outbox/vocabulary.ts,
 * whose words come from lib/editors/outcome.ts). DIRECTION §6.2 is the
 * mapping table:
 *
 * - Replies: `review.workflow_status`, the reply's `publish_status` and
 *   Google's `google_reply_state`, the latest publish or delete attempt
 *   and the latest approval decision (an approver's send-back).
 * - Listing changes: the `mutation_operation` receipts of the single-listing
 *   editors (hours, profile, menu, photos) and their change requests. An
 *   approved change request and the dispatch it ran show as one row, the
 *   request's. Bulk children's receipts are left to the bulk rows.
 * - Posts: `gbp_local_post.status` and Google's `google_state`, for posts
 *   sent or deleted from here (a post synced in from Google has no attempt),
 *   plus the approver's send-back (`post_approval_decision`).
 * - Bulk: one row per bulk operation and state, counting the operation's
 *   listings the session can see. Reply and post batches are left out:
 *   their replies and posts are rows of their own.
 *
 * Only confirmed state may read "On Google" (`live`): a reply Google shows
 * as APPROVED, a receipt `confirmed_applied` (readback verified), a post
 * Google shows as LIVE, a bulk listing `succeeded` + `confirmed`. Those rows
 * stay a day ("Confirmed today") and then leave. Everything sent or
 * accepted but unconfirmed is `sending` or `waiting`.
 *
 * Scope is the existing reads' scope: RLS through the tenant transaction
 * plus an explicit organisation filter, `visibilityPredicate` on every
 * row's listing (a member assigned to some listings sees only those; a
 * hidden listing never appears, not even in a bulk row's count), and the
 * optional `clientId` / `locationId` narrowing the reviews list applies (an
 * id the session cannot see reads as empty, never as an error).
 *
 * Each source runs in its own savepoint: one that fails is reported in
 * `unavailable` and the others still answer, so the page can say the list
 * is partial instead of showing a source's rows as settled.
 */

/** How long a settled problem or an unconfirmed send stays listed. */
const WINDOW = "30 days"
/** How long a confirmed write stays listed, as "Confirmed today". */
const CONFIRMED_WINDOW = "24 hours"
/** Rows read per source, newest first. */
export const SOURCE_LIMIT = 200

/** The single-listing editors' receipt surfaces, and where each is edited. */
const LISTING_SURFACES: Record<string, { title: string; segment: string }> = {
  hours: { title: "Opening hours", segment: "hours" },
  profile: { title: "Business profile", segment: "profile" },
  food_menus: { title: "Food menu", segment: "menu" },
  media: { title: "Photo", segment: "photos" },
}

/** Settled failures that only say a request was replaced or pulled. */
const RETIRED_REQUEST_CODES = [
  "approval_withdrawn",
  "approval_superseded",
  "approval_invalidated",
]

/** The bulk operations whose writes are not rows of another source. */
const BULK_TITLES: Record<string, string> = {
  regular_hours: "Opening hours",
  special_hours: "Special hours",
  more_hours: "More hours",
  attributes: "Attributes",
  place_action: "Booking links",
  business_info: "Business information",
  categories: "Categories",
  lodging: "Lodging details",
  food_menus: "Food menu",
  photos: "Photos",
  mixed: "Several areas",
}
/** Bulk children whose write is a reply or a post: shown as those rows. */
const BULK_ELSEWHERE = ["reviews", "posts"]

/**
 * The operator pause scopes each kind's sending answers to
 * (lib/server/pause-controls.ts). Listing changes span several surfaces;
 * any one paused is shown.
 */
const KIND_PAUSE_SCOPES: Record<OutboxKind, PauseScope[][]> = {
  reply: [["publish"]],
  listing_change: [
    ["publish", "profileWrites"],
    ["publish", "foodMenus"],
    ["publish", "media"],
  ],
  post: [["publish", "posts"]],
  bulk: [["publish", "bulk"]],
}

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

/** The `clientId` / `locationId` narrowing, on a query that joins `l`. */
function scopeFilter(sql: TransactionSql, scope: OutboxScope): Fragment {
  return sql`
    ${scope.clientId ? sql`and l.client_id = ${scope.clientId}` : sql``}
    ${scope.locationId ? sql`and l.id = ${scope.locationId}` : sql``}
  `
}

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
  attemptOperation: "publish" | "delete" | null
  failedDeletion: boolean
  nextAttemptAt: Date | null
  sentBackAt: Date | null
  at: Date
}

function pendingDeletionState(
  operation: string | null,
  status: string | null
): OutboxState | null {
  if (operation !== "delete") return null
  if (status === "started") return "sending"
  if (status === "retryable") return "retrying"
  if (status === "ambiguous") return "uncertain"
  return null
}

function replyDeletion(row: ReplyRow): OutboxState | null {
  if (row.failedDeletion) return "failed"
  return row.workflowStatus === "published"
    ? pendingDeletionState(row.attemptOperation, row.attemptStatus)
    : null
}

/** One reply row's Outbox state, or null when it does not belong there. */
export function replyState(row: ReplyRow): OutboxState | null {
  const deletion = replyDeletion(row)
  if (deletion) return deletion
  const publishStatus =
    row.attemptOperation === "delete" ? null : row.attemptStatus
  switch (row.workflowStatus) {
    case "awaiting_approval":
      return "approval"
    case "publish_requested":
      if (publishStatus === "retryable") return "retrying"
      if (publishStatus === "ambiguous") return "uncertain"
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
      // A timeout is never "Failed": nobody can tell whether Google took it.
      return publishStatus === "ambiguous" ? "uncertain" : "failed"
    case "drafted":
    case "verified":
      return row.sentBackAt ? "changes" : null
    default:
      return null
  }
}

/**
 * The Inbox queue that holds a review, from its workflow status
 * (lib/server/review-queues.ts). `drafted`, `verified` and `rejected` are in
 * the default queue, Needs reply, so they name none.
 */
const REPLY_QUEUE: Record<string, string> = {
  awaiting_approval: "approval",
  publish_requested: "publishing",
  failed: "failed",
  published: "done",
}

export function replyItem(row: ReplyRow): OutboxItem | null {
  const state = replyState(row)
  if (!state) return null
  const deletion = replyDeletion(row)
  const name = row.reviewerAnonymous
    ? "an anonymous reviewer"
    : row.reviewerName?.trim() || "a reviewer"
  const params = new URLSearchParams()
  const queue = REPLY_QUEUE[row.workflowStatus]
  if (queue) params.set("queue", queue)
  params.set("selected", row.reviewId)
  return {
    id: `reply:${row.reviewId}`,
    kind: "reply",
    state,
    ...(deletion === "failed" ? { operation: "delete" as const } : {}),
    title: deletion ? `Delete reply to ${name}` : `Reply to ${name}`,
    detail: row.starRating ? `${row.starRating}-star review` : null,
    ...placeOf(row),
    at: iso(state === "changes" && row.sentBackAt ? row.sentBackAt : row.at),
    retryAt:
      state === "retrying" && row.nextAttemptAt ? iso(row.nextAttemptAt) : null,
    href: `/inbox?${params}`,
  }
}

function readReplies(
  sql: TransactionSql,
  session: Session,
  scope: OutboxScope
) {
  const failedDeletion = sql`
    rr.publish_status not in ('deleted', 'not_published')
    and pa.operation = 'delete' and pa.status = 'failed'
    and r.workflow_status not in ('awaiting_approval', 'publish_requested')
    and (sent_back.created_at is null or sent_back.created_at <= pa.settled_at)
  `
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
      pa.operation as "attemptOperation",
      coalesce(${failedDeletion}, false) as "failedDeletion",
      pa.next_attempt_at as "nextAttemptAt",
      sent_back.created_at as "sentBackAt",
      case
        when ${failedDeletion} then pa.settled_at
        else greatest(r.updated_at, rr.updated_at, pa.started_at)
      end as at,
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
      -- The newest reply write: a retry bumps attempt_no on its own row, so a
      -- newer write (attempt 1) must still win on started_at.
      select a.status, a.operation, a.started_at, a.next_attempt_at,
        coalesce(a.finished_at, a.started_at) as settled_at
      from publish_attempt a
      where a.review_reply_id = rr.id
      order by a.started_at desc, a.id desc
      limit 1
    ) pa on true
    left join lateral (
      -- An approver's send-back returns the review to 'drafted'; it stays
      -- "Sent back" until its author writes a newer draft.
      select ad.created_at
      from approval_decision ad
      where ad.review_id = r.id
        and r.workflow_status in ('drafted', 'verified')
        and ad.decision = 'rejected'
        and ad.created_at = (
          select max(latest.created_at)
          from approval_decision latest
          where latest.review_id = r.id
        )
        and not exists (
          select 1 from draft d
          where d.review_id = r.id and d.created_at > ad.created_at
        )
      limit 1
    ) sent_back on true
    where r.organisation_id = ${session.organisationId}
      and r.provider_deleted_at is null
      and ${visibilityPredicate(sql, session, sql`r.location_id`)}
      ${scopeFilter(sql, scope)}
      and case
      -- Keep a refused deletion from its own settlement, even if the
      -- original publication has already left the Outbox.
      when ${failedDeletion} then pa.settled_at > now() - ${WINDOW}::interval
      else (
        r.workflow_status in ('awaiting_approval', 'publish_requested')
        or (
          r.workflow_status = 'published'
          and pa.operation = 'delete'
          and pa.status in ('started', 'retryable', 'ambiguous')
        )
        or (
          r.workflow_status in ('failed', 'rejected')
          and r.updated_at > now() - ${WINDOW}::interval
        )
        or (
          r.workflow_status in ('drafted', 'verified')
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
            -- coalesce: Google's state is null until it answers, and a null
            -- here would drop a reply that is still waiting.
            and coalesce(rr.google_reply_state, '') = 'APPROVED'
            and coalesce(rr.google_reply_updated_at, rr.updated_at)
              <= now() - ${CONFIRMED_WINDOW}::interval
          )
        )
      )
      end
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
      // A readback mismatch stays Failed (MISSION M07, DIRECTION D10 (b)).
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

export function changeItem(row: ChangeRow): OutboxItem | null {
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

function readChanges(
  sql: TransactionSql,
  session: Session,
  scope: OutboxScope
) {
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
      -- A bulk child's receipt belongs to its bulk row.
      and (
        o.approval_ref is null
        or o.approval_ref not like 'bulk_listing_operation:%'
      )
      and ${visibilityPredicate(sql, session, sql`o.location_id`)}
      ${scopeFilter(sql, scope)}
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
      -- coalesce: a null error_code would make the whole test null, and
      -- "not null" drops the row.
      and not (
        o.state = 'failed'
        and coalesce(o.error_code, '') in ${sql(RETIRED_REQUEST_CODES)}
      )
      -- An approved change request takes its dispatch's state, so the
      -- dispatch's own receipt would be the same change twice. Recovery
      -- rewrites a receipt wholesale, so the shared attempt is checked too.
      and not exists (
        select 1 from mutation_operation req
        where req.organisation_id = o.organisation_id
          and req.change_request is not null
          and req.id <> o.id
          and (
            req.receipt ->> 'dispatchIntentId' = o.intent_id::text
            or req.receipt ->> 'dispatchOperationId' = o.id::text
            or (
              o.change_request is null
              and req.attempt_table is not null
              and req.attempt_table = o.attempt_table
              and req.attempt_id = o.attempt_id
            )
          )
      )
      -- A later write to the same thing settles an earlier failure. Photos
      -- are told apart by their media item; the other areas are one thing
      -- per listing (a change request stores no target).
      and not (
        o.state in ('failed', 'rejected')
        and exists (
          select 1 from mutation_operation later
          where later.organisation_id = o.organisation_id
            and later.location_id = o.location_id
            and later.surface = o.surface
            and (
              o.surface <> 'media'
              or later.target_ref is not distinct from o.target_ref
            )
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
  attemptOperation: string | null
  attemptStatus: string | null
  failedDeletion: boolean
  lastErrorCode: string | null
  topicType: string
  summary: string
  sentBackAt: Date | null
  at: Date
}

function postDeletion(row: PostRow): OutboxState | null {
  if (row.failedDeletion) return "failed"
  return row.status === "published"
    ? pendingDeletionState(row.attemptOperation, row.attemptStatus)
    : null
}

export function postState(row: PostRow): OutboxState | null {
  const deletion = postDeletion(row)
  if (deletion) return deletion
  switch (row.status) {
    case "awaiting_approval":
      return "approval"
    case "draft":
      return row.sentBackAt ? "changes" : null
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

export function postItem(row: PostRow): OutboxItem | null {
  const state = postState(row)
  if (!state) return null
  const deletion = postDeletion(row)
  const summary = row.summary.replace(/\s+/g, " ").trim()
  return {
    id: `post:${row.id}`,
    kind: "post",
    state,
    ...(deletion === "failed" ? { operation: "delete" as const } : {}),
    title: deletion ? "Delete post" : (POST_TITLE[row.topicType] ?? "Post"),
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

function readPosts(sql: TransactionSql, session: Session, scope: OutboxScope) {
  const failedDeletion = sql`
    p.status not in ('deleted', 'awaiting_approval', 'publishing')
    and la.operation = 'delete' and la.status = 'failed'
    and (sent_back.created_at is null or sent_back.created_at <= la.at)
  `
  return sql<PostRow[]>`
    select
      p.id::text as id,
      p.status,
      p.google_state as "googleState",
      la.operation as "attemptOperation",
      la.status as "attemptStatus",
      coalesce(${failedDeletion}, false) as "failedDeletion",
      p.last_error_code as "lastErrorCode",
      p.topic_type as "topicType",
      p.summary,
      sent_back.created_at as "sentBackAt",
      case
        when ${failedDeletion} then la.at
        when p.status = 'published' and p.google_state = 'LIVE'
          and not coalesce(la.operation = 'delete' and la.status in ('started', 'ambiguous'), false)
          then coalesce(p.google_live_observed_at, la.at, p.updated_at)
        else coalesce(sent_back.created_at, la.at, p.updated_at)
      end as at,
      l.id::text as "locationId",
      l.name as "locationName",
      c.id::text as "clientId",
      c.name as "clientName",
      c.is_home as "clientIsHome"
    from gbp_local_post p
    join location l on l.id = p.location_id
    left join client c on c.id = l.client_id
    left join lateral (
      -- The newest send from here. A post synced in from Google has none,
      -- and a sync rewrites updated_at, so the send's own time is used.
      select a.operation, a.status, coalesce(a.finished_at, a.started_at) as at
      from gbp_local_post_attempt a
      where a.organisation_id = p.organisation_id and a.post_id = p.id
      order by a.started_at desc, a.id desc
      limit 1
    ) la on true
    left join lateral (
      -- An approver's send-back returns the post to 'draft'; it stays
      -- "Sent back" until the post is edited (a new content revision).
      select d.created_at
      from post_approval_decision d
      where d.post_id = p.id
        and p.status = 'draft'
        and d.decision = 'rejected'
        and d.content_revision = p.content_revision
        and d.created_at = (
          select max(latest.created_at)
          from post_approval_decision latest
          where latest.post_id = p.id
        )
      limit 1
    ) sent_back on true
    where p.organisation_id = ${session.organisationId}
      and ${visibilityPredicate(sql, session, sql`p.location_id`)}
      ${scopeFilter(sql, scope)}
      and case
      when ${failedDeletion} then la.at > now() - ${WINDOW}::interval
      else (
        p.status = 'awaiting_approval'
        or (
          p.status = 'published'
          and la.operation = 'delete'
          and la.status in ('started', 'ambiguous')
        )
        or (
          p.status = 'draft'
          and sent_back.created_at > now() - ${WINDOW}::interval
        )
        or (p.status in ('publishing', 'ambiguous') and la.at is not null)
        or (
          p.status = 'failed'
          and la.at > now() - ${WINDOW}::interval
        )
        or (
          p.status = 'published'
          and la.at is not null
          and case when p.google_state = 'LIVE'
            then coalesce(p.google_live_observed_at, la.at) > now() - ${CONFIRMED_WINDOW}::interval
            else la.at > now() - ${WINDOW}::interval
          end
        )
      )
      end
    order by at desc
    limit ${SOURCE_LIMIT + 1}
  `
}

// ---------------------------------------------------------------------------
// Bulk listing changes
// ---------------------------------------------------------------------------

export type BulkRow = {
  operationId: string
  operation: string
  state: OutboxState
  /** Visible listings in this state. */
  listings: number
  /** Visible listings in the whole operation. */
  total: number
  /** The one listing, when every row in this state is the same listing. */
  locationId: string | null
  locationName: string | null
  clientId: string | null
  clientName: string | null
  clientIsHome: boolean | null
  retryAt: Date | null
  at: Date
}

const listingsWord = (n: number) => (n === 1 ? "1 listing" : `${n} listings`)

export function bulkItem(row: BulkRow): OutboxItem {
  const area = BULK_TITLES[row.operation] ?? "Listings"
  const place =
    row.locationId && row.locationName
      ? {
          locationId: row.locationId,
          locationName: row.locationName,
        }
      : { locationId: null, locationName: listingsWord(row.listings) }
  const client = row.clientId && !row.clientIsHome
  return {
    id: `bulk:${row.operationId}:${row.state}`,
    kind: "bulk",
    state: row.state,
    title: `Bulk change: ${area}`,
    detail:
      row.listings === row.total
        ? listingsWord(row.total)
        : `${row.listings} of ${listingsWord(row.total)}`,
    ...place,
    clientId: client ? row.clientId : null,
    clientName: client ? row.clientName : null,
    at: iso(row.at),
    retryAt: row.state === "retrying" && row.retryAt ? iso(row.retryAt) : null,
    href: `/listings/bulk/${row.operationId}`,
  }
}

function readBulk(sql: TransactionSql, session: Session, scope: OutboxScope) {
  // lib/server/bulk-listings.ts effectiveStatus / windowClosed: a closed
  // window reads expired before the sweep records it, so it never lists.
  return sql<BulkRow[]>`
    with child as (
      select
        o.id as operation_id,
        o.operation,
        c.location_id,
        c.next_attempt_at,
        case
          when o.status = 'previewed' and o.preview_expires_at > now()
            then 'approval'
          when o.status = 'approved'
            and coalesce(o.dispatch_expires_at, now()) > now()
            then 'approved'
          when o.status in ('previewed', 'approved') then null
          when c.status = 'queued'
            and o.status = 'running'
            and coalesce(o.dispatch_expires_at, now()) <= now() then null
          when c.status = 'queued'
            and c.result_code = 'google_rate_limited'
            and c.next_attempt_at > now() then 'retrying'
          when c.status in ('queued', 'running') then 'sending'
          when c.status = 'succeeded' and c.confirmation_state = 'confirmed'
            then 'live'
          when c.status = 'succeeded' and c.confirmation_state = 'unresolved'
            then 'uncertain'
          when c.status = 'succeeded' then 'waiting'
          when c.status = 'ambiguous' then 'uncertain'
          when c.status = 'failed' then 'failed'
          else null
        end as state,
        coalesce(c.finished_at, c.started_at, o.updated_at) as at
      from bulk_listing_operation o
      join bulk_listing_child c on c.operation_id = o.id
      join location l on l.id = c.location_id
      where o.organisation_id = ${session.organisationId}
        and c.eligibility = 'eligible'
        and c.resource_key not in ${sql(BULK_ELSEWHERE)}
        and o.status not in ('cancelled', 'expired')
        -- The bulk list's own rule: managers see every batch, others the
        -- batches they asked for (lib/server/bulk-listings.ts).
        and ${
          isManagerialRole(session.role)
            ? sql`true`
            : sql`o.requested_by = ${session.userId}`
        }
        and ${visibilityPredicate(sql, session, sql`c.location_id`)}
        ${scopeFilter(sql, scope)}
    ),
    totals as (
      select operation_id, count(distinct location_id)::int as total
      from child
      group by operation_id
    ),
    grouped as (
      select
        child.operation_id,
        child.operation,
        child.state,
        count(distinct child.location_id)::int as listings,
        case when count(distinct child.location_id) = 1
          then min(child.location_id::text) end as location_id,
        case when count(distinct coalesce(l.client_id::text, '')) = 1
          then min(l.client_id::text) end as client_id,
        min(child.next_attempt_at) filter (where child.state = 'retrying')
          as retry_at,
        max(child.at) as at
      from child
      join location l on l.id = child.location_id
      where child.state is not null
      group by child.operation_id, child.operation, child.state
    )
    select
      g.operation_id::text as "operationId",
      g.operation,
      g.state,
      g.listings,
      t.total,
      g.location_id as "locationId",
      one.name as "locationName",
      g.client_id as "clientId",
      c.name as "clientName",
      c.is_home as "clientIsHome",
      g.retry_at as "retryAt",
      g.at
    from grouped g
    join totals t on t.operation_id = g.operation_id
    left join location one on one.id = g.location_id::uuid
    left join client c on c.id = g.client_id::uuid
    where g.state in ('approval', 'approved', 'sending', 'retrying')
      or (g.state = 'live' and g.at > now() - ${CONFIRMED_WINDOW}::interval)
      or (
        g.state in ('waiting', 'uncertain', 'failed')
        and g.at > now() - ${WINDOW}::interval
      )
    order by g.at desc
    limit ${SOURCE_LIMIT + 1}
  `
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

type CursorKey = { rank: number; at: string; id: string }

const keyOf = (item: OutboxItem): CursorKey => ({
  rank: outboxGroupRank(outboxGroupOf(item.state)),
  at: item.at,
  id: item.id,
})

function compareKeys(a: CursorKey, b: CursorKey): number {
  if (a.rank !== b.rank) return a.rank - b.rank
  if (a.at !== b.at) return a.at < b.at ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The list order: group (DIRECTION §7.1 reading order), then newest first,
 * then id, so every row has one place and a cursor is exact.
 */
export function compareItems(a: OutboxItem, b: OutboxItem): number {
  return compareKeys(keyOf(a), keyOf(b))
}

export function encodeCursor(item: OutboxItem): string {
  return Buffer.from(JSON.stringify(keyOf(item))).toString("base64url")
}

export function decodeCursor(cursor: string): CursorKey {
  try {
    const key = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      Number.isInteger(key?.rank) &&
      typeof key.at === "string" &&
      typeof key.id === "string"
    )
      return { rank: key.rank, at: key.at, id: key.id }
  } catch {
    // Falls through to the refusal below.
  }
  throw new ApiError(400, "invalid_cursor", "The page cursor is not valid.")
}

/** One page of `items` (already sorted by compareItems) after `cursor`. */
export function pageOf(
  items: readonly OutboxItem[],
  query: Pick<OutboxQuery, "cursor" | "limit">
): { items: OutboxItem[]; nextCursor: string | null } {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const rest = cursor
    ? items.filter((item) => compareKeys(keyOf(item), cursor) > 0)
    : items
  const page = rest.slice(0, query.limit)
  const last = page.at(-1)
  return {
    items: page,
    nextCursor: rest.length > query.limit && last ? encodeCursor(last) : null,
  }
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

type Sources = {
  items: OutboxItem[]
  truncated: boolean
  unavailable: OutboxKind[]
}

/**
 * Runs one source in a savepoint, so its failure leaves the transaction
 * usable for the others. Null means the source could not be read.
 */
async function readSource<Row>(
  sql: TransactionSql,
  kind: OutboxKind,
  read: (sp: TransactionSql) => Promise<Row[]>
): Promise<Row[] | null> {
  try {
    return (await sql.savepoint((sp) => read(sp))) as Row[]
  } catch (error) {
    log.error("outbox.source_failed", {
      kind,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function readSources(
  sql: TransactionSql,
  session: Session,
  scope: OutboxScope
): Promise<Sources> {
  // The bulk rows follow the organisation's bulk feature, as the bulk
  // pages do; an unreadable flag is an unavailable source, not "off".
  const bulkFeature = await readSource(sql, "bulk", async (sp) => [
    await isOrgFeatureEnabled(sp, session.organisationId, "bulk_actions"),
  ])
  // One transaction runs one statement at a time; these run in turn.
  const replies = await readSource(sql, "reply", (sp) =>
    readReplies(sp, session, scope)
  )
  const changes = await readSource(sql, "listing_change", (sp) =>
    readChanges(sp, session, scope)
  )
  const posts = await readSource(sql, "post", (sp) =>
    readPosts(sp, session, scope)
  )
  const bulk =
    bulkFeature === null
      ? null
      : bulkFeature[0]
        ? await readSource(sql, "bulk", (sp) => readBulk(sp, session, scope))
        : []

  const results: [OutboxKind, unknown[] | null][] = [
    ["reply", replies],
    ["listing_change", changes],
    ["post", posts],
    ["bulk", bulk],
  ]
  const unavailable = results
    .filter(([, rows]) => rows === null)
    .map(([kind]) => kind)
  const truncated = results.some(
    ([, rows]) => rows !== null && rows.length > SOURCE_LIMIT
  )
  const items = [
    ...(replies ?? []).slice(0, SOURCE_LIMIT).map(replyItem),
    ...(changes ?? []).slice(0, SOURCE_LIMIT).map(changeItem),
    ...(posts ?? []).slice(0, SOURCE_LIMIT).map(postItem),
    ...(bulk ?? []).slice(0, SOURCE_LIMIT).map(bulkItem),
  ]
    .filter((item): item is OutboxItem => item !== null)
    .sort(compareItems)
  return { items, truncated, unavailable }
}

/**
 * The kinds whose sending an operator switch has paused. Display only; an
 * unreadable pause table is not reported as paused here (the senders
 * themselves fail closed on it).
 */
export async function pausedKinds(): Promise<OutboxKind[]> {
  try {
    const env = getServerEnv()
    const snapshot = await loadPauseSnapshot()
    return OUTBOX_KINDS.filter((kind) =>
      KIND_PAUSE_SCOPES[kind].some(
        (scopes) => !scopesEnabled(env, snapshot, scopes, "open")
      )
    )
  } catch {
    return []
  }
}

const NO_OUTBOX = (generatedAt: string): OutboxResponse => ({
  items: [],
  nextCursor: null,
  truncated: false,
  unavailable: [],
  paused: [],
  generatedAt,
})

/**
 * One page of this session's Outbox and the counts for its scope, from one
 * read. Viewers have no Outbox: the routes refuse them before this runs,
 * and it answers them with nothing as a second line.
 */
export async function readOutboxPage(
  sql: TransactionSql,
  session: Session,
  query: OutboxQuery,
  now: Date = new Date()
): Promise<{ page: OutboxResponse; counts: OutboxCounts }> {
  const generatedAt = now.toISOString()
  if (session.role === "viewer") {
    return { page: NO_OUTBOX(generatedAt), counts: countOutbox([]) }
  }
  // A bad cursor is refused before anything is read.
  if (query.cursor) decodeCursor(query.cursor)
  const [sources, paused] = await Promise.all([
    readSources(sql, session, query),
    pausedKinds(),
  ])
  const rows = query.group
    ? sources.items.filter((item) => outboxGroupOf(item.state) === query.group)
    : sources.items
  return {
    page: {
      ...pageOf(rows, query),
      truncated: sources.truncated,
      unavailable: sources.unavailable,
      paused,
      generatedAt,
    },
    counts: countOutbox(
      sources.items,
      sources.truncated || sources.unavailable.length > 0
    ),
  }
}

export async function readOutbox(
  sql: TransactionSql,
  session: Session,
  query: OutboxQuery,
  now: Date = new Date()
): Promise<OutboxResponse> {
  return (await readOutboxPage(sql, session, query, now)).page
}

/** How many rows each group holds. */
export function countOutbox(
  items: readonly OutboxItem[],
  partial = false
): OutboxCounts {
  const counts = {
    ...(Object.fromEntries(OUTBOX_GROUP_KEYS.map((key) => [key, 0])) as Record<
      (typeof OUTBOX_GROUP_KEYS)[number],
      number
    >),
    partial,
  }
  for (const item of items) counts[outboxGroupOf(item.state)] += 1
  return counts
}

export async function readOutboxCounts(
  sql: TransactionSql,
  session: Session,
  scope: OutboxScope
): Promise<OutboxCounts> {
  if (session.role === "viewer") return countOutbox([])
  const sources = await readSources(sql, session, scope)
  return countOutbox(
    sources.items,
    sources.truncated || sources.unavailable.length > 0
  )
}
