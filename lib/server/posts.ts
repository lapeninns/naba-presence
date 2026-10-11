import "server-only"

import type { Fragment, TransactionSql } from "postgres"
import { z } from "zod"

import {
  DEFAULT_POSTS_PAGE_SIZE,
  decodePostsCursor,
  encodePostsCursor,
  localPostInputSchema,
  MAX_POSTS_PAGE_SIZE,
  type LocalPostInput,
  type PostCounts,
  type PostListFilter,
  type PostRow,
  type PostsListQuery,
} from "@/lib/contracts/location-posts"
import {
  localPostMatches,
  localPostMismatches,
} from "@/lib/domain/readback/posts"
import {
  googlePostStateOutcome,
  localPostOutcome,
} from "@/lib/domain/post-outcome"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { jsonColumn, jsonColumnOrNull, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  idempotencyKey,
  loadLinkedLocation,
  requireGbpWrite,
  requirePublishGrant,
  runGbpWrite,
  type AttemptRow,
  type AttemptStore,
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import {
  createGoogleLocalPost,
  deleteGoogleLocalPost,
  getGoogleLocalPost,
  googleLocalPosts,
  patchGoogleLocalPost,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  loadPauseSnapshot,
  requireGbpDispatch,
} from "@/lib/server/pause-controls"
import {
  operationSummary,
  requestScopedKeyPart,
  settleOperationsForAttempts,
} from "@/lib/server/mutation-operations"
import {
  requireLocationAccess,
  requireLocationAction,
} from "@/lib/server/permissions"
import type {
  RecoveryAdapter,
  RecoveryAttempt,
  SettledVerdict,
} from "@/lib/server/mutation-recovery"
import type { Session } from "@/lib/server/session"

// Request/response shapes live in the contract; the old names stay exported
// from here for one sprint so existing imports keep working.
export { localPostInputSchema, type LocalPostInput }

// Posts keep their historical not-linked code (`location_not_linked`, not the
// pipeline default `google_location_not_linked`).
const POSTS_NOT_LINKED = {
  notLinked: {
    code: "location_not_linked",
    message: "Link this location to Google first.",
  },
}

// Provider-mutation boundary: both the global publish control and the Posts
// capability flag must be on. Local drafts are never gated.
const POSTS_PAUSED = {
  status: 503,
  code: "publishing_paused",
  message: "Google Posts publishing is paused.",
}

/**
 * The post's last create is still unconfirmed: it is `ambiguous` with no
 * Google name, so it may already be live. Neither a publish (a second create)
 * nor an edit (which would move its key away from the uncertain attempt) may
 * go ahead until Google's list settles it.
 */
function postPublishUncertain() {
  return new ApiError(
    409,
    "post_publish_uncertain",
    "Google has not confirmed whether this post's last publish went live. Refresh the posts list before changing it."
  )
}

/**
 * A publish holds `gbp_local_post` at `publishing` from before the Google
 * call until settle, so a second publish of the same post is refused while
 * that claim stands. The 409 is shared by every refusal (a live publish, an
 * edit during one, an approval request during one) so the client has one
 * thing to say.
 */
const POST_PUBLISH_IN_PROGRESS = {
  status: 409,
  code: "post_publish_in_progress",
  message:
    "A publish of this post is already under way. Wait a moment and try again.",
}

/**
 * The row's content moved on between the read a decision or publish was
 * based on and the write that acts on it. Nothing was sent to Google.
 */
const postChanged = () =>
  new ApiError(
    409,
    "approval_post_changed",
    "This post changed after you opened it. Read the current version before deciding."
  )

const postPublishInProgress = () =>
  new ApiError(
    POST_PUBLISH_IN_PROGRESS.status,
    POST_PUBLISH_IN_PROGRESS.code,
    POST_PUBLISH_IN_PROGRESS.message
  )

const providerTimeSchema = z.iso.datetime({ offset: true })
const providerTimeOrNull = (value: unknown): string | null => {
  const parsed = providerTimeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const stringOrNull = (value: unknown) =>
  typeof value === "string" ? value : null

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {}

// ---------------------------------------------------------------------------
// Reconciliation (live Google posts -> gbp_local_post)
// ---------------------------------------------------------------------------

async function fetchLiveLocalPosts(linked: LinkedLocation) {
  const token = await linked.accessToken()
  const live: Array<Record<string, unknown>> = []
  const seenTokens = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const response = await googleLocalPosts(
      token,
      {
        accountName: linked.googleAccountName,
        locationName: linked.googleLocationName,
        pageToken,
      },
      { connectionKey: linked.googleConnectionId }
    )
    live.push(...(response.localPosts ?? []))
    if (!response.nextPageToken) return live
    // A partial list must never reach reconciliation: any post missing from
    // it would be marked deleted here while it is still live on Google.
    if (seenTokens.has(response.nextPageToken)) {
      throw new ApiError(502, "google_posts_incomplete", "Google repeated a posts page. The list was not refreshed.")
    }
    seenTokens.add(response.nextPageToken)
    pageToken = response.nextPageToken
  }
  throw new ApiError(502, "google_posts_incomplete", "Google returned more post pages than the safety limit. The list was not refreshed.")
}

/**
 * One content column of the reconciliation upsert. Google owns the provider
 * columns unconditionally, but it must not own the content or the status of a
 * row that is mid-flight locally: a `do update set summary = excluded.summary`
 * silently discards an approval request, a pending edit or a settled failure
 * and reports the row as published. Only a row with no local work outstanding
 * takes Google's copy — `published`, and `deleted`, because that status is
 * this reconciliation's own verdict (the sweep below writes it when a post
 * stops being listed) and Google listing the post again overturns it. A bare
 * `WHERE` on the DO UPDATE would skip the provider columns too, which must
 * stay fresh, hence the per-column CASE.
 */
const authoritative = (sql: TransactionSql, column: string) =>
  sql`case when gbp_local_post.status in ('published', 'deleted') then excluded.${sql(column)} else gbp_local_post.${sql(column)} end`

async function upsertLiveLocalPost(
  sql: TransactionSql,
  linked: LinkedLocation,
  locationId: string,
  name: string,
  post: Record<string, unknown>
) {
  const state = stringOrNull(post.state)
  await sql`
    insert into gbp_local_post (
      organisation_id, location_id, external_location_id, topic_type,
      language_code, summary, call_to_action, event, offer, media,
      status, google_post_name, google_state, google_search_url,
      provider_payload, provider_payload_expires_at,
      provider_create_time, provider_update_time
    ) values (
      ${linked.organisationId}, ${locationId}, ${linked.externalLocationId}, ${String(post.topicType)},
      ${typeof post.languageCode === "string" ? post.languageCode : "en-GB"},
      ${typeof post.summary === "string" ? post.summary : ""},
      ${jsonColumnOrNull(sql, post.callToAction)},
      ${jsonColumnOrNull(sql, post.event)},
      ${jsonColumnOrNull(sql, post.offer)},
      ${jsonColumn(sql, Array.isArray(post.media) ? post.media : [])},
      ${state === "REJECTED" ? "failed" : "published"}, ${name}, ${state},
      ${stringOrNull(post.searchUrl)},
      ${jsonColumn(sql, post)}, now() + interval '30 days',
      ${providerTimeOrNull(post.createTime)},
      ${providerTimeOrNull(post.updateTime)}
    ) on conflict (organisation_id, google_post_name) do update set
      google_state = excluded.google_state,
      google_search_url = excluded.google_search_url,
      provider_payload = excluded.provider_payload,
      provider_payload_expires_at = excluded.provider_payload_expires_at,
      provider_create_time = excluded.provider_create_time,
      provider_update_time = excluded.provider_update_time,
      topic_type = ${authoritative(sql, "topic_type")},
      language_code = ${authoritative(sql, "language_code")},
      summary = ${authoritative(sql, "summary")},
      call_to_action = ${authoritative(sql, "call_to_action")},
      event = ${authoritative(sql, "event")},
      offer = ${authoritative(sql, "offer")},
      media = ${authoritative(sql, "media")},
      status = ${authoritative(sql, "status")},
      last_error_code = case
        when gbp_local_post.status not in ('published', 'deleted')
          then gbp_local_post.last_error_code
        when excluded.status = 'published' then null
        else 'google_post_rejected'
      end`
}

/**
 * A live Google post that carries the content we sent (topic, language and
 * summary, plus any call to action, event or offer the listing shows;
 * compared after normalisation by lib/domain/readback/posts.ts "identify"),
 * and whose name no local
 * row has claimed yet. That content is all a stranded post can be identified
 * by: `gbp_local_post_attempt.intended_payload` is written before the
 * provider call, but Google's name for the post only exists in a response we
 * never received. Two drafts with identical content are indistinguishable
 * here, so the first unclaimed match wins.
 */
function matchLivePost(
  live: Array<Record<string, unknown>>,
  intended: Record<string, unknown>,
  claimed: Set<string> = new Set()
) {
  return live.find((candidate) => {
    const name = stringOrNull(candidate.name)
    if (!name || claimed.has(name)) return false
    return localPostMatches(candidate, intended, "identify")
  })
}

type StrandedPost = {
  id: string
  status: string
  googlePostName: string | null
  attemptId: string | null
  attemptStatus: string | null
  intendedPayload: Record<string, unknown> | null
}

/**
 * Posts whose publish never settled: a killed instance leaves the row at
 * `publishing` (its lease then runs out), and an unreadable Google leaves it
 * at `ambiguous`. Both hold no `google_post_name`, so the post the write may
 * have created would arrive from `upsertLiveLocalPost` below as a SECOND row
 * rather than healing this one.
 *
 * Google's live list settles them: a match means the write landed and the row
 * adopts the name (the upsert then refreshes it from Google, including a
 * REJECTED verdict); no match means the list has spoken and nothing was
 * published, so the row becomes `failed` and is safe to publish again. A
 * `publishing` row still inside its lease is left alone — that publish is
 * genuinely in flight.
 *
 * A row that already holds a name was stranded by an UPDATE, and its name
 * being listed proves only that the post exists, not that the PATCH landed.
 * It becomes `failed` with `google_post_update_unconfirmed` instead: the
 * upsert below then leaves the unsent text alone, and the next publish
 * re-sends the PATCH, which carries no duplicate risk.
 */
async function settleStrandedLocalPosts(
  sql: TransactionSql,
  locationId: string,
  live: Array<Record<string, unknown>>
) {
  const stranded = await sql<StrandedPost[]>`
    select
      p.id::text as id,
      p.status,
      p.google_post_name as "googlePostName",
      a.id as "attemptId",
      a.status as "attemptStatus",
      a.intended_payload as "intendedPayload"
    from gbp_local_post p
    left join lateral (
      select id::text as id, status, intended_payload
      from gbp_local_post_attempt
      where post_id = p.id and operation <> 'delete'
      order by started_at desc
      limit 1
    ) a on true
    where p.location_id = ${locationId}
      and (
        p.status = 'ambiguous'
        or (
          p.status = 'publishing'
          and (
            p.publish_lease_expires_at <= now()
            or (
              p.publish_lease_expires_at is null
              and p.updated_at <= now() - interval '15 minutes'
            )
          )
        )
      )
  `
  if (stranded.length === 0) return
  // Names already bound to a row in this tenant: adopting one twice would
  // violate `unique (organisation_id, google_post_name)` (0015). Soft-deleted
  // rows keep their name and so keep their claim on it — that index does not
  // exclude them either.
  const held = await sql<{ googlePostName: string }[]>`
    select google_post_name as "googlePostName"
    from gbp_local_post
    where google_post_name is not null
  `
  const claimed = new Set(held.map((row) => row.googlePostName))
  for (const post of stranded) {
    if (
      post.googlePostName &&
      live.some((item) => stringOrNull(item.name) === post.googlePostName)
    ) {
      await sql`
        update gbp_local_post
        set status = 'failed', last_error_code = 'google_post_update_unconfirmed',
          publish_lease_expires_at = null
        where id = ${post.id}
      `
      // An attempt still `started` is the interrupted request's: it is as
      // unknown as the reaper would leave it. An `ambiguous` one stays so;
      // the next publish of the same text reads it back and re-sends.
      if (post.attemptId && post.attemptStatus === "started") {
        const settled = await sql<{ id: string }[]>`
          update gbp_local_post_attempt
          set status = 'ambiguous',
            provider_error_code = 'google_post_update_unconfirmed',
            finished_at = now()
          where id = ${post.attemptId} and status = 'started'
          returning id::text as id
        `
        await settleOperationsForAttempts(sql, {
          attemptTable: "gbp_local_post_attempt",
          attemptIds: settled.map((row) => row.id),
          state: "uncertain",
          attemptStatus: "ambiguous",
          errorCode: "google_post_update_unconfirmed",
        })
      }
      continue
    }
    // A named row not in Google's list needs no fuzzy match: the post is gone
    // at Google, so the row fails here and is marked deleted below. Without
    // an exit an interrupted UPDATE -- which strands WITH its name -- sat at
    // 'ambiguous' forever.
    const name = post.googlePostName
      ? null
      : stringOrNull(
          (post.intendedPayload
            ? matchLivePost(live, post.intendedPayload, claimed)
            : undefined
          )?.name
        )
    if (name) {
      claimed.add(name)
      await sql`
        update gbp_local_post
        set google_post_name = ${name}, status = 'published',
          last_error_code = null, publish_lease_expires_at = null
        where id = ${post.id}
      `
    } else {
      await sql`
        update gbp_local_post
        set status = 'failed', last_error_code = 'google_post_not_published',
          publish_lease_expires_at = null
        where id = ${post.id}
      `
    }
    // The attempt row outlives the request that opened it, so settle it here
    // too: left `started` it stays in flight for its whole 180-day retention
    // and the idempotency gate reads it as a publish still running; left
    // `ambiguous` the next publish of the same content reads Google again.
    if (
      post.attemptId &&
      (post.attemptStatus === "started" || post.attemptStatus === "ambiguous")
    ) {
      const settled = await sql`
        update gbp_local_post_attempt
        set status = ${name ? "succeeded" : "failed"},
          provider_error_code = ${name ? null : "google_post_not_published"},
          finished_at = now()
        where id = ${post.attemptId} and status in ('started', 'ambiguous')
        returning id
      `
      // And the receipt waiting on it (lib/server/mutation-operations.ts).
      // A match by content is only Google having accepted something like it.
      if (settled.length > 0) {
        await settleOperationsForAttempts(sql, {
          attemptTable: "gbp_local_post_attempt",
          attemptIds: [post.attemptId],
          state: name ? "awaiting_confirmation" : "failed",
          attemptStatus: name ? "succeeded" : "failed",
          errorCode: name ? null : "google_post_not_published",
        })
      }
    }
  }
}

/**
 * The rows reapStrandedLocalPosts parks: still `publishing` past their
 * publish lease (or, with no lease, 15 minutes untouched). The retention dry
 * run counts with the same predicate.
 */
export function strandedLocalPost(sql: TransactionSql): Fragment {
  return sql`
    status = 'publishing'
    and (
      publish_lease_expires_at <= now()
      or (
        publish_lease_expires_at is null
        and updated_at <= now() - interval '15 minutes'
      )
    )
  `
}

/**
 * Rows an interrupted publish left at `publishing`, parked as `ambiguous`
 * without a provider call. Runs inside one tenant's transaction, so the
 * fleet-wide sweep is the retention cron's existing per-organisation loop
 * calling this once per tenant.
 *
 * The resolution itself needs Google's live list and happens in
 * `settleStrandedLocalPosts` on the next read of the location; this only
 * stops a row claiming to be publishing forever in a tenant nobody opens,
 * and releases the publish claim so the post can be published again. Also
 * settles the attempt row the same request abandoned.
 */
export async function reapStrandedLocalPosts(
  sql: TransactionSql
): Promise<{ count: number }> {
  const reaped = await sql<{ id: string }[]>`
    update gbp_local_post
    set status = 'ambiguous', last_error_code = 'publish_lease_expired',
      publish_lease_expires_at = null
    where ${strandedLocalPost(sql)}
    returning id::text as id
  `
  if (reaped.length > 0) {
    const attempts = await sql<{ id: string }[]>`
      update gbp_local_post_attempt
      set status = 'ambiguous', provider_error_code = 'publish_lease_expired',
        finished_at = now()
      where post_id = any(${reaped.map((row) => row.id)}::uuid[])
        and status = 'started'
        and operation <> 'delete'
      returning id::text as id
    `
    await settleOperationsForAttempts(sql, {
      attemptTable: "gbp_local_post_attempt",
      attemptIds: attempts.map((row) => row.id),
      state: "uncertain",
      attemptStatus: "ambiguous",
      errorCode: "publish_lease_expired",
    })
  }
  return { count: reaped.length }
}

async function reconcileLocalPosts(
  organisationId: string,
  session: Session,
  locationId: string
) {
  const linked = await withTenant(organisationId, (sql) =>
    loadLinkedLocation(sql, session, locationId, POSTS_NOT_LINKED)
  )
  const live = await fetchLiveLocalPosts(linked)
  await withTenant(organisationId, async (sql) => {
    // Before anything is inserted: a stranded post has no google_post_name to
    // conflict on, so it must adopt its live post here or be duplicated below.
    await settleStrandedLocalPosts(sql, locationId, live)
    const liveNames = new Set<string>()
    for (const post of live) {
      const name = stringOrNull(post.name)
      if (
        !name ||
        !["STANDARD", "EVENT", "OFFER"].includes(String(post.topicType))
      )
        continue
      liveNames.add(name)
      await upsertLiveLocalPost(sql, linked, locationId, name, post)
    }
    const stored = await sql<{ id: string; googlePostName: string }[]>`
      select id::text as id, google_post_name as "googlePostName"
      from gbp_local_post where location_id = ${locationId}
        and google_post_name is not null and status <> 'deleted'`
    for (const post of stored) {
      if (!liveNames.has(post.googlePostName)) {
        await sql`update gbp_local_post set status = 'deleted', provider_payload = null where id = ${post.id}`
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Post rows
// ---------------------------------------------------------------------------

/**
 * A `PostRow` as it leaves the database: postgres.js hands timestamps back as
 * `Date`, which `NextResponse.json` serialises to the ISO strings the
 * contract declares.
 */
type PostListRow = Omit<
  PostRow,
  | "createdAt"
  | "updatedAt"
  | "providerCreatedAt"
  | "providerUpdatedAt"
  | "localEditedAt"
> & {
  createdAt: Date
  updatedAt: Date
  providerCreatedAt: Date | null
  providerUpdatedAt: Date | null
  localEditedAt: Date | null
}

type LocalPost = {
  id: string
  locationId: string
  externalLocationId: string
  googlePostName: string | null
  status: string
  topicType: "STANDARD" | "EVENT" | "OFFER"
  languageCode: string
  summary: string
  callToAction: Record<string, unknown> | null
  event: Record<string, unknown> | null
  offer: Record<string, unknown> | null
  media: Array<Record<string, unknown>>
  approvalRequestedBy: string | null
  /** Bumped by the 0081 trigger whenever a column sent to Google changes. */
  contentRevision: number
  /** The revision an outstanding approval request was made against. */
  approvalRequestedRevision: number | null
  /** Whoever last wrote the content locally (the creator until an edit). */
  authorId: string | null
  requireTwoPersonApproval: boolean
}

/**
 * The post row (404 `post_not_found`). Callers check location access first.
 * `lock` holds the row for the rest of the transaction, so a decision and
 * the revision it names cannot be split by a concurrent edit.
 */
async function loadPost(
  sql: TransactionSql,
  locationId: string,
  postId: string,
  options: { lock?: boolean } = {}
): Promise<LocalPost> {
  const [post] = await sql<LocalPost[]>`
    select
      p.id::text as id,
      p.location_id::text as "locationId",
      p.external_location_id::text as "externalLocationId",
      p.google_post_name as "googlePostName",
      p.status,
      p.topic_type as "topicType",
      p.language_code as "languageCode",
      p.summary,
      p.call_to_action as "callToAction",
      p.event,
      p.offer,
      p.media,
      p.approval_requested_by::text as "approvalRequestedBy",
      p.content_revision::integer as "contentRevision",
      p.approval_requested_revision::integer as "approvalRequestedRevision",
      coalesce(p.content_edited_by, p.created_by)::text as "authorId",
      o.require_two_person_approval as "requireTwoPersonApproval"
    from gbp_local_post p
    join organisation o on o.id = p.organisation_id
    where p.id = ${postId}
      and p.location_id = ${locationId}
      and p.status <> 'deleted'
    limit 1
    ${options.lock ? sql`for update of p` : sql``}
  `
  if (!post) throw new ApiError(404, "post_not_found", "Post not found.")
  return post
}

/**
 * The event as Google accepts it. A post read back from Google carries the
 * output-only `recurringInstanceTime` of its latest repeat; sending that
 * back on an edit is not ours to set.
 */
function providerEvent(event: LocalPost["event"]) {
  if (!event) return event
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { recurringInstanceTime, ...writable } = event
  return writable
}

/** The LocalPost columns a publish sends. */
type PostContent = Pick<
  LocalPost,
  | "topicType"
  | "languageCode"
  | "summary"
  | "callToAction"
  | "event"
  | "offer"
  | "media"
>

function providerPayload(post: PostContent) {
  return Object.fromEntries(
    Object.entries({
      languageCode: post.languageCode,
      summary: post.summary,
      callToAction: post.callToAction,
      event: providerEvent(post.event),
      offer: post.offer,
      media: post.media.length ? post.media : undefined,
      topicType: post.topicType,
    }).filter(([, value]) => value !== null && value !== undefined)
  )
}

/** The SQL each status view selects (columns of `gbp_local_post`). */
function postFilterCondition(
  sql: TransactionSql,
  filter: PostListFilter
): Fragment {
  switch (filter) {
    case "all":
      return sql`true`
    case "draft":
      return sql`status = 'draft'`
    case "awaiting":
      return sql`status = 'awaiting_approval'`
    case "published":
      return sql`status in ('published', 'publishing')`
    case "attention":
      return sql`(status in ('failed', 'ambiguous') or (status = 'published' and google_state = 'REJECTED'))`
  }
}

function parsePostsCursor(
  value: string | undefined,
  locationId: string,
  filter: PostListFilter
) {
  if (!value) return null
  const cursor = decodePostsCursor(value)
  if (!cursor)
    throw new ApiError(400, "invalid_cursor", "The posts cursor is invalid.")
  if (cursor.locationId !== locationId || cursor.filter !== filter)
    throw new ApiError(
      400,
      "invalid_cursor",
      "This cursor belongs to another list."
    )
  return cursor
}

/**
 * One page of the location's posts in one status view, newest first, plus
 * the counts of every view.
 *
 * The first page (no cursor) reconciles against Google's live list before it
 * reads; later pages read the database only, so loading more does not call
 * Google once per page. The list is keyset-paged on the materialised sort
 * time (`sort_at desc nulls last`, then `id`): a post created or edited
 * between pages sorts above the cursor and does not shift the rows below it.
 * `post` narrows the read to one post, which is how the ambiguous-post check
 * asks after a post that may not be on the first page.
 */
export async function listLocalPosts(
  organisationId: string,
  session: Session,
  locationId: string,
  options: PostsListQuery = {}
) {
  const filter: PostListFilter = options.post ? "all" : (options.filter ?? "all")
  const pageSize = Math.min(
    MAX_POSTS_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize ?? DEFAULT_POSTS_PAGE_SIZE))
  )
  const cursor = options.post
    ? null
    : parsePostsCursor(options.cursor, locationId, filter)
  let reconciliationError: string | null = null
  if (!cursor) {
    try {
      await reconcileLocalPosts(organisationId, session, locationId)
    } catch (error) {
      reconciliationError =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "google_posts_reconciliation_failed"
    }
  }
  const { rows, counts, timezone } = await withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [location] = await sql<{ timezone: string }[]>`
      select timezone from location where id = ${locationId}
    `
    const [counts] = await sql<PostCounts[]>`
      select
        count(*)::integer as "all",
        (count(*) filter (where ${postFilterCondition(sql, "draft")}))::integer as draft,
        (count(*) filter (where ${postFilterCondition(sql, "awaiting")}))::integer as awaiting,
        (count(*) filter (where ${postFilterCondition(sql, "published")}))::integer as published,
        (count(*) filter (where ${postFilterCondition(sql, "attention")}))::integer as attention,
        (count(*) filter (where status = 'published' and google_state = 'LIVE'))::integer as live
      from gbp_local_post
      where location_id = ${locationId}
        and status <> 'deleted'
    `
    const after = cursor
      ? cursor.at === null
        ? sql`and listed.sort_at is null and listed.id > ${cursor.id}::uuid`
        : sql`and (
            listed.sort_at < ${cursor.at}::text::timestamptz
            or (listed.sort_at = ${cursor.at}::text::timestamptz and listed.id > ${cursor.id}::uuid)
            or listed.sort_at is null
          )`
      : sql``
    const rows = await sql<(PostListRow & { cursorAt: string | null })[]>`
      with local_edits as (
        select subject_id, max(created_at) as edited_at
        from audit_log
        where organisation_id = ${organisationId}
          and subject_type = 'local_post'
          and action in ('post.draft.created', 'post.updated')
        group by subject_id
      ),
      listed as (
        select
          gbp_local_post.*,
          local_edits.edited_at,
          case
            when status = 'published' or (status = 'failed' and google_state = 'REJECTED' and (last_error_code = 'google_post_rejected' or local_edits.edited_at is null))
              then coalesce(provider_update_time, provider_create_time)
            else local_edits.edited_at
          end as sort_at
        from gbp_local_post
        left join local_edits on local_edits.subject_id = gbp_local_post.id::text
        where location_id = ${locationId}
          and status <> 'deleted'
          and ${postFilterCondition(sql, filter)}
          ${options.post ? sql`and gbp_local_post.id = ${options.post}::uuid` : sql``}
      )
      select
        listed.id::text as id,
        topic_type as "topicType",
        language_code as "languageCode",
        summary,
        call_to_action as "callToAction",
        event,
        offer,
        media,
        status,
        content_revision::integer as "contentRevision",
        google_post_name as "googlePostName",
        google_state as "googleState",
        google_search_url as "googleSearchUrl",
        last_error_code as "lastErrorCode",
        created_at as "createdAt",
        updated_at as "updatedAt",
        provider_create_time as "providerCreatedAt",
        provider_update_time as "providerUpdatedAt",
        edited_at as "localEditedAt",
        to_char(sort_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt"
      from listed
      where true ${after}
      order by sort_at desc nulls last, listed.id
      limit ${pageSize + 1}
    `
    return { rows, counts, timezone: location?.timezone ?? "Europe/London" }
  })
  const page = rows.slice(0, pageSize)
  const last = page.at(-1)
  const nextCursor =
    rows.length > pageSize && last
      ? encodePostsCursor({
          version: 1,
          locationId,
          filter,
          at: last.cursorAt,
          id: last.id,
        })
      : null
  return {
    posts: page.map((row): PostListRow => {
      // The cursor's copy of the sort time is not part of the row contract.
      const { cursorAt, ...post } = row
      void cursorAt
      return post
    }),
    counts,
    filter,
    nextCursor,
    timezone,
    writesEnabled: gbpWritesEnabled(getServerEnv(), "posts"),
    reconciliationError,
  }
}

export async function createLocalPostDraft(
  organisationId: string,
  session: Session,
  locationId: string,
  input: LocalPostInput,
  requestId: string
) {
  return withTenant(organisationId, async (sql) => {
    const linked = await loadLinkedLocation(
      sql,
      session,
      locationId,
      POSTS_NOT_LINKED
    )
    await requireLocationAction(sql, session, locationId, "edit")
    const [post] = await sql<{ id: string }[]>`
      insert into gbp_local_post (
        organisation_id, location_id, external_location_id,
        topic_type, language_code, summary, call_to_action, event, offer,
        media, created_by
      ) values (
        ${organisationId}, ${locationId}, ${linked.externalLocationId},
        ${input.topicType}, ${input.languageCode}, ${input.summary},
        ${jsonColumnOrNull(sql, input.callToAction)},
        ${jsonColumnOrNull(sql, input.event)},
        ${jsonColumnOrNull(sql, input.offer)},
        ${jsonColumn(sql, input.media)}, ${session.userId}
      )
      returning id::text as id
    `
    await writeAudit(sql, {
      organisationId,
      actorUserId: session.userId,
      action: "post.draft.created",
      subjectType: "local_post",
      subjectId: post.id,
      requestId,
      metadata: { locationId, topicType: input.topicType },
    })
    return post
  })
}

export async function updateLocalPostDraft(
  organisationId: string,
  session: Session,
  locationId: string,
  postId: string,
  input: LocalPostInput,
  requestId: string,
  /** The version the editor loaded; a later change by someone else is refused. */
  expectedUpdatedAt?: string
) {
  return withTenant(organisationId, async (sql) => {
    await requireLocationAction(sql, session, locationId, "edit")
    if (expectedUpdatedAt) {
      const [current] = await sql<{ changed: boolean }[]>`
        select date_trunc('milliseconds', updated_at) <> ${expectedUpdatedAt}::timestamptz as changed
        from gbp_local_post where id = ${postId} and location_id = ${locationId}`
      if (current?.changed) throw new ApiError(409, "post_changed", "Someone else changed this post after you opened it. Reload it before saving.")
    }
    const [post] = await sql<{ id: string; status: string }[]>`
      update gbp_local_post
      set
        topic_type = ${input.topicType},
        language_code = ${input.languageCode},
        summary = ${input.summary},
        call_to_action = ${jsonColumnOrNull(sql, input.callToAction)},
        event = ${jsonColumnOrNull(sql, input.event)},
        offer = ${jsonColumnOrNull(sql, input.offer)},
        media = ${jsonColumn(sql, input.media)},
        -- Authorship moves only with the content: re-saving identical text
        -- must not make the saver its author, which would bar them from
        -- approving someone else's request in two-person mode.
        content_edited_by = case
          when (topic_type, language_code, summary, call_to_action, event, offer, media)
            is distinct from (
              ${input.topicType}::text, ${input.languageCode}::text, ${input.summary}::text,
              ${jsonColumnOrNull(sql, input.callToAction)}::jsonb,
              ${jsonColumnOrNull(sql, input.event)}::jsonb,
              ${jsonColumnOrNull(sql, input.offer)}::jsonb,
              ${jsonColumn(sql, input.media)}::jsonb
            )
            then ${session.userId}::uuid
          else content_edited_by
        end,
        status = case when status = 'published' then status else 'draft' end,
        last_error_code = null
      where id = ${postId}
        and location_id = ${locationId}
        and status not in ('deleted', 'publishing')
        and not (status = 'ambiguous' and google_post_name is null)
      returning id::text as id, status
    `
    if (!post) {
      // 'publishing' is excluded above rather than reset to 'draft': the edit
      // would rewrite the payload an in-flight publish is sending, and the
      // reset would clear the claim that stops it being published twice.
      // An unconfirmed create is excluded too: reset to 'draft' it would
      // slip past the publish route's `ambiguous` guard under a new key and
      // create the post a second time if the first create had landed.
      const [current] = await sql<
        { status: string; googlePostName: string | null }[]
      >`
        select status, google_post_name as "googlePostName" from gbp_local_post
        where id = ${postId} and location_id = ${locationId}
      `
      if (current?.status === "publishing") throw postPublishInProgress()
      if (current?.status === "ambiguous" && !current.googlePostName) {
        throw postPublishUncertain()
      }
      throw new ApiError(404, "post_not_found", "Post not found.")
    }
    await writeAudit(sql, {
      organisationId,
      actorUserId: session.userId,
      action: "post.updated",
      subjectType: "local_post",
      subjectId: postId,
      requestId,
      metadata: { locationId },
    })
    return post
  })
}

// ---------------------------------------------------------------------------
// Attempt store
// ---------------------------------------------------------------------------

type LocalPostAttemptIntent = {
  postId: string
  operation: "create" | "update" | "delete"
  payload: Record<string, unknown>
  /** create/update only: the approver when published through the approval flow. */
  approvedBy: string | null
  /** create/update only: the post_approval_decision this publish went out under. */
  approvalDecisionId: string | null
  /**
   * create/update only: the content revision `payload` was built from. The
   * publish claim refuses a row that has moved on, so an edit landing between
   * the read and the claim can never be sent under an approval of other text.
   */
  revision: number | null
}

type AttemptSelection = { id: string; status: string; startedAt?: Date | null }

function attemptRow(row: AttemptSelection): AttemptRow {
  return {
    id: row.id,
    status: row.status === "started" ? "validating" : row.status,
    rawStatus: row.status,
    // Without this the pipeline cannot tell an interrupted attempt from a
    // live one, so it 409s on every stranded row instead of recovering it by
    // readback (gbp-write.ts recoverInFlight).
    startedAt: row.startedAt ?? null,
  }
}

/** True when Google returned the post but declined to show it. */
const isRejected = (response: Record<string, unknown>) =>
  stringOrNull(response.state) === "REJECTED"

async function markPostPublished(
  sql: TransactionSql,
  postId: string,
  response: Record<string, unknown>
) {
  // The write landed either way — REJECTED is Google's verdict on a post it
  // holds, not a failed publish — so the name and payload are recorded and
  // only the status differs. Recording it as 'published' told the operator
  // the post was live when nobody could see it, and left reconciliation to
  // flip it to 'failed' with no error code to explain why.
  const rejected = isRejected(response)
  await sql`
    update gbp_local_post
    set
      status = ${rejected ? "failed" : "published"},
      google_post_name = ${stringOrNull(response.name)},
      google_state = ${stringOrNull(response.state)},
      google_search_url = ${stringOrNull(response.searchUrl)},
      provider_payload = ${jsonColumn(sql, response)},
      provider_payload_expires_at = now() + interval '30 days',
      provider_create_time = ${providerTimeOrNull(response.createTime)},
      provider_update_time = ${providerTimeOrNull(response.updateTime)},
      last_error_code = ${rejected ? "google_post_rejected" : null},
      publish_lease_expires_at = null
    where id = ${postId}
  `
}

/**
 * gbp_local_post_attempt as an AttemptStore, hand-written because every
 * transition also moves gbp_local_post.status: `start` marks the post
 * `publishing` (create/update), `settle` marks it `published` with the
 * provider read-back, `failed`/`ambiguous` with the error code, or `deleted`
 * after a successful delete. The table's CHECK constraint only knows
 * started/succeeded/failed/ambiguous, so the in-flight vocabulary maps onto
 * `started` and `markPublishing` has nothing to record.
 */
const localPostAttempts: AttemptStore<LocalPostAttemptIntent> = {
  table: "gbp_local_post_attempt",

  async find(sql, input) {
    const [row] = await sql<AttemptSelection[]>`
      select id::text as id, status, started_at as "startedAt"
      from gbp_local_post_attempt
      where organisation_id = ${input.organisationId}
        and idempotency_key = ${input.key}
      limit 1
    `
    return row ? attemptRow(row) : null
  },

  async start(sql, input) {
    const {
      postId,
      operation,
      payload,
      approvedBy,
      approvalDecisionId,
      revision,
    } = input.intent
    // The publish key is derived from the write now, not from the request, so
    // a retry after a settled failure finds its own row: re-arm it in place
    // rather than inserting a second row that `unique (organisation_id,
    // idempotency_key)` would reject and abort the whole transaction on.
    const [row] = input.existing
      ? await sql<AttemptSelection[]>`
          update gbp_local_post_attempt
          set status = 'started', actor_user_id = ${input.actorUserId},
            approval_decision_id = ${approvalDecisionId},
            provider_error_code = null, provider_http_status = null,
            provider_response = null, finished_at = null, started_at = now()
          where id = ${input.existing.id}
            and status = ${input.existing.rawStatus}
          returning id::text as id, status, started_at as "startedAt"
        `
      : await sql<AttemptSelection[]>`
          insert into gbp_local_post_attempt (
            organisation_id, post_id, actor_user_id, operation,
            status, idempotency_key, intended_payload, approval_decision_id
          ) values (
            ${input.organisationId}, ${postId}, ${input.actorUserId},
            ${operation}, 'started', ${input.key}, ${jsonColumn(sql, payload)},
            ${approvalDecisionId}
          )
          on conflict (organisation_id, idempotency_key) do nothing
          returning id::text as id, status, started_at as "startedAt"
        `
    if (!row) return null
    if (operation !== "delete") {
      // The publish claim. Conditioning it on the post's own status is what
      // makes two concurrent publishes of the same post safe even when their
      // keys differ (an edit between the two clicks changes the payload
      // hash): the loser updates no row and is refused here, which rolls the
      // attempt insert above back with it. The lease bounds the claim so a
      // killed instance does not hold it forever.
      const [claimed] = await sql<{ id: string }[]>`
        update gbp_local_post
        set status = 'publishing', approved_by = ${approvedBy},
          publish_lease_expires_at = now() + interval '5 minutes'
        where id = ${postId} and status <> 'publishing'
          and content_revision = ${revision}
        returning id::text as id
      `
      if (!claimed) {
        const [current] = await sql<{ status: string }[]>`
          select status from gbp_local_post where id = ${postId}
        `
        if (current?.status === "publishing") throw postPublishInProgress()
        throw postChanged()
      }
    }
    return attemptRow(row)
  },

  async markPublishing() {},

  async settle(sql, input) {
    const succeeded = input.status === "succeeded"
    const [attempt] = await sql<{ postId: string; operation: string }[]>`
      update gbp_local_post_attempt
      set status = ${input.status},
        provider_error_code = ${succeeded ? null : input.errorCode},
        provider_http_status = ${input.httpStatus ?? null},
        provider_response = ${jsonColumnOrNull(sql, input.response)},
        finished_at = now()
      where id = ${input.id}
        ${input.expectedStatus === undefined ? sql`` : sql`and status = ${input.expectedStatus}`}
      returning post_id::text as "postId", operation
    `
    if (!attempt) return false
    if (attempt.operation === "delete") {
      if (succeeded) {
        await sql`update gbp_local_post set status = 'deleted', provider_payload = null where id = ${attempt.postId}`
      }
      return
    }
    if (!succeeded) {
      await sql`
        update gbp_local_post
        set status = ${input.status}, last_error_code = ${input.errorCode},
          publish_lease_expires_at = null
        where id = ${attempt.postId}
      `
      return
    }
    await markPostPublished(sql, attempt.postId, asRecord(input.response))
  },
}

// ---------------------------------------------------------------------------
// Publish / approve / delete
// ---------------------------------------------------------------------------

/**
 * The two-person rule for posts, mirroring the reply pipeline's
 * `requiresApproval`: a user without publish authority always asks, and in
 * two-person mode even a publisher asks unless a different user has already
 * approved this exact content.
 */
export function requiresPostApproval(
  policy: { requireTwoPersonApproval: boolean },
  canPublish: boolean,
  hasQualifyingApproval: boolean
): boolean {
  return (
    !canPublish || (policy.requireTwoPersonApproval && !hasQualifyingApproval)
  )
}

/** SHA-256 of what a publish of this row would send to Google. */
export function postContentHash(post: LocalPost): string {
  return sha256(JSON.stringify(providerPayload(post)))
}

/**
 * Who approved a publish and, for a post approval, the decision row. `id` is
 * null for a scheduled occurrence, whose approval is the schedule's.
 */
type ApprovalRef = { id: string | null; decidedBy: string }

/**
 * An approval that lets anyone with publish authority publish this row as it
 * stands: an approved decision on the current revision and payload hash by
 * somebody other than the content's author, which no later rejection of the
 * same revision has overturned. This is how a publish that failed after its
 * approval can be retried without asking again, and it is the only way a
 * publisher gets past the two-person rule.
 *
 * The approver may retry their own approval: the author is the first person
 * and the approver the second, so excluding the author is what keeps two
 * people on every publish. A rejection is the newer word on that revision, so
 * an older approval of identical text does not survive it.
 */
async function qualifyingApproval(
  sql: TransactionSql,
  post: LocalPost
): Promise<ApprovalRef | null> {
  const [approval] = await sql<ApprovalRef[]>`
    select d.id::text as id, d.decided_by::text as "decidedBy"
    from post_approval_decision d
    where d.post_id = ${post.id}
      and d.decision = 'approved'
      and d.content_revision = ${post.contentRevision}
      and d.content_hash = ${postContentHash(post)}
      and d.decided_by is not null
      and d.decided_by is distinct from ${post.authorId}::uuid
      and not exists (
        select 1 from post_approval_decision r
        where r.post_id = d.post_id
          and r.content_revision = d.content_revision
          and r.decision = 'rejected'
          and r.created_at >= d.created_at
          and r.id <> d.id
      )
    order by d.created_at desc
    limit 1
  `
  return approval ?? null
}

/** True when `userId` asked for, or wrote, the content up for approval. */
const isOwnRequest = (post: LocalPost, userId: string) =>
  post.approvalRequestedBy === userId || post.authorId === userId

/**
 * Checks shared by approve and reject: the post must be parked, and (for an
 * approval) the approver must have read the revision that was asked about.
 */
function requirePendingDecision(
  post: LocalPost,
  expectedRevision: number | undefined,
  decision: "approve" | "reject"
) {
  if (post.status !== "awaiting_approval") {
    throw new ApiError(
      409,
      "approval_not_pending",
      "This post is not awaiting approval."
    )
  }
  if (decision === "approve" && expectedRevision === undefined) {
    throw new ApiError(
      400,
      "expected_revision_required",
      "Say which version of the post you are approving."
    )
  }
  if (
    (expectedRevision !== undefined &&
      expectedRevision !== post.contentRevision) ||
    post.approvalRequestedRevision !== post.contentRevision
  ) {
    throw postChanged()
  }
}

async function insertDecision(
  sql: TransactionSql,
  input: { organisationId: string; session: Session },
  post: LocalPost,
  decision: "approved" | "rejected"
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into post_approval_decision (
      organisation_id, post_id, content_revision, content_hash,
      requested_by, author_id, decided_by, decision
    ) values (
      ${input.organisationId}, ${post.id}, ${post.contentRevision},
      ${postContentHash(post)}, ${post.approvalRequestedBy},
      ${post.authorId}, ${input.session.userId}, ${decision}
    )
    returning id::text as id
  `
  return row.id
}

export async function requestOrPublishLocalPost(input: {
  organisationId: string
  session: Session
  locationId: string
  postId: string
  requestId: string
  approval?: boolean
  /** Approve only: the `contentRevision` the approver read. */
  expectedRevision?: number
}) {
  // One transaction, with the row locked, decides whether this request parks
  // or publishes and records the decision: an edit cannot land between the
  // revision being checked and the decision that names it. Requesting
  // approval is a local-only write, so it must not depend on the Google link
  // or the posts kill switch; both are checked only once a publish is due,
  // and before any decision row is written, so a paused or unlinked publish
  // leaves no approval behind claiming otherwise.
  //
  // `reconciled` is the second pass, after an `ambiguous` post was settled
  // from Google's live list (see below), naming what the uncertain write was.
  const decide = async (reconciled: false | "create" | "update") => {
    // Read before the transaction: a pooled read inside it could wait on the
    // connection the transaction itself holds (lib/server/db.ts).
    const pauses = await loadPauseSnapshot()
    return withTenant(input.organisationId, async (sql) => {
      // A viewer may neither publish nor ask for approval; an approver's
      // decision needs publication authority, not just an edit grant.
      const grant = await requireLocationAction(
        sql,
        input.session,
        input.locationId,
        input.approval ? "decide_approval" : "request_approval"
      )
      const post = await loadPost(sql, input.locationId, input.postId, {
        lock: true,
      })
      const publishWith = async (approval: ApprovalRef | null) => {
        // The dispatch gate itself (env and operator pause table), not just
        // the env flag: a table pause must refuse here, before a decision
        // row or its audit is written, as well as at runGbpWrite.
        await requireGbpDispatch("posts", POSTS_PAUSED, { snapshot: pauses })
        const linked = await loadLinkedLocation(
          sql,
          input.session,
          input.locationId,
          POSTS_NOT_LINKED
        )
        return { kind: "publish" as const, post, linked, approval }
      }

      if (input.approval) {
        requirePendingDecision(post, input.expectedRevision, "approve")
        if (isOwnRequest(post, input.session.userId)) {
          if (post.requireTwoPersonApproval) {
            throw new ApiError(
              403,
              "second_approver_required",
              "A different authorised user must approve this post."
            )
          }
          // Without the policy a publisher may publish their own content
          // directly, so approving their own request is that publish, not a
          // decision: no approval row claims a second person looked at it.
          if (post.approvalRequestedBy === input.session.userId) {
            return publishWith(null)
          }
        }
        const linkedPublish = await publishWith(null)
        const id = await insertDecision(sql, input, post, "approved")
        // The decision stands even if the publish below fails (a retry of the
        // same revision goes out under it), so it is audited in its own right.
        await writeAudit(sql, {
          organisationId: input.organisationId,
          actorUserId: input.session.userId,
          action: "post.approval.approved",
          subjectType: "local_post",
          subjectId: input.postId,
          requestId: input.requestId,
          metadata: {
            locationId: input.locationId,
            contentRevision: post.contentRevision,
            decisionId: id,
          },
        })
        return {
          ...linkedPublish,
          approval: { id, decidedBy: input.session.userId },
        }
      }

      if (post.status === "publishing") throw postPublishInProgress()
      // An earlier publish whose outcome Google never confirmed. It may have
      // created the post already, so sending it again -- a create, when the row
      // holds no Google name -- risks a second live post. Google's list settles
      // it first, on the server, whatever the client believes the status is.
      if (post.status === "ambiguous") {
        if (reconciled !== false) throw postPublishUncertain()
        return {
          kind: "reconcile" as const,
          create: post.googlePostName === null,
        }
      }
      // The uncertain create had landed: the post is live with the content it
      // was asked to publish, so there is nothing left to send. Only a create:
      // a listed name proves nothing about an update, which settles `failed`
      // and is re-sent below (a PATCH carries no duplicate risk).
      if (reconciled === "create" && post.status === "published") {
        return { kind: "adopted" as const, post }
      }
      const approval = await qualifyingApproval(sql, post)
      if (requiresPostApproval(post, grant.canPublish, approval !== null)) {
        await sql`
        update gbp_local_post
        set status = 'awaiting_approval',
          approval_requested_by = ${input.session.userId},
          approval_requested_revision = content_revision
        where id = ${input.postId}
      `
        await writeAudit(sql, {
          organisationId: input.organisationId,
          actorUserId: input.session.userId,
          action: "post.approval.requested",
          subjectType: "local_post",
          subjectId: input.postId,
          requestId: input.requestId,
          metadata: {
            locationId: input.locationId,
            contentRevision: post.contentRevision,
            // Why a publisher's own publish parked: the organisation's
            // two-person policy, not a missing grant.
            twoPerson: grant.canPublish,
          },
        })
        return { kind: "parked" as const }
      }
      return publishWith(approval)
    })
  }
  let decided = await decide(false)
  if (decided.kind === "reconcile") {
    // A provider read, so outside the deciding transaction; the second pass
    // re-locks the row and decides again from what the list proved.
    await reconcileLocalPosts(
      input.organisationId,
      input.session,
      input.locationId
    )
    decided = await decide(decided.create ? "create" : "update")
  }
  if (decided.kind === "reconcile") throw postPublishUncertain()
  if (decided.kind === "adopted") {
    return {
      status: "published" as const,
      postId: input.postId,
      googlePostName: decided.post.googlePostName,
    }
  }
  if (decided.kind === "parked") {
    return { status: "awaiting_approval" as const }
  }
  return publishLocalPost({
    ...input,
    linked: decided.linked,
    post: decided.post,
    approval: decided.approval,
  })
}

/**
 * Send a parked post back to draft. Rejecting is a decision on someone's
 * request, so it needs the same authority as approving; withdrawing your own
 * request is allowed and recorded in the audit log only (a decision row is by
 * definition somebody else's).
 */
export async function rejectLocalPost(input: {
  organisationId: string
  session: Session
  locationId: string
  postId: string
  requestId: string
  expectedRevision?: number
}) {
  await withTenant(input.organisationId, async (sql) => {
    await requireLocationAction(
      sql,
      input.session,
      input.locationId,
      "decide_approval"
    )
    const post = await loadPost(sql, input.locationId, input.postId, {
      lock: true,
    })
    requirePendingDecision(post, input.expectedRevision, "reject")
    const decisionId =
      post.approvalRequestedBy === input.session.userId
        ? null
        : await insertDecision(sql, input, post, "rejected")
    await sql`
      update gbp_local_post
      set status = 'draft', approval_requested_by = null
      where id = ${input.postId}
    `
    await writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.session.userId,
      action: "post.approval.rejected",
      subjectType: "local_post",
      subjectId: input.postId,
      requestId: input.requestId,
      metadata: {
        locationId: input.locationId,
        contentRevision: post.contentRevision,
        decisionId,
      },
    })
  })
  return { status: "draft" as const }
}

/**
 * A scheduled occurrence's publish (lib/server/publication-schedule-runner.ts).
 * The runner has already rechecked the schedule's approval, the approver's
 * current publish grant and the policy; this applies the same kill switch,
 * link check, idempotency key and readback as a manual publish. The approver
 * is the actor, as they are for an approved manual publish.
 */
export async function publishScheduledLocalPost(input: {
  organisationId: string
  session: Session
  locationId: string
  postId: string
  requestId: string
}) {
  requireGbpWrite(getServerEnv(), "posts", POSTS_PAUSED)
  const { linked, post } = await withTenant(input.organisationId, async (sql) => ({
    linked: await loadLinkedLocation(sql, input.session, input.locationId, POSTS_NOT_LINKED),
    post: await loadPost(sql, input.locationId, input.postId),
  }))
  // The schedule's approval lives on post_publication_schedule, not in
  // post_approval_decision, so the publish names its approver and no
  // decision row.
  return publishLocalPost({
    ...input,
    approval: { id: null, decidedBy: input.session.userId },
    linked,
    post,
  })
}

async function publishLocalPost(input: {
  organisationId: string
  session: Session
  postId: string
  requestId: string
  linked: LinkedLocation
  post: LocalPost
  /** The approval this publish goes out under, when there is one. */
  approval: ApprovalRef | null
}) {
  const { linked, post } = input
  const operation = post.googlePostName ? "update" : "create"
  const payload = providerPayload(post)
  const options = { connectionKey: linked.googleConnectionId }
  let googlePostName = post.googlePostName
  const result = await runGbpWrite<
    Record<string, unknown>,
    Record<string, unknown>,
    LocalPostAttemptIntent
  >({
    surface: "posts",
    paused: POSTS_PAUSED,
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: localPostAttempts,
    // Derived from the write, the way hours.ts derives its key: with the
    // request id in here every HTTP request produced a fresh key, `find`
    // could never match, and two clicks on Publish created two live Google
    // posts. Two publishes of the same post and payload now share one row.
    key: idempotencyKey([
      input.organisationId,
      input.postId,
      operation,
      post.googlePostName ?? "new",
      sha256(JSON.stringify(payload)),
    ]),
    intent: {
      postId: input.postId,
      operation,
      payload,
      approvedBy: input.approval?.decidedBy ?? null,
      approvalDecisionId: input.approval?.id ?? null,
      revision: post.contentRevision,
    },
    onExisting: "resume",
    inProgress: POST_PUBLISH_IN_PROGRESS,
    failureCode: "google_post_failed",
    operation: {
      surface: "local_post",
      action: operation,
      locationId: linked.locationId,
      targetType: "local_post",
      targetRef: input.postId,
      payloadHash: idempotencyKey([
        input.postId,
        operation,
        sha256(JSON.stringify(payload)),
      ]),
      expectedRevision: post.contentRevision,
      googleConnectionId: linked.googleConnectionId,
      approvalRef: input.approval?.id ?? null,
    },
    mutate: async () => {
      const token = await linked.accessToken()
      return operation === "create"
        ? createGoogleLocalPost(
            token,
            {
              accountName: linked.googleAccountName,
              locationName: linked.googleLocationName,
              payload,
            },
            options
          )
        : patchGoogleLocalPost(
            token,
            {
              postName: post.googlePostName as string,
              updateMask: [
                "languageCode",
                "summary",
                "callToAction",
                "event",
                "offer",
                "media",
                "topicType",
              ],
              payload,
            },
            options
          )
    },
    // An ambiguous create used to be rethrown before this readback ever ran,
    // settling the post 'ambiguous' with a null name — and the tab then
    // offered Publish on exactly that status, which re-created the post at
    // Google because a null name still reads as `create`. Reading Google is
    // what the reply pipeline does, and it is what the readback below does.
    onAmbiguous: "readback",
    readback: {
      read: async ({ response }) => {
        // An update with no response -- the PATCH was ambiguous, or this is a
        // later reconcile of that attempt -- cannot be proven by reading the
        // post: it exists either way and Google normalises its body. Nothing
        // is read, verify fails, and the attempt settles `failed` so the next
        // publish re-sends the PATCH (idempotent, unlike a create).
        if (operation === "update" && response === undefined) return {}
        const named = stringOrNull(response?.name) ?? post.googlePostName
        if (named) {
          googlePostName = named
          return getGoogleLocalPost(await linked.accessToken(), named, options)
        }
        // An ambiguous create leaves no response, so the post's Google name
        // exists only at Google: list the location and match what was sent.
        const match = matchLivePost(await fetchLiveLocalPosts(linked), payload)
        googlePostName = stringOrNull(match?.name)
        return match ?? {}
      },
      // A named resource is the proof that a create landed: it exists, and
      // settling it failed would invite a second create of the same post. An
      // update is also compared with what was sent, after the normalisation
      // Google applies (lib/domain/readback/posts.ts): the post exists either
      // way, so only its content says whether the PATCH applied, and a
      // mismatch settles failed so the next publish re-sends it. No name
      // means the list has spoken and nothing was published, so the attempt
      // settles failed rather than fabricating a publish.
      // The differing field names are logged so a normalisation this
      // adapter does not model (a systematic false mismatch) shows up.
      verify: ({ readback }) => {
        if (!stringOrNull(readback.name)) return false
        if (operation === "create") return true
        const fields = localPostMismatches(readback, payload)
        if (fields.length > 0)
          log.warn("posts.update_readback_mismatch", {
            postId: input.postId,
            fields,
          })
        return fields.length === 0
      },
      mismatch:
        operation === "create"
          ? {
              status: 502,
              code: "google_post_not_published",
              message:
                "Google does not list this post, so nothing was published.",
            }
          : {
              status: 502,
              code: "google_post_update_unconfirmed",
              message:
                "Google did not confirm this change to the post. Publish it again to resend it.",
            },
      // The post exists at Google either way; its own state says whether
      // customers see it (LIVE), Google is still reviewing it (PROCESSING)
      // or Google refused it (REJECTED).
      outcome: (readback) =>
        googlePostStateOutcome(stringOrNull(asRecord(readback).state)),
      // An unchanged re-publish answered from its succeeded attempt, or a
      // receipt joining one: the post's stored Google state, which a list
      // reconcile may have moved on since (the answer below reads the same).
      settledOutcome: async (sql, attempt) => {
        const [row] = await sql<{ googleState: string | null }[]>`
          select p.google_state as "googleState"
          from gbp_local_post_attempt a
          join gbp_local_post p on p.id = a.post_id
          where a.id = ${attempt.id}
        `
        return row ? googlePostStateOutcome(row.googleState) : null
      },
    },
    audit: (ctx) => ({
      action: operation === "create" ? "post.published" : "post.updated.google",
      subjectType: "local_post",
      subjectId: input.postId,
      metadata: {
        locationId: linked.locationId,
        attemptId: ctx.attemptId,
        googlePostName: stringOrNull(asRecord(ctx.readback).name),
        // The decision this publish went out under (the approval flow, or a
        // retry of an approved revision). The decision itself is audited
        // separately as post.approval.approved when it is recorded.
        approvedBy: input.approval?.decidedBy ?? null,
        approvalDecisionId: input.approval?.id ?? null,
        contentRevision: post.contentRevision,
        providerAmbiguous: ctx.providerAmbiguous,
      },
    }),
  }).catch((error: unknown) => {
    // A provider failure surfaces as an ApiError, which http.ts deliberately
    // does not log, so without this a batch of failed publishes produces no
    // log line at all and is only discoverable by reading last_error_code per
    // row. runGbpWrite's audit hook runs on the success path only.
    log.warn("posts.publish_failed", {
      organisationId: input.organisationId,
      locationId: linked.locationId,
      postId: input.postId,
      requestId: input.requestId,
      operation,
      code: error instanceof ApiError ? error.code : "internal_error",
    })
    throw error
  })
  if (result.idempotent) {
    // Not this request's write: the same publish either already succeeded or
    // is still settling. Report the post's stored state rather than claiming
    // a publish this request did not make.
    const [stored] = await withTenant(
      input.organisationId,
      (sql) =>
        sql<
          {
            status: string
            googlePostName: string | null
            googleState: string | null
            lastErrorCode: string | null
          }[]
        >`
        select status, google_post_name as "googlePostName",
          google_state as "googleState", last_error_code as "lastErrorCode"
        from gbp_local_post
        where id = ${input.postId}
      `
    )
    if (stored?.status !== "published" && stored?.status !== "failed") {
      throw postPublishInProgress()
    }
    return {
      status:
        stored.status === "failed"
          ? ("rejected" as const)
          : ("published" as const),
      postId: input.postId,
      googlePostName: stored.googlePostName,
      operation: {
        operationId: result.operationId ?? null,
        // The post's own state, which a later list reconcile may have moved
        // on from what the first answer said.
        outcome: localPostOutcome(stored) ?? result.outcome,
      },
    }
  }
  // The read-back, not the mutate response, is what settle stored on the row.
  const resource = asRecord(result.readback ?? result.response)
  return {
    status: isRejected(resource)
      ? ("rejected" as const)
      : ("published" as const),
    postId: input.postId,
    googlePostName: stringOrNull(resource.name) ?? googlePostName,
    operation: operationSummary(result),
  }
}

export async function deleteLocalPost(input: {
  organisationId: string
  session: Session
  locationId: string
  postId: string
  requestId: string
}) {
  const post = await withTenant(input.organisationId, async (sql) => {
    await requireLocationAction(sql, input.session, input.locationId, "edit")
    return loadPost(sql, input.locationId, input.postId)
  })
  if (!post.googlePostName) {
    await withTenant(
      input.organisationId,
      (sql) => sql`
      update gbp_local_post set status = 'deleted' where id = ${input.postId}
    `
    )
    return { status: "deleted" as const }
  }
  requireGbpWrite(getServerEnv(), "posts", POSTS_PAUSED)
  const linked = await withTenant(input.organisationId, (sql) =>
    loadLinkedLocation(sql, input.session, input.locationId, POSTS_NOT_LINKED)
  )
  requirePublishGrant(linked, {
    code: "publish_permission_required",
    message: "Publish permission is required to delete a live post.",
  })
  const googlePostName = post.googlePostName
  try {
    await runGbpWrite<void, { listed: boolean }, LocalPostAttemptIntent>({
      surface: "posts",
      paused: POSTS_PAUSED,
      organisationId: input.organisationId,
      actorUserId: input.session.userId,
      requestId: input.requestId,
      store: localPostAttempts,
      // Still request-scoped, unlike the publish key above: delete takes no
      // payload to derive a key from, and a content-derived key would let an
      // interrupted delete 409 every later delete of the same post forever.
      // Scoped to the client's intent when it sends one, so a retry of the
      // same delete replays instead of deleting again.
      key: idempotencyKey([
        input.postId,
        "delete",
        requestScopedKeyPart(input.requestId),
      ]),
      intent: {
        postId: input.postId,
        operation: "delete",
        payload: {},
        approvedBy: null,
        approvalDecisionId: null,
        revision: null,
      },
      onExisting: "replay",
      failureCode: "google_post_failed",
      operation: {
        surface: "local_post",
        action: "delete",
        locationId: linked.locationId,
        targetType: "local_post",
        targetRef: input.postId,
        payloadHash: idempotencyKey([input.postId, "delete", googlePostName]),
        googleConnectionId: linked.googleConnectionId,
      },
      mutate: async () => {
        try {
          await deleteGoogleLocalPost(
            await linked.accessToken(),
            googlePostName,
            { connectionKey: linked.googleConnectionId }
          )
        } catch (error) {
          // A retry after a lost response finds the post already gone.
          if (error instanceof ApiError && error.status === 404) return
          throw error
        }
      },
      // A 5xx or timeout on DELETE says nothing about whether the post is
      // gone. Google's live list does: absent means the delete landed, still
      // listed means it did not and the row settles failed, safe to retry.
      onAmbiguous: "readback",
      readback: {
        // A clean 2xx DELETE is Google's own answer, so the list is read only
        // when that answer was lost: listing after it could fail, or still
        // show the post through read-after-write lag, and turn a delete that
        // landed into an error.
        read: async ({ providerAmbiguous }) => ({
          listed:
            providerAmbiguous &&
            (await fetchLiveLocalPosts(linked)).some(
              (item) => stringOrNull(item.name) === googlePostName
            ),
        }),
        verify: ({ readback }) => !readback.listed,
        mismatch: {
          status: 502,
          code: "google_post_not_deleted",
          message: "Google still lists this post, so it was not deleted.",
        },
      },
      audit: (ctx) => ({
        action: "post.deleted",
        subjectType: "local_post",
        subjectId: input.postId,
        metadata: {
          locationId: linked.locationId,
          attemptId: ctx.attemptId,
          googlePostName,
        },
      }),
    })
  } catch (error) {
    log.warn("posts.delete_failed", {
      organisationId: input.organisationId,
      locationId: linked.locationId,
      postId: input.postId,
      requestId: input.requestId,
      code: error instanceof ApiError ? error.code : "internal_error",
    })
    throw error
  }
  return { status: "deleted" as const }
}

// ---------------------------------------------------------------------------
// Recovery (lib/server/mutation-recovery.ts)
// ---------------------------------------------------------------------------

type LocalPostRecoveryAttempt = RecoveryAttempt & {
  operation: "create" | "update" | "delete"
  intendedPayload: Record<string, unknown>
  postLocationId: string
  googlePostName: string | null
  /** Google names other rows of this tenant already hold. */
  claimedNames: string[]
}

/**
 * Reads an uncertain post write back from Google:
 *
 *   create   a live post carrying the content sent and claimed by no other
 *            row is the create (matchLivePost, identified by content, so
 *            `awaiting_confirmation`); the row adopts its name. None means
 *            the list has spoken and nothing was published.
 *   update   the post's content compared with what was sent after Google's
 *            normalisation (lib/domain/readback/posts.ts); a mismatch is an
 *            update that did not apply, safe to send again.
 *   delete   the post is no longer listed.
 *
 * The settle is settleRecoveredLocalPost, not localPostAttempts.settle: a
 * readback can run days after the write, and by then the post may carry an
 * edit or a newer publish that this verdict says nothing about.
 */
export const localPostRecoveryAdapter: RecoveryAdapter<LocalPostRecoveryAttempt> =
  {
    surface: "local_post",
    attemptTable: "gbp_local_post_attempt",
    async load(sql, attemptId) {
      const [row] = await sql<Omit<LocalPostRecoveryAttempt, "claimedNames">[]>`
        select
          a.id::text as id,
          a.status as "rawStatus",
          a.started_at as "startedAt",
          a.provider_error_code as "errorCode",
          a.operation,
          a.intended_payload as "intendedPayload",
          p.location_id::text as "postLocationId",
          p.google_post_name as "googlePostName"
        from gbp_local_post_attempt a
        join gbp_local_post p on p.id = a.post_id
        where a.id = ${attemptId}
      `
      if (!row) return null
      const held = await sql<{ googlePostName: string }[]>`
        select google_post_name as "googlePostName"
        from gbp_local_post
        where google_post_name is not null
      `
      return { ...row, claimedNames: held.map((item) => item.googlePostName) }
    },
    async readback({ attempt, link }) {
      if (attempt.postLocationId !== link.locationId) {
        return { kind: "unverifiable", errorCode: "target_changed" }
      }
      if (attempt.operation === "create") {
        if (attempt.googlePostName) {
          // Named since by another path: the create is what it named.
          return {
            kind: "landed",
            confirmed: false,
            response: await getGoogleLocalPost(
              await link.accessToken(),
              attempt.googlePostName,
              { connectionKey: link.googleConnectionId }
            ),
          }
        }
        const match = matchLivePost(
          await fetchLiveLocalPosts(link),
          attempt.intendedPayload,
          new Set(attempt.claimedNames)
        )
        return match
          ? { kind: "landed", confirmed: false, response: match }
          : { kind: "not_landed", errorCode: "google_post_not_published" }
      }
      if (!attempt.googlePostName) {
        return { kind: "unverifiable", errorCode: "target_changed" }
      }
      if (attempt.operation === "delete") {
        const listed = (await fetchLiveLocalPosts(link)).some(
          (item) => stringOrNull(item.name) === attempt.googlePostName
        )
        return listed
          ? { kind: "not_landed", errorCode: "google_post_not_deleted" }
          : { kind: "landed", confirmed: true }
      }
      const current = await getGoogleLocalPost(
        await link.accessToken(),
        attempt.googlePostName,
        { connectionKey: link.googleConnectionId }
      )
      return localPostMismatches(current, attempt.intendedPayload).length === 0
        ? { kind: "landed", confirmed: true, response: current }
        : { kind: "not_landed", errorCode: "google_post_update_unconfirmed" }
    },
    settle: settleRecoveredLocalPost,
  }

/**
 * Settles a recovered post attempt, and moves the post row only while the
 * verdict is still about it. Recovery runs from minutes to days after the
 * write (the first delay, back-off, reconnect parks), and in that time the
 * post can be edited (an update stranded with its name leaves the post
 * `failed`, which is editable) and published again under a new key. The
 * post row follows this verdict only when
 *
 *   - no later attempt exists for the post,
 *   - the post still holds the content this attempt sent, and
 *   - the post is `ambiguous` or `failed`: not `publishing` (another
 *     publish holds its claim and lease), not `published` (a newer verdict),
 *     and not a saved edit.
 *
 * Otherwise only the attempt (and, through the runner, the receipt) settles.
 * One exception: a create that landed while the post holds no name adopts
 * the name alone, status and content untouched, so the next publish PATCHes
 * the post Google holds instead of creating a second one, and the
 * reconciliation upsert, which owns only `published` rows, leaves the edit
 * alone. A landed delete removes the post wherever it is not mid-publish:
 * Google no longer holds it, whatever the row says.
 */
async function settleRecoveredLocalPost(
  sql: TransactionSql,
  input: { attempt: LocalPostRecoveryAttempt; verdict: SettledVerdict }
): Promise<boolean> {
  const { attempt, verdict } = input
  const landed = verdict.kind === "landed"
  const [settled] = await sql<{ postId: string; operation: string }[]>`
    update gbp_local_post_attempt
    set status = ${landed ? "succeeded" : "failed"},
      provider_error_code = ${landed ? null : verdict.errorCode},
      provider_response = ${jsonColumnOrNull(sql, landed ? verdict.response : undefined)},
      finished_at = now()
    where id = ${attempt.id} and status = ${attempt.rawStatus}
    returning post_id::text as "postId", operation
  `
  if (!settled) return false

  const [post] = await sql<
    (PostContent &
      Pick<LocalPost, "status" | "googlePostName"> & { latest: boolean })[]
  >`
    select
      p.status,
      p.google_post_name as "googlePostName",
      p.topic_type as "topicType",
      p.language_code as "languageCode",
      p.summary,
      p.call_to_action as "callToAction",
      p.event,
      p.offer,
      p.media,
      not exists (
        select 1 from gbp_local_post_attempt later
        where later.post_id = p.id
          and later.id <> ${attempt.id}
          and later.started_at > a.started_at
      ) as latest
    from gbp_local_post p
    join gbp_local_post_attempt a on a.id = ${attempt.id}
    where p.id = ${settled.postId}
    for update of p
  `
  if (!post) return true

  if (settled.operation === "delete") {
    if (landed && post.status !== "publishing") {
      await sql`
        update gbp_local_post set status = 'deleted', provider_payload = null
        where id = ${settled.postId}
      `
    }
    return true
  }

  const [{ holdsIntent }] = await sql<{ holdsIntent: boolean }[]>`
    select intended_payload = ${jsonColumn(sql, providerPayload(post))}::jsonb
      as "holdsIntent"
    from gbp_local_post_attempt
    where id = ${attempt.id}
  `
  const current =
    post.latest &&
    holdsIntent &&
    (post.status === "ambiguous" || post.status === "failed")
  if (current) {
    if (landed) {
      await markPostPublished(sql, settled.postId, asRecord(verdict.response))
    } else {
      await sql`
        update gbp_local_post
        set status = 'failed', last_error_code = ${verdict.errorCode},
          publish_lease_expires_at = null
        where id = ${settled.postId}
      `
    }
    return true
  }
  const name = landed ? stringOrNull(asRecord(verdict.response).name) : null
  if (
    settled.operation === "create" &&
    name &&
    !post.googlePostName &&
    post.status !== "publishing"
  ) {
    await sql`
      update gbp_local_post set google_post_name = ${name}
      where id = ${settled.postId} and google_post_name is null
        and not exists (
          select 1 from gbp_local_post other
          where other.google_post_name = ${name}
        )
    `
  }
  return true
}
