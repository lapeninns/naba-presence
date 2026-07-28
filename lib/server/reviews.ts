import "server-only"

import type { TransactionSql } from "postgres"

import { retryDelayMs } from "@/lib/domain/retry"
import { encryptSecret, sha256 } from "@/lib/server/crypto"
import {
  connectionAccessToken,
  googleBatchReviews,
  googleReviews,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"

const RATINGS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  STAR_RATING_UNSPECIFIED: 1,
}

export type LinkedLocation = {
  externalLocationId: string
  locationId: string
  connectionId: string
  googleAccountName: string
  googleLocationName: string
  verified: boolean
}

function syncRetryAt(checkpointId: string, attemptCount: number) {
  const jitterSeed =
    Number.parseInt(checkpointId.replaceAll("-", "").slice(-4), 16) / 65_535
  return new Date(
    Date.now() +
      retryDelayMs(attemptCount, () => jitterSeed, 30_000, 30 * 60_000)
  )
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object"
      )
    : []
}

function detectLanguage(text: string | null): {
  code: string | null
  confidence: number | null
} {
  if (!text?.trim()) return { code: null, confidence: null }
  if (/[\u0600-\u06ff]/u.test(text)) return { code: "ar", confidence: 0.92 }
  if (/[\u0400-\u04ff]/u.test(text)) return { code: "ru", confidence: 0.9 }
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text))
    return { code: "ja", confidence: 0.88 }
  return { code: "en", confidence: 0.72 }
}

function ratingNumber(value: unknown): number {
  if (typeof value === "number") return Math.min(5, Math.max(1, value))
  return RATINGS[String(value)] ?? 1
}

export async function linkedLocations(
  sql: TransactionSql,
  externalLocationIds?: string[]
): Promise<LinkedLocation[]> {
  return sql<LinkedLocation[]>`
    select
      e.id::text as "externalLocationId",
      l.id::text as "locationId",
      e.google_connection_id::text as "connectionId",
      e.google_account_name as "googleAccountName",
      e.google_location_name as "googleLocationName",
      e.verified
    from location_link ll
    join location l on l.id = ll.location_id
    join external_location e on e.id = ll.external_location_id
    where ll.is_active = true
      ${
        externalLocationIds?.length
          ? sql`and e.id in ${sql(externalLocationIds)}`
          : sql``
      }
    order by e.title
  `
}

