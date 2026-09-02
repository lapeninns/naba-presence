import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
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
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

const callToActionSchema = z
  .object({
    actionType: z.enum([
      "BOOK",
      "ORDER",
      "SHOP",
      "LEARN_MORE",
      "SIGN_UP",
      "CALL",
    ]),
    url: z.url().optional(),
  })
  .optional()

export const localPostInputSchema = z
  .object({
    topicType: z.enum(["STANDARD", "EVENT", "OFFER"]),
    languageCode: z.string().trim().min(2).max(16).default("en-GB"),
    summary: z.string().trim().max(1500).default(""),
    callToAction: callToActionSchema,
    event: z.record(z.string(), z.unknown()).optional(),
    offer: z
      .object({
        couponCode: z.string().trim().max(100).optional(),
        redeemOnlineUrl: z.url().optional(),
        termsConditions: z.string().trim().max(5000).optional(),
      })
      .optional(),
    media: z
      .array(z.object({ sourceUrl: z.url() }))
      .max(10)
      .default([]),
    scheduledTime: z.iso.datetime().optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.topicType === "EVENT" || value.topicType === "OFFER") &&
      !value.event
    ) {
      context.addIssue({
        code: "custom",
        path: ["event"],
        message: "Event details are required for event and offer posts.",
      })
    }
    if (value.topicType === "OFFER" && !value.offer) {
      context.addIssue({
        code: "custom",
        path: ["offer"],
        message: "Offer details are required for offer posts.",
      })
    }
  })

