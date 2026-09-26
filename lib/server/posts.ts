import "server-only"

import type { TransactionSql } from "postgres"

import {
  localPostInputSchema,
  type LocalPostInput,
  type PostRow,
} from "@/lib/contracts/location-posts"
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
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
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

const postPublishInProgress = () =>
  new ApiError(
    POST_PUBLISH_IN_PROGRESS.status,
    POST_PUBLISH_IN_PROGRESS.code,
    POST_PUBLISH_IN_PROGRESS.message
  )

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
    if (!response.nextPageToken || seenTokens.has(response.nextPageToken)) break
    seenTokens.add(response.nextPageToken)
    pageToken = response.nextPageToken
  }
  return live
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
      ${stringOrNull(post.createTime)},
      ${stringOrNull(post.updateTime)}
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
 * A live Google post that carries the summary/topic/language we sent, and
 * whose name no local row has claimed yet. That triple is all a stranded post
 * can be identified by: `gbp_local_post_attempt.intended_payload` is written
 * before the provider call, but Google's name for the post only exists in a
 * response we never received. Two drafts with identical text are
 * indistinguishable here, so the first unclaimed match wins.
 */
function matchLivePost(
  live: Array<Record<string, unknown>>,
  intended: Record<string, unknown>,
  claimed: Set<string> = new Set()
) {
  return live.find((candidate) => {
    const name = stringOrNull(candidate.name)
    if (!name || claimed.has(name)) return false
    return (
      String(candidate.topicType) === String(intended.topicType) &&
      (typeof candidate.summary === "string" ? candidate.summary : "") ===
        (typeof intended.summary === "string" ? intended.summary : "") &&
      String(candidate.languageCode ?? "") ===
        String(intended.languageCode ?? "")
    )
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
    // A row that already holds a name needs no fuzzy match: Google's own list
    // is the answer. Without this branch an interrupted UPDATE to a published
    // post -- which strands WITH its name -- had no exit at all and sat at
    // 'ambiguous' forever, while reconciliation re-created it alongside.
    const name = post.googlePostName
      ? live.some((item) => stringOrNull(item.name) === post.googlePostName)
        ? post.googlePostName
        : null
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
    // and the idempotency gate reads it as a publish still running.
    if (post.attemptId && post.attemptStatus === "started") {
      await sql`
        update gbp_local_post_attempt
        set status = ${name ? "succeeded" : "failed"},
          provider_error_code = ${name ? null : "google_post_not_published"},
          finished_at = now()
        where id = ${post.attemptId} and status = 'started'
      `
    }
  }
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
    where status = 'publishing'
      and (
        publish_lease_expires_at <= now()
        or (
          publish_lease_expires_at is null
          and updated_at <= now() - interval '15 minutes'
        )
      )
    returning id::text as id
  `
  if (reaped.length > 0) {
    await sql`
      update gbp_local_post_attempt
      set status = 'ambiguous', provider_error_code = 'publish_lease_expired',
        finished_at = now()
      where post_id = any(${reaped.map((row) => row.id)}::uuid[])
        and status = 'started'
        and operation <> 'delete'
    `
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
type PostListRow = Omit<PostRow, "createdAt" | "updatedAt"> & {
  createdAt: Date
  updatedAt: Date
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
  requireTwoPersonApproval: boolean
}

/** The post row (404 `post_not_found`). Callers check location access first. */
async function loadPost(
  sql: TransactionSql,
  locationId: string,
  postId: string
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
      o.require_two_person_approval as "requireTwoPersonApproval"
    from gbp_local_post p
    join organisation o on o.id = p.organisation_id
    where p.id = ${postId}
      and p.location_id = ${locationId}
      and p.status <> 'deleted'
    limit 1
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

function providerPayload(post: LocalPost) {
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

export async function listLocalPosts(
  organisationId: string,
  session: Session,
  locationId: string
) {
  let reconciliationError: string | null = null
  try {
    await reconcileLocalPosts(organisationId, session, locationId)
  } catch (error) {
    reconciliationError =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "google_posts_reconciliation_failed"
  }
  const posts = await withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    return sql<PostListRow[]>`
      select
        id::text as id,
        topic_type as "topicType",
        language_code as "languageCode",
        summary,
        call_to_action as "callToAction",
        event,
        offer,
        media,
        status,
        google_post_name as "googlePostName",
        google_state as "googleState",
        google_search_url as "googleSearchUrl",
        last_error_code as "lastErrorCode",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from gbp_local_post
      where location_id = ${locationId}
        and status <> 'deleted'
      order by updated_at desc
    `
  })
  return {
    posts,
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
  requestId: string
) {
  return withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
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
        status = case when status = 'published' then status else 'draft' end,
        last_error_code = null
      where id = ${postId}
        and location_id = ${locationId}
        and status not in ('deleted', 'publishing')
      returning id::text as id, status
    `
    if (!post) {
      // 'publishing' is excluded above rather than reset to 'draft': the edit
      // would rewrite the payload an in-flight publish is sending, and the
      // reset would clear the claim that stops it being published twice.
      const [current] = await sql<{ status: string }[]>`
        select status from gbp_local_post
        where id = ${postId} and location_id = ${locationId}
      `
      if (current?.status === "publishing") throw postPublishInProgress()
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
      provider_create_time = ${stringOrNull(response.createTime)},
      provider_update_time = ${stringOrNull(response.updateTime)},
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
    const { postId, operation, payload, approvedBy } = input.intent
    // The publish key is derived from the write now, not from the request, so
    // a retry after a settled failure finds its own row: re-arm it in place
    // rather than inserting a second row that `unique (organisation_id,
    // idempotency_key)` would reject and abort the whole transaction on.
    const [row] = input.existing
      ? await sql<AttemptSelection[]>`
          update gbp_local_post_attempt
          set status = 'started', actor_user_id = ${input.actorUserId},
            provider_error_code = null, provider_http_status = null,
            provider_response = null, finished_at = null, started_at = now()
          where id = ${input.existing.id}
          returning id::text as id, status, started_at as "startedAt"
        `
      : await sql<AttemptSelection[]>`
          insert into gbp_local_post_attempt (
            organisation_id, post_id, actor_user_id, operation,
            status, idempotency_key, intended_payload
          ) values (
            ${input.organisationId}, ${postId}, ${input.actorUserId},
            ${operation}, 'started', ${input.key}, ${jsonColumn(sql, payload)}
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
        returning id::text as id
      `
      if (!claimed) throw postPublishInProgress()
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
      returning post_id::text as "postId", operation
    `
    if (!attempt) return
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

export async function requestOrPublishLocalPost(input: {
  organisationId: string
  session: Session
  locationId: string
  postId: string
  requestId: string
  approval?: boolean
}) {
  // Requesting approval is a local-only write: it must not depend on the
  // Google link being active or on the posts kill switch (both gate the
  // provider write below, as on main).
  const { canPublish, post } = await withTenant(
    input.organisationId,
    async (sql) => {
      await requireLocationAccess(sql, input.session, input.locationId)
      return {
        canPublish: await canPublishLocation(
          sql,
          input.session,
          input.locationId
        ),
        post: await loadPost(sql, input.locationId, input.postId),
      }
    }
  )
  if (!canPublish) {
    await withTenant(input.organisationId, async (sql) => {
      const [requested] = await sql<{ id: string }[]>`
        update gbp_local_post
        set status = 'awaiting_approval', approval_requested_by = ${input.session.userId}
        where id = ${input.postId} and status <> 'publishing'
        returning id::text as id
      `
      if (!requested) throw postPublishInProgress()
      await writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.session.userId,
        action: "post.approval.requested",
        subjectType: "local_post",
        subjectId: input.postId,
        requestId: input.requestId,
        metadata: { locationId: input.locationId },
      })
    })
    return { status: "awaiting_approval" as const }
  }
  requireGbpWrite(getServerEnv(), "posts", POSTS_PAUSED)
  const linked = await withTenant(input.organisationId, (sql) =>
    loadLinkedLocation(sql, input.session, input.locationId, POSTS_NOT_LINKED)
  )
  if (
    input.approval &&
    post.requireTwoPersonApproval &&
    post.approvalRequestedBy === input.session.userId
  ) {
    throw new ApiError(
      403,
      "second_approver_required",
      "A different authorised user must approve this post."
    )
  }
  return publishLocalPost({ ...input, linked, post })
}

async function publishLocalPost(input: {
  organisationId: string
  session: Session
  postId: string
  requestId: string
  approval?: boolean
  linked: LinkedLocation
  post: LocalPost
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
      approvedBy: input.approval ? input.session.userId : null,
    },
    onExisting: "resume",
    inProgress: POST_PUBLISH_IN_PROGRESS,
    failureCode: "google_post_failed",
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
      // A named resource is the proof that the write landed; the body is not
      // compared with the intent because Google normalises post bodies. No
      // name means the list has spoken and nothing was published, so the
      // attempt settles failed rather than fabricating a publish.
      verify: ({ readback }) => Boolean(stringOrNull(readback.name)),
      mismatch: {
        status: 502,
        code: "google_post_not_published",
        message: "Google does not list this post, so nothing was published.",
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
        // The approver, when this publish came through the approval flow;
        // there is no separate approve audit because this row carries it.
        approvedBy: input.approval ? input.session.userId : null,
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
        sql<{ status: string; googlePostName: string | null }[]>`
        select status, google_post_name as "googlePostName"
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
    await requireLocationAccess(sql, input.session, input.locationId)
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
    await runGbpWrite<void, never, LocalPostAttemptIntent>({
      organisationId: input.organisationId,
      actorUserId: input.session.userId,
      requestId: input.requestId,
      store: localPostAttempts,
      // Still request-scoped, unlike the publish key above: delete takes no
      // payload to derive a key from, and a content-derived key would let an
      // interrupted delete 409 every later delete of the same post forever.
      key: idempotencyKey([input.postId, "delete", input.requestId]),
      intent: {
        postId: input.postId,
        operation: "delete",
        payload: {},
        approvedBy: null,
      },
      onExisting: "replay",
      failureCode: "google_post_failed",
      mutate: async () => {
        await deleteGoogleLocalPost(
          await linked.accessToken(),
          googlePostName,
          { connectionKey: linked.googleConnectionId }
        )
      },
      onAmbiguous: "fail",
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