export async function upsertGoogleReview(
  sql: TransactionSql,
  organisationId: string,
  linked: LinkedLocation,
  payload: Record<string, unknown>
) {
  const name = String(payload.name ?? "")
  const reviewId = String(payload.reviewId ?? name.split("/").pop() ?? "")
  if (!name || !reviewId) return null
  const reviewer = objectValue(payload.reviewer)
  const text =
    typeof payload.comment === "string" && payload.comment.trim()
      ? payload.comment
      : null
  const language = detectLanguage(text)
  const mediaItems = arrayValue(payload.reviewMediaItems)
  const contentHash = sha256(
    JSON.stringify({
      name,
      rating: payload.starRating,
      text,
      updateTime: payload.updateTime,
      reply: payload.reviewReply,
      media: mediaItems,
    })
  )
  const createTime = String(payload.createTime ?? payload.updateTime ?? "")
  const updateTime = String(payload.updateTime ?? payload.createTime ?? "")
  if (!createTime || !updateTime) return null
  const providerReply = objectValue(payload.reviewReply)
  const providerWorkflow =
    providerReply.state === "REJECTED"
      ? "rejected"
      : Object.keys(providerReply).length
        ? "published"
        : "new"

  await sql`
    select set_config('app.provider_reconciliation', 'true', true)
  `

  const [review] = await sql<{ id: string }[]>`
    insert into review (
      organisation_id,
      location_id,
      external_location_id,
      google_review_name_ciphertext,
      google_review_name_hash,
      google_review_id_ciphertext,
      google_review_id_hash,
      reviewer_display_name,
      reviewer_is_anonymous,
      star_rating,
      review_text,
      detected_language_code,
      language_confidence,
      has_media,
      create_time,
      update_time,
      content_hash,
      workflow_status,
      raw_payload,
      raw_content_expires_at
    )
    values (
      ${organisationId},
      ${linked.locationId},
      ${linked.externalLocationId},
      ${encryptSecret(name)},
      ${sha256(name)},
      ${encryptSecret(reviewId)},
      ${sha256(reviewId)},
      ${reviewer.displayName ? String(reviewer.displayName) : null},
      ${reviewer.isAnonymous === true || !reviewer.displayName},
      ${ratingNumber(payload.starRating)},
      ${text},
      ${language.code},
      ${language.confidence},
      ${mediaItems.length > 0},
      ${createTime},
      ${updateTime},
      ${contentHash},
      ${providerWorkflow},
      ${sql.json(JSON.parse(JSON.stringify(payload)))},
      now() + (
        select raw_content_retention_days * interval '1 day'
        from organisation where id = ${organisationId}
      )
    )
    on conflict (organisation_id, google_review_name_hash) do update
    set
      reviewer_display_name = excluded.reviewer_display_name,
      reviewer_is_anonymous = excluded.reviewer_is_anonymous,
      star_rating = excluded.star_rating,
      review_text = excluded.review_text,
      detected_language_code = excluded.detected_language_code,
      language_confidence = excluded.language_confidence,
      has_media = excluded.has_media,
      update_time = excluded.update_time,
      content_hash = excluded.content_hash,
      workflow_status = case
        when excluded.workflow_status in ('published', 'rejected')
          then excluded.workflow_status
        when review.workflow_status in ('published', 'rejected')
          then 'new'
        else review.workflow_status
      end,
      raw_payload = excluded.raw_payload,
      raw_content_expires_at = excluded.raw_content_expires_at
    returning id::text as id
  `

  await sql`delete from review_media_item where review_id = ${review.id}`
  for (const item of mediaItems) {
    const mediaFormat = String(item.mediaFormat ?? "")
    await sql`
      insert into review_media_item (
        organisation_id,
        review_id,
        thumbnail_url,
        thumbnail_label,
        video_url
      )
      values (
        ${organisationId},
        ${review.id},
        ${item.thumbnailUrl ? String(item.thumbnailUrl) : null},
        ${item.thumbnailLabel ? String(item.thumbnailLabel) : null},
        ${
          mediaFormat === "VIDEO" && item.googleUrl
            ? String(item.googleUrl)
            : null
        }
      )
    `
  }

  const reply = providerReply
  if (Object.keys(reply).length) {
    await sql`
      insert into review_reply (
        organisation_id,
        review_id,
        current_body,
        google_reply_state,
        google_policy_violation,
        publish_status,
        google_reply_updated_at
      )
      values (
        ${organisationId},
        ${review.id},
        ${reply.comment ? String(reply.comment) : null},
        ${reply.state ? String(reply.state) : null},
        ${reply.policyViolation ? JSON.stringify(reply.policyViolation) : null},
        ${
          reply.state === "REJECTED"
            ? "rejected"
            : reply.state === "APPROVED"
              ? "published"
              : "accepted"
        },
        ${reply.updateTime ? String(reply.updateTime) : null}
      )
      on conflict (organisation_id, review_id) do update
      set
        current_body = excluded.current_body,
        google_reply_state = excluded.google_reply_state,
        google_policy_violation = excluded.google_policy_violation,
        publish_status = excluded.publish_status,
      google_reply_updated_at = excluded.google_reply_updated_at
    `
  } else {
    await sql`
      update review_reply
      set
        current_body = null,
        google_reply_state = null,
        google_policy_violation = null,
        publish_status = 'deleted',
        google_reply_updated_at = ${updateTime}
      where review_id = ${review.id}
        and publish_status in ('accepted', 'published', 'rejected')
    `
  }
  return review.id
}

