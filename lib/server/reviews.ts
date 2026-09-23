import "server-only"

import type { TransactionSql } from "postgres"

import { detectLanguage } from "@/lib/domain/language"
import { parseReplyModeration } from "@/lib/domain/reply-state"
import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import { encryptSecret, sha256 } from "@/lib/server/crypto"
import { connectionAccessToken, googleReviews } from "@/lib/server/google"
import { restoreListingAccess } from "@/lib/server/google/connection-failures"
import { getDatabase, withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

const RATINGS: Record<string, number> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
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

function maxReviewUpdateTime(
  reviews: Array<Record<string, unknown>>
): Date | null {
  const timestamps = reviews
    .map((review) =>
      typeof review.updateTime === "string"
        ? Date.parse(review.updateTime)
        : Number.NaN
    )
    .filter(Number.isFinite)
  return timestamps.length ? new Date(Math.max(...timestamps)) : null
}

function minReviewUpdateTime(
  reviews: Array<Record<string, unknown>>
): Date | null {
  const timestamps = reviews
    .map((review) =>
      typeof review.updateTime === "string"
        ? Date.parse(review.updateTime)
        : Number.NaN
    )
    .filter(Number.isFinite)
  return timestamps.length ? new Date(Math.min(...timestamps)) : null
}

export function ratingValue(value: unknown): number | null {
  if (typeof value === "number") return Math.min(5, Math.max(1, value))
  return RATINGS[String(value)] ?? null
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
  const isAnonymous = reviewer.isAnonymous === true || !reviewer.displayName
  const profilePhotoUrl =
    !isAnonymous &&
    typeof reviewer.profilePhotoUrl === "string" &&
    reviewer.profilePhotoUrl.trim()
      ? reviewer.profilePhotoUrl.trim()
      : null
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
  const moderation = parseReplyModeration(payload)
  const providerWorkflow =
    moderation.state === "REJECTED"
      ? "rejected"
      : moderation.comment !== null
        ? "published"
        : "new"

  await sql`
    select set_config('app.provider_reconciliation', 'true', true)
  `

  const [review] = await sql<{ id: string; erasedAt: Date | null }[]>`
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
      reviewer_profile_photo_url,
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
      ${isAnonymous},
      ${profilePhotoUrl},
      ${ratingValue(payload.starRating)},
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
      -- Google keeps serving a review long after its subject has been erased,
      -- so an unguarded re-ingestion silently reverses a fulfilled erasure.
      -- The guard keys on the explicit marker, never on "the stored content
      -- is null": the retention cron nulls the same columns, and freezing
      -- those rows would stop a live review being refreshed ever again.
      reviewer_display_name = case
        when review.erased_at is null then excluded.reviewer_display_name
        else review.reviewer_display_name
      end,
      reviewer_is_anonymous = excluded.reviewer_is_anonymous,
      reviewer_profile_photo_url = case
        when review.erased_at is null
          then excluded.reviewer_profile_photo_url
        else review.reviewer_profile_photo_url
      end,
      star_rating = excluded.star_rating,
      review_text = case
        when review.erased_at is null then excluded.review_text
        else review.review_text
      end,
      detected_language_code = excluded.detected_language_code,
      language_confidence = excluded.language_confidence,
      has_media = case
        when review.erased_at is null then excluded.has_media
        else review.has_media
      end,
      update_time = excluded.update_time,
      content_hash = excluded.content_hash,
      workflow_status = case
        when excluded.workflow_status in ('published', 'rejected')
          then excluded.workflow_status
        when review.workflow_status in ('published', 'rejected')
          then 'new'
        else review.workflow_status
      end,
      raw_payload = case
        when review.erased_at is null then excluded.raw_payload
        else review.raw_payload
      end,
      raw_content_expires_at = excluded.raw_content_expires_at,
      provider_deleted_at = null
    returning id::text as id, erased_at as "erasedAt"
  `

  // Skipped wholesale rather than guarded column by column: the delete plus
  // re-insert below would re-create every photo the erasure removed.
  if (!review.erasedAt) {
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
  }

  if (moderation.comment !== null) {
    await sql`
      insert into review_reply (
        organisation_id,
        review_id,
        current_body,
        google_reply_state,
        google_policy_violation,
        publish_status,
        google_reply_updated_at,
        first_published_at
      )
      values (
        ${organisationId},
        ${review.id},
        ${moderation.comment},
        ${moderation.state},
        ${moderation.policyViolation},
        ${
          moderation.state === "REJECTED"
            ? "rejected"
            : moderation.state === "APPROVED"
              ? "published"
              : "accepted"
        },
        ${moderation.updateTime},
        ${moderation.updateTime}
      )
      on conflict (organisation_id, review_id) do update
      set
        current_body = excluded.current_body,
        google_reply_state = excluded.google_reply_state,
        google_policy_violation = excluded.google_policy_violation,
        publish_status = excluded.publish_status,
        google_reply_updated_at = excluded.google_reply_updated_at,
        first_published_at = coalesce(
          review_reply.first_published_at,
          excluded.google_reply_updated_at
        )
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

export type SyncOutcome = {
  status: "succeeded" | "partial" | "failed"
  pages: number
  upserted: number
  hasMore: boolean
  errorCode?: string
}

type SyncType = "backfill" | "reconcile" | "notification" | "sweep"
type SyncHeader = {
  linked: LinkedLocation
  checkpointId: string
  attemptCount: number
  consecutiveFailureCount: number
  pageToken: string | null
  sweepStartedAt: Date | null
  highWaterUpdateTime: Date | null
  errorCode: string | null
}

/**
 * How many consecutive failures a checkpoint may accumulate before it is
 * dead-lettered. 'failed' with a due `next_attempt_at` is a claim state
 * (0029 `claim_due_jobs`), so without a terminal state an error no retry can
 * fix is re-driven every 15-30 minutes for ever.
 */
const MAX_CONSECUTIVE_FAILURES = 10

/** Errors an operator has to clear at Google; retrying cannot resolve them. */
function isPermanentSyncFailure(errorCode: string, status?: number) {
  return (
    errorCode === "location_not_verified" || status === 404 || status === 410
  )
}

/**
 * A cursor Google rejects outright is dead, and re-walking from page one is
 * safe because the upsert is idempotent. 401/403 are grant faults and 408/429
 * are transient, so both keep the pagination progress already made.
 */
function discardsPageToken(status?: number) {
  return (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    ![401, 403, 408, 429].includes(status)
  )
}

export async function syncLinkedLocation(input: {
  organisationId: string
  externalLocationId: string
  type: SyncType
  maxPages: number
  /** Correlates the audit rows this sync writes with the caller's request. */
  requestId?: string
  /** Epoch ms after which paging stops between pages (the caller's budget). */
  deadline?: number
}): Promise<SyncOutcome> {
  const header = await withTenant<SyncHeader | null>(
    input.organisationId,
    async (sql) => {
      const [linked] = await linkedLocations(sql, [input.externalLocationId])
      if (!linked) {
        return null
      }
      const [checkpoint] = await sql<
        {
          id: string
          page_token: string | null
          attempt_count: number
          consecutive_failure_count: number
        }[]
      >`
        insert into sync_checkpoint (
          organisation_id,
          external_location_id,
          sync_type,
          status,
          started_at,
          attempt_count,
          lease_expires_at
        )
        values (
          ${input.organisationId},
          ${input.externalLocationId},
          ${input.type},
          'running',
          now(),
          1,
          now() + interval '15 minutes'
        )
        on conflict (organisation_id, external_location_id, sync_type) do update
        set
          status = 'running',
          started_at = now(),
          finished_at = null,
          next_attempt_at = null,
          attempt_count = sync_checkpoint.attempt_count + 1,
          last_error_code = null,
          -- Paging runs outside this transaction; without a lease a crash
          -- strands the row at 'running' (0029, reclaim_expired_jobs).
          lease_expires_at = now() + interval '15 minutes'
        returning
          id::text as id,
          page_token,
          attempt_count,
          consecutive_failure_count
      `
      // A sweep resumes across claims, so the window it tombstones against
      // lives on the checkpoint rather than in this process: a fresh run (no
      // cursor) opens a new window, a resumed one keeps the window it started.
      let sweepStartedAt: Date | null = null
      if (input.type === "sweep") {
        const [sweep] = await sql<{ sweepStartedAt: Date }[]>`
          update sync_checkpoint
          set sweep_started_at = ${
            checkpoint.page_token === null
              ? sql`now()`
              : sql`coalesce(sweep_started_at, now())`
          }
          where id = ${checkpoint.id}
          returning sweep_started_at as "sweepStartedAt"
        `
        sweepStartedAt = sweep.sweepStartedAt
      }
      const [watermark] = await sql<{ highWaterUpdateTime: Date | null }[]>`
        select max(high_water_update_time) as "highWaterUpdateTime"
        from sync_checkpoint
        where external_location_id = ${input.externalLocationId}
      `
      return {
        linked,
        checkpointId: checkpoint.id,
        attemptCount: checkpoint.attempt_count,
        consecutiveFailureCount: checkpoint.consecutive_failure_count,
        pageToken: checkpoint.page_token,
        sweepStartedAt,
        highWaterUpdateTime: watermark.highWaterUpdateTime,
        errorCode: linked.verified ? null : "location_not_verified",
      }
    }
  )

  if (!header) {
    return {
      status: "failed",
      pages: 0,
      upserted: 0,
      hasMore: false,
      errorCode: "location_not_linked",
    }
  }

  // Both checkpointed enumerations resume from their persisted cursor. A sweep
  // that restarts at page one can never finish a location with more reviews
  // than one claim's page budget covers.
  let pageToken =
    input.type === "backfill" || input.type === "sweep"
      ? (header.pageToken ?? undefined)
      : undefined
  let pages = 0
  let upserted = 0

  const settleFailure = async (
    errorCode: string,
    settlement: { status?: number; parked?: boolean } = {}
  ): Promise<SyncOutcome> => {
    // Neither of these is a failure the cap should count. A sweep that ran
    // out of page budget made progress, and a grant awaiting reconnection is
    // blocked on a person rather than on a budget: burning the cap on either
    // dead-letters work that was only ever waiting.
    const reconnectBlocked = errorCode === "google_reconnect_required"
    const failureCount =
      settlement.parked || reconnectBlocked
        ? header.consecutiveFailureCount
        : header.consecutiveFailureCount + 1
    const dead =
      !settlement.parked &&
      (isPermanentSyncFailure(errorCode, settlement.status) ||
        (!reconnectBlocked && failureCount >= MAX_CONSECUTIVE_FAILURES))
    const discardToken = dead || discardsPageToken(settlement.status)
    const retryAt =
      dead || settlement.parked
        ? null
        : syncRetryAt(header.checkpointId, header.attemptCount)
    await withTenant(input.organisationId, async (sql) => {
      const settled = await sql<{ id: string }[]>`
        update sync_checkpoint
        set
          status = ${dead ? "dead" : "failed"},
          last_error_code = ${errorCode},
          next_attempt_at = ${retryAt},
          consecutive_failure_count = ${failureCount},
          page_token = case
            when ${discardToken}::boolean then null else page_token
          end,
          finished_at = now(),
          lease_expires_at = null
        where id = ${header.checkpointId}
          and status <> 'cancelled'
        returning id::text as id
      `
      if (dead && settled.length) {
        await writeAudit(sql, {
          organisationId: input.organisationId,
          action: "sync.checkpoint.dead",
          subjectType: "external_location",
          subjectId: input.externalLocationId,
          requestId: input.requestId ?? null,
          metadata: {
            syncType: input.type,
            errorCode,
            consecutiveFailures: failureCount,
            locationId: header.linked.locationId,
          },
        })
      }
    })
    return {
      status: "failed",
      pages,
      upserted,
      hasMore: pageToken !== undefined,
      errorCode,
    }
  }

  if (header.errorCode) {
    return settleFailure(header.errorCode)
  }

  try {
    const accessToken = await connectionAccessToken(
      getDatabase(),
      input.organisationId,
      header.linked.connectionId
    )
    do {
      const page = await googleReviews(
        accessToken,
        header.linked.googleAccountName,
        header.linked.googleLocationName,
        pageToken,
        { connectionKey: header.linked.connectionId }
      )
      const nextPageToken = page.nextPageToken
      const pageHighWater = maxReviewUpdateTime(page.reviews ?? [])
      const pageOldestUpdateTime = minReviewUpdateTime(page.reviews ?? [])
      const pageReviewNameHashes: string[] = []
      if (input.type === "sweep") {
        const pageSeen = new Set<string>()
        for (const review of page.reviews ?? []) {
          if (typeof review.name !== "string" || !review.name) continue
          const hash = sha256(review.name)
          if (pageSeen.has(hash)) continue
          pageSeen.add(hash)
          pageReviewNameHashes.push(hash)
        }
      }
      const pageUpserted = await withTenant(
        input.organisationId,
        async (sql) => {
          let committed = 0
          const seen = new Set<string>()
          for (const review of page.reviews ?? []) {
            const hash = sha256(String(review.name ?? review.reviewId))
            if (seen.has(hash)) continue
            seen.add(hash)
            if (
              await upsertGoogleReview(
                sql,
                input.organisationId,
                header.linked,
                review
              )
            ) {
              committed += 1
            }
          }
          if (pageReviewNameHashes.length) {
            // The seen-set has to outlive the request: a sweep resumed on a
            // later claim cannot tombstone against an in-memory set.
            await sql`
              update review
              set last_seen_at = now()
              where external_location_id = ${input.externalLocationId}
                and google_review_name_hash in ${sql(pageReviewNameHashes)}
            `
          }
          // Provider totals describe the complete enumeration and are only
          // authoritative on its first page. A resumed request starts with
          // `pages === 0` too, so using that condition alone allowed a later
          // page with omitted totals to erase the first page's evidence.
          if (pages === 0 && header.pageToken === null) {
            await sql`
              update external_location
              set
                google_average_rating = coalesce(
                  ${page.averageRating ?? null},
                  google_average_rating
                ),
                google_total_review_count = coalesce(
                  ${page.totalReviewCount ?? null},
                  google_total_review_count
                ),
                provider_totals_refreshed_at = case
                  when ${page.averageRating ?? null}::numeric is not null
                    or ${page.totalReviewCount ?? null}::integer is not null
                  then now()
                  else provider_totals_refreshed_at
                end
              where id = ${input.externalLocationId}
            `
          }
          await sql`
            update sync_checkpoint
            set
              page_token = ${nextPageToken ?? null},
              high_water_update_time = case
                when ${pageHighWater}::timestamptz is null
                  then high_water_update_time
                else greatest(
                  coalesce(
                    high_water_update_time,
                    'epoch'::timestamptz
                  ),
                  ${pageHighWater}
                )
              end
            where id = ${header.checkpointId}
          `
          return committed
        }
      )
      upserted += pageUpserted
      pages += 1
      const crossedReconcileFloor =
        input.type === "reconcile" &&
        header.highWaterUpdateTime !== null &&
        pageOldestUpdateTime !== null &&
        pageOldestUpdateTime.getTime() <
          header.highWaterUpdateTime.getTime() - 24 * 60 * 60 * 1000
      pageToken = crossedReconcileFloor ? undefined : nextPageToken
    } while (
      pageToken &&
      pages < input.maxPages &&
      (input.deadline === undefined || Date.now() < input.deadline)
    )

    const hasMore = Boolean(pageToken)
    if (input.type === "sweep" && hasMore) {
      // Terminal on purpose: the runner claims by status plus a due
      // next_attempt_at, and re-driving a five-page claim against a location
      // that needs more pages never finishes. The cursor and the tombstone
      // window survive, so the next sweep resumes where this one stopped.
      return settleFailure("sweep_incomplete", { parked: true })
    }
    if (input.type === "sweep" && header.sweepStartedAt) {
      const [evidence] = await withTenant(
        input.organisationId,
        (sql) => sql<
          {
            expectedCount: number | null
            seenCount: number
            storedCount: number
          }[]
        >`
          select
            e.google_total_review_count as "expectedCount",
            count(r.id) filter (
              where r.last_seen_at >= ${header.sweepStartedAt}
            )::integer as "seenCount",
            count(r.id)::integer as "storedCount"
          from external_location e
          left join review r on r.external_location_id = e.id
          where e.id = ${input.externalLocationId}
          group by e.google_total_review_count
        `
      )
      const expectedCount = evidence?.expectedCount ?? null
      const seenCount = evidence?.seenCount ?? 0
      const storedCount = evidence?.storedCount ?? 0
      const countMismatch = expectedCount !== null && seenCount !== expectedCount
      const incompleteEnumerationWithoutProviderTotal =
        expectedCount === null && seenCount < storedCount

      if (countMismatch || incompleteEnumerationWithoutProviderTotal) {
        log.warn("review.sweep_provider_count_mismatch", {
          organisationId: input.organisationId,
          externalLocationId: input.externalLocationId,
          expectedCount,
          seenCount,
          storedCount,
        })
        return settleFailure("sweep_provider_count_mismatch")
      }
    }
    await withTenant(input.organisationId, async (sql) => {
      if (input.type === "sweep" && header.sweepStartedAt) {
        const tombstoned = await sql<{ id: string }[]>`
          update review
          set provider_deleted_at = now()
          where external_location_id = ${input.externalLocationId}
            and provider_deleted_at is null
            and update_time < ${header.sweepStartedAt}
            and (
              last_seen_at is null
              or last_seen_at < ${header.sweepStartedAt}
            )
          returning id::text as id
        `
        await writeAudit(sql, {
          organisationId: input.organisationId,
          action: "review.provider_deleted",
          subjectType: "external_location",
          subjectId: input.externalLocationId,
          requestId: input.requestId ?? null,
          metadata: {
            tombstoned: tombstoned.length,
            locationId: header.linked.locationId,
          },
        })
      }
      // Nothing ever claims a reconcile checkpoint (claim_due_jobs takes only
      // 'backfill' and 'sweep') and the next tick restarts at page one anyway,
      // so parking one at 'pending' with a due next_attempt_at would only
      // inflate the operator's backlog. hasMore reaches the caller instead.
      const resumable = hasMore && input.type !== "reconcile"
      await sql`
        update sync_checkpoint
        set
          status = ${resumable ? "pending" : "succeeded"},
          page_token = ${resumable ? (pageToken ?? null) : null},
          next_attempt_at = ${
            resumable
              ? syncRetryAt(header.checkpointId, header.attemptCount)
              : null
          },
          consecutive_failure_count = 0,
          finished_at = ${resumable ? null : new Date()},
          last_review_update_time = now(),
          -- Every page of this run answered, so the location's reviews were
          -- checked against Google just now, whether or not more pages
          -- remain. Only this path moves it: a failed run leaves it alone.
          last_succeeded_at = now(),
          lease_expires_at = null
        where id = ${header.checkpointId}
          and status <> 'cancelled'
      `
      // Google answered for this location, so any listing-level access loss
      // recorded earlier is over.
      await restoreListingAccess(sql, input.externalLocationId)
    })
    return {
      status: hasMore ? "partial" : "succeeded",
      pages,
      upserted,
      hasMore,
    }
  } catch (error) {
    return settleFailure(
      error instanceof ApiError ? error.code : "sync_failed",
      { status: error instanceof ApiError ? error.status : undefined }
    )
  }
}