export type LocalPostInput = z.infer<typeof localPostInputSchema>

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
      topic_type = excluded.topic_type, language_code = excluded.language_code,
      summary = excluded.summary, call_to_action = excluded.call_to_action,
      event = excluded.event, offer = excluded.offer, media = excluded.media,
      status = excluded.status, google_state = excluded.google_state,
      google_search_url = excluded.google_search_url,
      provider_payload = excluded.provider_payload,
      provider_payload_expires_at = excluded.provider_payload_expires_at,
      provider_create_time = excluded.provider_create_time,
      provider_update_time = excluded.provider_update_time,
      last_error_code = case when excluded.status = 'published' then null else gbp_local_post.last_error_code end`
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
  scheduledTime: Date | null
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
      p.scheduled_publish_time as "scheduledTime",
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

function providerPayload(post: LocalPost) {
  return Object.fromEntries(
    Object.entries({
      languageCode: post.languageCode,
      summary: post.summary,
      callToAction: post.callToAction,
      event: post.event,
      offer: post.offer,
      media: post.media.length ? post.media : undefined,
      scheduledTime: post.scheduledTime?.toISOString(),
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
    return sql`
      select
        id::text as id,
        topic_type as "topicType",
        language_code as "languageCode",
        summary,
        call_to_action as "callToAction",
        event,
        offer,
        media,
        scheduled_publish_time as "scheduledTime",
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
        media, scheduled_publish_time, created_by
      ) values (
        ${organisationId}, ${locationId}, ${linked.externalLocationId},
        ${input.topicType}, ${input.languageCode}, ${input.summary},
        ${jsonColumnOrNull(sql, input.callToAction)},
        ${jsonColumnOrNull(sql, input.event)},
        ${jsonColumnOrNull(sql, input.offer)},
        ${jsonColumn(sql, input.media)}, ${input.scheduledTime ?? null}, ${session.userId}
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
        scheduled_publish_time = ${input.scheduledTime ?? null},
        status = case when status = 'published' then status else 'draft' end,
        last_error_code = null
      where id = ${postId}
        and location_id = ${locationId}
        and status <> 'deleted'
      returning id::text as id, status
    `
    if (!post) throw new ApiError(404, "post_not_found", "Post not found.")
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

function attemptRow(row: { id: string; status: string }): AttemptRow {
  return {
    id: row.id,
    status: row.status === "started" ? "validating" : row.status,
    rawStatus: row.status,
  }
}

async function markPostPublished(
  sql: TransactionSql,
  postId: string,
  response: Record<string, unknown>
) {
  await sql`
    update gbp_local_post
    set
      status = 'published',
      google_post_name = ${stringOrNull(response.name)},
      google_state = ${stringOrNull(response.state)},
      google_search_url = ${stringOrNull(response.searchUrl)},
      provider_payload = ${jsonColumn(sql, response)},
      provider_payload_expires_at = now() + interval '30 days',
      provider_create_time = ${stringOrNull(response.createTime)},
      provider_update_time = ${stringOrNull(response.updateTime)},
      last_error_code = null
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
    const [row] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status
      from gbp_local_post_attempt
      where organisation_id = ${input.organisationId}
        and idempotency_key = ${input.key}
      limit 1
    `
    return row ? attemptRow(row) : null
  },

  async start(sql, input) {
    const { postId, operation, payload, approvedBy } = input.intent
    const [row] = await sql<{ id: string; status: string }[]>`
      insert into gbp_local_post_attempt (
        organisation_id, post_id, actor_user_id, operation,
        status, idempotency_key, intended_payload
      ) values (
        ${input.organisationId}, ${postId}, ${input.actorUserId},
        ${operation}, 'started', ${input.key}, ${jsonColumn(sql, payload)}
      )
      returning id::text as id, status
    `
    if (operation !== "delete") {
      await sql`
        update gbp_local_post
        set status = 'publishing', approved_by = ${approvedBy}
        where id = ${postId}
      `
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
        set status = ${input.status}, last_error_code = ${input.errorCode}
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
  requireGbpWrite(getServerEnv(), "posts", POSTS_PAUSED)
  const { linked, post } = await withTenant(
    input.organisationId,
    async (sql) => {
      const linked = await loadLinkedLocation(
        sql,
        input.session,
        input.locationId,
        POSTS_NOT_LINKED
      )
      return {
        linked,
        post: await loadPost(sql, input.locationId, input.postId),
      }
    }
  )
  if (!linked.canPublish) {
    await withTenant(input.organisationId, async (sql) => {
      await sql`
        update gbp_local_post
        set status = 'awaiting_approval', approval_requested_by = ${input.session.userId}
        where id = ${input.postId}
      `
    })
    return { status: "awaiting_approval" as const }
  }
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
  await runGbpWrite<
    Record<string, unknown>,
    Record<string, unknown>,
    LocalPostAttemptIntent
  >({
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: localPostAttempts,
    key: idempotencyKey([input.postId, operation, input.requestId]),
    intent: {
      postId: input.postId,
      operation,
      payload,
      approvedBy: input.approval ? input.session.userId : null,
    },
    // The key carries the request id, so any existing row is this request replayed.
    onExisting: "replay",
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
                "scheduledTime",
                "topicType",
              ],
              payload,
            },
            options
          )
    },
    onAmbiguous: "fail",
    readback: {
      read: async ({ response }) => {
        googlePostName = stringOrNull(response?.name) ?? post.googlePostName
        return googlePostName
          ? getGoogleLocalPost(
              await linked.accessToken(),
              googlePostName,
              options
            )
          : (response ?? {})
      },
      // Posts store the read-back as the post's provider payload rather than
      // comparing it with the intent: Google normalises post bodies.
      verify: () => true,
    },
  })
  return { status: "published" as const, postId: input.postId, googlePostName }
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
  await runGbpWrite<void, never, LocalPostAttemptIntent>({
    organisationId: input.organisationId,
    actorUserId: input.session.userId,
    requestId: input.requestId,
    store: localPostAttempts,
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
      await deleteGoogleLocalPost(await linked.accessToken(), googlePostName, {
        connectionKey: linked.googleConnectionId,
      })
    },
    onAmbiguous: "fail",
  })
  return { status: "deleted" as const }
}