export async function syncLinkedLocationBatch(
  sql: TransactionSql,
  organisationId: string,
  locations: LinkedLocation[],
  maxPages = 20
) {
  if (!locations.length) {
    return { upserted: 0, pages: 0, complete: true, locations: 0 }
  }
  if (locations.length > 50) {
    throw new ApiError(
      400,
      "batch_too_large",
      "Google review batches are limited to 50 locations."
    )
  }
  const [first] = locations
  if (
    locations.some(
      (location) =>
        location.connectionId !== first.connectionId ||
        location.googleAccountName !== first.googleAccountName
    )
  ) {
    throw new ApiError(
      400,
      "mixed_google_account_batch",
      "A review batch must contain locations from one Google account."
    )
  }
  const unverified = locations.find((location) => !location.verified)
  if (unverified) {
    throw new ApiError(
      409,
      "location_not_verified",
      "Google review operations require verified locations."
    )
  }

  const checkpoints = new Map<
    string,
    { id: string; attemptCount: number; pageToken: string | null }
  >()
  for (const location of locations) {
    const [checkpoint] = await sql<
      { id: string; attempt_count: number; page_token: string | null }[]
    >`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        started_at,
        attempt_count
      )
      values (
        ${organisationId},
        ${location.externalLocationId},
        'backfill',
        'running',
        now(),
        1
      )
      on conflict (organisation_id, external_location_id, sync_type) do update
      set
        status = 'running',
        started_at = now(),
        finished_at = null,
        attempt_count = sync_checkpoint.attempt_count + 1,
        last_error_code = null
      returning id::text as id, attempt_count, page_token
    `
    checkpoints.set(location.externalLocationId, {
      id: checkpoint.id,
      attemptCount: checkpoint.attempt_count,
      pageToken: checkpoint.page_token,
    })
  }

  const locationByName = new Map(
    locations.flatMap((location) => [
      [location.googleLocationName, location] as const,
      [
        `${location.googleAccountName}/${location.googleLocationName}`,
        location,
      ] as const,
    ])
  )
  const accessToken = await connectionAccessToken(sql, first.connectionId)
  let pageToken =
    [...checkpoints.values()].find((checkpoint) => checkpoint.pageToken)
      ?.pageToken ?? undefined
  let pages = 0
  let upserted = 0
  try {
    do {
      const page = await googleBatchReviews(
        accessToken,
        first.googleAccountName,
        locations.map((location) => location.googleLocationName),
        pageToken
      )
      for (const item of page.locationReviews ?? []) {
        const location = item.name ? locationByName.get(item.name) : undefined
        if (
          location &&
          item.review &&
          (await upsertGoogleReview(sql, organisationId, location, item.review))
        ) {
          upserted += 1
        }
      }
      pageToken = page.nextPageToken
      pages += 1
      await sql`
        update sync_checkpoint
        set page_token = ${pageToken ?? null}
        where id in ${sql([...checkpoints.values()].map((item) => item.id))}
      `
    } while (pageToken && pages < maxPages)

    const complete = !pageToken
    await sql`
      update sync_checkpoint
      set
        status = ${complete ? "succeeded" : "pending"},
        page_token = ${pageToken ?? null},
        finished_at = ${complete ? new Date() : null},
        last_review_update_time = now()
      where id in ${sql([...checkpoints.values()].map((item) => item.id))}
    `
    return {
      upserted,
      pages,
      complete,
      locations: locations.length,
      nextPageToken: pageToken ?? null,
    }
  } catch (error) {
    const errorCode = error instanceof ApiError ? error.code : "sync_failed"
    for (const checkpoint of checkpoints.values()) {
      const retryAt = syncRetryAt(checkpoint.id, checkpoint.attemptCount)
      await sql`
        update sync_checkpoint
        set
          status = 'failed',
          last_error_code = ${errorCode},
          next_attempt_at = ${retryAt},
          finished_at = now()
        where id = ${checkpoint.id}
      `
    }
    return {
      upserted,
      pages,
      complete: false,
      locations: locations.length,
      nextPageToken: pageToken ?? null,
      error: {
        code: errorCode,
        message: error instanceof Error ? error.message : "Review sync failed.",
      },
    }
  }
}

export async function syncLinkedLocation(
  sql: TransactionSql,
  organisationId: string,
  linked: LinkedLocation,
  input: { type: "backfill" | "reconcile" | "notification"; maxPages?: number }
) {
  if (!linked.verified) {
    throw new ApiError(
      409,
      "location_not_verified",
      "Google review operations require a verified location."
    )
  }
  const accessToken = await connectionAccessToken(sql, linked.connectionId)
  const [checkpoint] = await sql<
    { id: string; page_token: string | null; attempt_count: number }[]
  >`
    insert into sync_checkpoint (
      organisation_id,
      external_location_id,
      sync_type,
      status,
      started_at,
      attempt_count
    )
    values (
      ${organisationId},
      ${linked.externalLocationId},
      ${input.type},
      'running',
      now(),
      1
    )
    on conflict (organisation_id, external_location_id, sync_type) do update
    set
      status = 'running',
      started_at = now(),
      finished_at = null,
      attempt_count = sync_checkpoint.attempt_count + 1,
      last_error_code = null
    returning id::text as id, page_token, attempt_count
  `
  let pageToken =
    input.type === "backfill" ? (checkpoint.page_token ?? undefined) : undefined
  let pages = 0
  let upserted = 0
  try {
    do {
      const page = await googleReviews(
        accessToken,
        linked.googleAccountName,
        linked.googleLocationName,
        pageToken
      )
      for (const review of page.reviews ?? []) {
        if (await upsertGoogleReview(sql, organisationId, linked, review)) {
          upserted += 1
        }
      }
      pageToken = page.nextPageToken
      pages += 1
      await sql`
        update sync_checkpoint
        set page_token = ${pageToken ?? null}
        where id = ${checkpoint.id}
      `
    } while (pageToken && pages < (input.maxPages ?? 10))

    const complete = !pageToken
    await sql`
      update sync_checkpoint
      set
        status = ${complete ? "succeeded" : "pending"},
        page_token = ${pageToken ?? null},
        finished_at = ${complete ? new Date() : null},
        last_review_update_time = now()
      where id = ${checkpoint.id}
    `
    return { upserted, pages, complete, nextPageToken: pageToken ?? null }
  } catch (error) {
    const errorCode = error instanceof ApiError ? error.code : "sync_failed"
    const retryAt = syncRetryAt(checkpoint.id, checkpoint.attempt_count)
    await sql`
      update sync_checkpoint
      set
        status = 'failed',
        last_error_code = ${errorCode},
        next_attempt_at = ${retryAt},
        finished_at = now()
      where id = ${checkpoint.id}
    `
    return {
      upserted,
      pages,
      complete: false,
      nextPageToken: pageToken ?? null,
      error: {
        code: errorCode,
        message: error instanceof Error ? error.message : "Review sync failed.",
      },
      retryAt: retryAt.toISOString(),
    }
  }
}
