import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"

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
  requireLocationAccess,
  requireLocationAction,
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
  const { posts, timezone } = await withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [location] = await sql<{ timezone: string }[]>`
      select timezone from location where id = ${locationId}
    `
    const posts = await sql<PostListRow[]>`
      with local_edits as (
        select subject_id, max(created_at) as edited_at
        from audit_log
        where organisation_id = ${organisationId}
          and subject_type = 'local_post'
          and action in ('post.draft.created', 'post.updated')
        group by subject_id
      )
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
        content_revision::integer as "contentRevision",
        google_post_name as "googlePostName",
        google_state as "googleState",
        google_search_url as "googleSearchUrl",
        last_error_code as "lastErrorCode",
        created_at as "createdAt",
        updated_at as "updatedAt",
        provider_create_time as "providerCreatedAt",
        provider_update_time as "providerUpdatedAt",
        local_edits.edited_at as "localEditedAt"
      from gbp_local_post
      left join local_edits on local_edits.subject_id = gbp_local_post.id::text
      where location_id = ${locationId}
        and status <> 'deleted'
      order by case
        when status = 'published' or (status = 'failed' and google_state = 'REJECTED' and (last_error_code = 'google_post_rejected' or local_edits.edited_at is null))
          then coalesce(provider_update_time, provider_create_time)
        else local_edits.edited_at
      end desc nulls last, id
    `
    return { posts, timezone: location?.timezone ?? "Europe/London" }
  })
  return {
    posts,
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
  const decided = await withTenant(input.organisationId, async (sql) => {
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
      requireGbpWrite(getServerEnv(), "posts", POSTS_PAUSED)
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
    await runGbpWrite<void, { deleted: boolean }, LocalPostAttemptIntent>({
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
        approvalDecisionId: null,
        revision: null,
      },
      onExisting: "replay",
      failureCode: "google_post_failed",
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
      // An unknown outcome is settled by reading the post: absent is deleted.
      onAmbiguous: "readback",
      readback: {
        read: async () => {
          try {
            await getGoogleLocalPost(await linked.accessToken(), googlePostName, { connectionKey: linked.googleConnectionId })
            return { deleted: false }
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) return { deleted: true }
            throw error
          }
        },
        verify: ({ readback }) => readback.deleted === true,
        mismatch: {
          status: 502,
          code: "google_post_delete_unconfirmed",
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
