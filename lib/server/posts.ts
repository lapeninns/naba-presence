import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  createGoogleLocalPost,
  deleteGoogleLocalPost,
  getGoogleLocalPost,
  GoogleMutationAmbiguousError,
  googleLocalPosts,
  patchGoogleLocalPost,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
} from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

const callToActionSchema = z
  .object({
    actionType: z.enum(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]),
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
    if ((value.topicType === "EVENT" || value.topicType === "OFFER") && !value.event) {
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

type PostsLocationContext = {
  externalLocationId: string
  connectionId: string
  accountName: string
  googleLocationName: string
}

async function postsLocationContext(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<PostsLocationContext> {
  await requireLocationAccess(sql, session, locationId)
  const [row] = await sql<PostsLocationContext[]>`
    select el.id::text as "externalLocationId",
      el.google_connection_id::text as "connectionId",
      el.google_account_name as "accountName",
      el.google_location_name as "googleLocationName"
    from location_link ll
    join external_location el on el.id = ll.external_location_id
    where ll.location_id = ${locationId} and ll.is_active = true
    limit 1`
  if (!row) throw new ApiError(409, "location_not_linked", "Link this location to Google first.")
  return row
}

async function reconcileLocalPosts(
  organisationId: string,
  session: Session,
  locationId: string
) {
  const context = await withTenant(organisationId, (sql) =>
    postsLocationContext(sql, session, locationId)
  )
  const token = await connectionAccessToken(getDatabase(), organisationId, context.connectionId)
  const live: Array<Record<string, unknown>> = []
  const seenTokens = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < 100; page += 1) {
    const response = await googleLocalPosts(token, {
      accountName: context.accountName,
      locationName: context.googleLocationName,
      pageToken,
    }, { connectionKey: context.connectionId })
    live.push(...(response.localPosts ?? []))
    if (!response.nextPageToken || seenTokens.has(response.nextPageToken)) break
    seenTokens.add(response.nextPageToken)
    pageToken = response.nextPageToken
  }
  await withTenant(organisationId, async (sql) => {
    const liveNames = new Set<string>()
    for (const post of live) {
      const name = typeof post.name === "string" ? post.name : null
      const topicType = post.topicType
      if (!name || !["STANDARD", "EVENT", "OFFER"].includes(String(topicType))) continue
      liveNames.add(name)
      const payload = JSON.parse(JSON.stringify(post))
      const state = typeof post.state === "string" ? post.state : null
      await sql`
        insert into gbp_local_post (
          organisation_id, location_id, external_location_id, topic_type,
          language_code, summary, call_to_action, event, offer, media,
          status, google_post_name, google_state, google_search_url,
          provider_payload, provider_payload_expires_at,
          provider_create_time, provider_update_time
        ) values (
          ${organisationId}, ${locationId}, ${context.externalLocationId}, ${String(topicType)},
          ${typeof post.languageCode === "string" ? post.languageCode : "en-GB"},
          ${typeof post.summary === "string" ? post.summary : ""},
          ${post.callToAction ? sql.json(JSON.parse(JSON.stringify(post.callToAction))) : null},
          ${post.event ? sql.json(JSON.parse(JSON.stringify(post.event))) : null},
          ${post.offer ? sql.json(JSON.parse(JSON.stringify(post.offer))) : null},
          ${sql.json(Array.isArray(post.media) ? JSON.parse(JSON.stringify(post.media)) : [])},
          ${state === "REJECTED" ? "failed" : "published"}, ${name}, ${state},
          ${typeof post.searchUrl === "string" ? post.searchUrl : null},
          ${sql.json(payload)}, now() + interval '30 days',
          ${typeof post.createTime === "string" ? post.createTime : null},
          ${typeof post.updateTime === "string" ? post.updateTime : null}
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

type PostContext = {
  id: string
  locationId: string
  externalLocationId: string
  connectionId: string
  accountName: string
  googleLocationName: string
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

function providerPayload(post: PostContext) {
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
    reconciliationError = error && typeof error === "object" && "code" in error
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
  const env = getServerEnv()
  return {
    posts,
    writesEnabled: env.GBP_POSTS_ENABLED && env.PUBLISH_ENABLED,
    reconciliationError,
  }
}

async function linkedLocation(sql: Parameters<Parameters<typeof withTenant>[1]>[0], locationId: string) {
  const [linked] = await sql<
    { externalLocationId: string }[]
  >`
    select ll.external_location_id::text as "externalLocationId"
    from location_link ll
    where ll.location_id = ${locationId}
      and ll.is_active = true
    limit 1
  `
  if (!linked) {
    throw new ApiError(409, "location_not_linked", "Link this location to Google first.")
  }
  return linked
}

export async function createLocalPostDraft(
  organisationId: string,
  session: Session,
  locationId: string,
  input: LocalPostInput,
  requestId: string
) {
  return withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const linked = await linkedLocation(sql, locationId)
    const [post] = await sql<{ id: string }[]>`
      insert into gbp_local_post (
        organisation_id, location_id, external_location_id,
        topic_type, language_code, summary, call_to_action, event, offer,
        media, scheduled_publish_time, created_by
      ) values (
        ${organisationId}, ${locationId}, ${linked.externalLocationId},
        ${input.topicType}, ${input.languageCode}, ${input.summary},
        ${input.callToAction ? sql.json(input.callToAction) : null},
        ${input.event ? sql.json(JSON.parse(JSON.stringify(input.event))) : null},
        ${input.offer ? sql.json(input.offer) : null},
        ${sql.json(input.media)}, ${input.scheduledTime ?? null}, ${session.userId}
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
        call_to_action = ${input.callToAction ? sql.json(input.callToAction) : null},
        event = ${input.event ? sql.json(JSON.parse(JSON.stringify(input.event))) : null},
        offer = ${input.offer ? sql.json(input.offer) : null},
        media = ${sql.json(input.media)},
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

async function loadPostContext(
  organisationId: string,
  session: Session,
  locationId: string,
  postId: string
) {
  return withTenant(organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [post] = await sql<PostContext[]>`
      select
        p.id::text as id,
        p.location_id::text as "locationId",
        p.external_location_id::text as "externalLocationId",
        el.google_connection_id::text as "connectionId",
        el.google_account_name as "accountName",
        el.google_location_name as "googleLocationName",
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
      join external_location el on el.id = p.external_location_id
      join organisation o on o.id = p.organisation_id
      where p.id = ${postId}
        and p.location_id = ${locationId}
        and p.status <> 'deleted'
      limit 1
    `
    if (!post) throw new ApiError(404, "post_not_found", "Post not found.")
    return { post, canPublish: await canPublishLocation(sql, session, locationId) }
  })
}

export async function requestOrPublishLocalPost(input: {
  organisationId: string
  session: Session
  locationId: string
  postId: string
  requestId: string
  approval?: boolean
}) {
  const context = await loadPostContext(
    input.organisationId,
    input.session,
    input.locationId,
    input.postId
  )
  if (!context.canPublish) {
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
    context.post.requireTwoPersonApproval &&
    context.post.approvalRequestedBy === input.session.userId
  ) {
    throw new ApiError(403, "second_approver_required", "A different authorised user must approve this post.")
  }
  const operation = context.post.googlePostName ? "update" : "create"
  const payload = providerPayload(context.post)
  const idempotencyKey = `${input.postId}:${operation}:${input.requestId}`
  const attempt = await withTenant(input.organisationId, async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into gbp_local_post_attempt (
        organisation_id, post_id, actor_user_id, operation,
        status, idempotency_key, intended_payload
      ) values (
        ${input.organisationId}, ${input.postId}, ${input.session.userId},
        ${operation}, 'started', ${idempotencyKey}, ${sql.json(JSON.parse(JSON.stringify(payload)))}
      )
      returning id::text as id
    `
    await sql`
      update gbp_local_post
      set status = 'publishing', approved_by = ${input.approval ? input.session.userId : null}
      where id = ${input.postId}
    `
    return row
  })
  try {
    const token = await connectionAccessToken(
      getDatabase(),
      input.organisationId,
      context.post.connectionId
    )
    const response = operation === "create"
      ? await createGoogleLocalPost(token, {
          accountName: context.post.accountName,
          locationName: context.post.googleLocationName,
          payload,
        }, { connectionKey: context.post.connectionId })
      : await patchGoogleLocalPost(token, {
          postName: context.post.googlePostName!,
          updateMask: ["languageCode", "summary", "callToAction", "event", "offer", "media", "scheduledTime", "topicType"],
          payload,
        }, { connectionKey: context.post.connectionId })
    const name = typeof response.name === "string" ? response.name : context.post.googlePostName
    const readback = name
      ? await getGoogleLocalPost(token, name, { connectionKey: context.post.connectionId })
      : response
    await settlePostSuccess(input.organisationId, input.postId, attempt.id, readback)
    return { status: "published" as const, postId: input.postId, googlePostName: name }
  } catch (error) {
    const ambiguous = error instanceof GoogleMutationAmbiguousError
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "google_post_failed"
    await withTenant(input.organisationId, async (sql) => {
      await sql`
        update gbp_local_post_attempt
        set status = ${ambiguous ? "ambiguous" : "failed"}, provider_error_code = ${code}, finished_at = now()
        where id = ${attempt.id}
      `
      await sql`
        update gbp_local_post
        set status = ${ambiguous ? "ambiguous" : "failed"}, last_error_code = ${code}
        where id = ${input.postId}
      `
    })
    throw error
  }
}

async function settlePostSuccess(
  organisationId: string,
  postId: string,
  attemptId: string,
  response: Record<string, unknown>
) {
  await withTenant(organisationId, async (sql) => {
    await sql`
      update gbp_local_post_attempt
      set status = 'succeeded', provider_response = ${sql.json(JSON.parse(JSON.stringify(response)))}, finished_at = now()
      where id = ${attemptId}
    `
    await sql`
      update gbp_local_post
      set
        status = 'published',
        google_post_name = ${typeof response.name === "string" ? response.name : null},
        google_state = ${typeof response.state === "string" ? response.state : null},
        google_search_url = ${typeof response.searchUrl === "string" ? response.searchUrl : null},
        provider_payload = ${sql.json(JSON.parse(JSON.stringify(response)))},
        provider_payload_expires_at = now() + interval '30 days',
        provider_create_time = ${typeof response.createTime === "string" ? response.createTime : null},
        provider_update_time = ${typeof response.updateTime === "string" ? response.updateTime : null},
        last_error_code = null
      where id = ${postId}
    `
  })
}

export async function deleteLocalPost(input: {
  organisationId: string
  session: Session
  locationId: string
  postId: string
  requestId: string
}) {
  const context = await loadPostContext(input.organisationId, input.session, input.locationId, input.postId)
  if (!context.post.googlePostName) {
    await withTenant(input.organisationId, (sql) => sql`
      update gbp_local_post set status = 'deleted' where id = ${input.postId}
    `)
    return { status: "deleted" as const }
  }
  if (!context.canPublish) throw new ApiError(403, "publish_permission_required", "Publish permission is required to delete a live post.")
  const attempt = await withTenant(input.organisationId, async (sql) => {
    const [row] = await sql<{ id: string }[]>`
      insert into gbp_local_post_attempt (
        organisation_id, post_id, actor_user_id, operation, status,
        idempotency_key, intended_payload
      ) values (
        ${input.organisationId}, ${input.postId}, ${input.session.userId},
        'delete', 'started', ${`${input.postId}:delete:${input.requestId}`}, '{}'::jsonb
      ) returning id::text as id
    `
    return row
  })
  try {
    const token = await connectionAccessToken(getDatabase(), input.organisationId, context.post.connectionId)
    await deleteGoogleLocalPost(token, context.post.googlePostName, { connectionKey: context.post.connectionId })
    await withTenant(input.organisationId, async (sql) => {
      await sql`update gbp_local_post_attempt set status = 'succeeded', finished_at = now() where id = ${attempt.id}`
      await sql`update gbp_local_post set status = 'deleted', provider_payload = null where id = ${input.postId}`
    })
    return { status: "deleted" as const }
  } catch (error) {
    const ambiguous = error instanceof GoogleMutationAmbiguousError
    await withTenant(input.organisationId, (sql) => sql`
      update gbp_local_post_attempt
      set status = ${ambiguous ? "ambiguous" : "failed"}, finished_at = now()
      where id = ${attempt.id}
    `)
    throw error
  }
}
