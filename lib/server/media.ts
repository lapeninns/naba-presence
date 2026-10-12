import "server-only"

import type { TransactionSql } from "postgres"

import {
  decodeMediaCursor,
  encodeMediaCursor,
  MAX_MEDIA_UPLOAD_BYTES,
  MIN_PHOTO_UPLOAD_BYTES,
  mediaCreateSchema,
  mediaUploadFieldsSchema,
  type MediaCreateInput,
  type MediaItemWire,
  type MediaOwnership,
  type MediaResolution,
  type MediaUnresolvedCreateWire,
  type MediaUploadFields,
} from "@/lib/contracts/location-media"
import {
  GOOGLE_MEDIA_CATEGORIES,
  type GoogleMediaCategory,
} from "@/lib/domain/google-contract"
import {
  MEDIA_CREATE_TIME_SKEW_MS,
  matchCreatedMedia,
  type MediaCreateIntent,
  type MediaUploadPhase,
} from "@/lib/domain/media-reconcile"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { jsonColumnOrNull, withTenant } from "@/lib/server/db"
import { gbpWritesEnabled, getServerEnv } from "@/lib/server/env"
import {
  attemptStore,
  idempotencyKey,
  loadLinkedLocation,
  requireGbpWrite,
  requirePublishGrant,
  runGbpWrite,
  type GbpAuditSpec,
  type GbpReadback,
  type GbpWriteResult,
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import {
  createGoogleMediaItem,
  deleteGoogleMediaItem,
  getGoogleMediaItem,
  GoogleMutationAmbiguousError,
  googleMediaItems,
  patchGoogleMediaItem,
  sendGoogleMediaBytes,
  startGoogleMediaUpload,
} from "@/lib/server/google"
import type { OperationSummary } from "@/lib/contracts/mutation-operations"
import { ApiError } from "@/lib/server/http"
import {
  operationSummary,
  requestScopedKeyPart,
  settleRecoveredOperations,
} from "@/lib/server/mutation-operations"
import {
  storeSettle,
  type RecoveryAdapter,
  type RecoveryAttempt,
} from "@/lib/server/mutation-recovery"
import type { Session } from "@/lib/server/session"
import { DEFAULT_MEDIA_PAGE_SIZE, MAX_MEDIA_PAGE_SIZE } from "@/lib/media-page"

// Request shapes live in the contract; the old names stay exported from here
// for one sprint so existing imports keep working.
export { MAX_MEDIA_UPLOAD_BYTES, mediaCreateSchema, mediaUploadFieldsSchema }

const MEDIA_UPLOAD_TYPES = {
  PHOTO: ["image/jpeg", "image/png"],
  VIDEO: ["video/mp4", "video/quicktime"],
} as const

/** A Google media item as the API returns it (untyped beyond object shape). */
type GoogleMediaItem = Record<string, unknown>

const NOT_LINKED = { message: "Link this location to Google first." }

// ---------------------------------------------------------------------------
// Google media item helpers
// ---------------------------------------------------------------------------

/** `locationAssociation.category` when Google sent a string one. */
function mediaCategoryOf(item: GoogleMediaItem): string | null {
  const association = item.locationAssociation
  if (
    !association ||
    typeof association !== "object" ||
    !("category" in association)
  ) {
    return null
  }
  return typeof association.category === "string" ? association.category : null
}

function mediaHash(item: GoogleMediaItem) {
  return sha256(
    JSON.stringify({
      category: mediaCategoryOf(item),
      description: item.description ?? null,
      googleUrl: item.googleUrl ?? null,
      mediaFormat: item.mediaFormat ?? null,
      sourceUrl: item.sourceUrl ?? null,
    })
  )
}

function mediaTarget(linked: LinkedLocation) {
  return {
    accountName: linked.googleAccountName,
    locationName: linked.googleLocationName,
  }
}

function mediaTransport(linked: LinkedLocation) {
  return { connectionKey: linked.googleConnectionId }
}

// ---------------------------------------------------------------------------
// Cache (gbp_media_item)
// ---------------------------------------------------------------------------

async function upsertCachedMediaItem(
  sql: TransactionSql,
  scope: {
    organisationId: string
    locationId: string
    externalLocationId: string
  },
  ownership: "merchant" | "customer",
  item: GoogleMediaItem
) {
  if (typeof item.name !== "string" || typeof item.mediaFormat !== "string")
    return
  const text = (value: unknown) => (typeof value === "string" ? value : null)
  await sql`
    insert into gbp_media_item (
      organisation_id, location_id, external_location_id, google_media_name,
      ownership, media_format, category, source_url, google_url,
      thumbnail_url, description, attribution, dimensions, insights,
      google_hash, google_create_time, observed_at, deleted_at, payload_expires_at
    ) values (
      ${scope.organisationId}, ${scope.locationId}, ${scope.externalLocationId}, ${item.name},
      ${ownership}, ${item.mediaFormat}, ${mediaCategoryOf(item)},
      ${text(item.sourceUrl)}, ${text(item.googleUrl)}, ${text(item.thumbnailUrl)},
      ${text(item.description)},
      ${jsonColumnOrNull(sql, item.attribution)},
      ${jsonColumnOrNull(sql, item.dimensions)},
      ${jsonColumnOrNull(sql, item.insights)},
      ${mediaHash(item)}, ${text(item.createTime)}, now(), null,
      now() + interval '30 days'
    )
    on conflict (organisation_id, google_media_name) do update set
      ownership = excluded.ownership, media_format = excluded.media_format,
      category = excluded.category, source_url = excluded.source_url,
      google_url = excluded.google_url, thumbnail_url = excluded.thumbnail_url,
      description = excluded.description, attribution = excluded.attribution,
      dimensions = excluded.dimensions, insights = excluded.insights,
      google_hash = excluded.google_hash, observed_at = now(), deleted_at = null,
      payload_expires_at = excluded.payload_expires_at
  `
}

async function cacheMedia(
  organisationId: string,
  locationId: string,
  externalLocationId: string,
  merchant: GoogleMediaItem[],
  customer: GoogleMediaItem[]
) {
  return withTenant(organisationId, async (sql) => {
    await sql`update gbp_media_item set deleted_at = now() where location_id = ${locationId} and deleted_at is null`
    const scope = { organisationId, locationId, externalLocationId }
    for (const [ownership, items] of [
      ["merchant", merchant],
      ["customer", customer],
    ] as const) {
      for (const item of items) {
        await upsertCachedMediaItem(sql, scope, ownership, item)
      }
    }
  })
}

/** Serve the DB cache instead of re-listing Google on every Photos view. */
const MEDIA_CACHE_TTL_MS = 5 * 60 * 1000

/** One listed row, exactly as the contract's `mediaItemSchema` receives it. */
type MediaListItem = MediaItemWire

export type MediaOwnershipFilter = MediaOwnership

function parseMediaCursor(
  value: string | undefined,
  locationId: string,
  filters: { category?: GoogleMediaCategory; ownership?: MediaOwnershipFilter }
) {
  if (!value) return null
  const cursor = decodeMediaCursor(value)
  if (!cursor)
    throw new ApiError(400, "invalid_cursor", "The media cursor is invalid.")
  if (
    cursor.locationId !== locationId ||
    cursor.category !== (filters.category ?? null) ||
    cursor.ownershipFilter !== (filters.ownership ?? null)
  )
    throw new ApiError(
      400,
      "invalid_cursor",
      "This cursor belongs to another list."
    )
  return cursor
}

/**
 * One keyset page in the library's order: by ownership name (customer, then
 * merchant), newest Google create time first (none last), then id. A refresh
 * re-upserts rows by Google name and keeps their ids, so a cursor survives
 * it.
 */
async function readMediaPage(
  organisationId: string,
  locationId: string,
  cursor: string | undefined,
  pageSize: number,
  filters: {
    category?: GoogleMediaCategory
    ownership?: MediaOwnershipFilter
  } = {}
): Promise<{
  items: MediaListItem[]
  total: number
  nextCursor: string | null
}> {
  const after = parseMediaCursor(cursor, locationId, filters)
  return withTenant(organisationId, async (sql) => {
    const categoryFilter = filters.category
      ? sql`and category = ${filters.category}`
      : sql``
    const ownershipFilter = filters.ownership
      ? sql`and ownership = ${filters.ownership}`
      : sql``
    const [countRow] = await sql<{ total: number }[]>`
      select count(*)::integer as total
      from gbp_media_item
      where location_id = ${locationId} and deleted_at is null
      ${categoryFilter}
      ${ownershipFilter}
    `
    const total = countRow?.total ?? 0
    // Within the cursor's ownership: older create times, then same time and
    // a later id, then the undated items that sort last.
    const keyset = !after
      ? sql``
      : after.at === null
        ? sql`and (ownership > ${after.ownership} or (ownership = ${after.ownership}
            and google_create_time is null and id > ${after.id}::uuid))`
        : sql`and (ownership > ${after.ownership} or (ownership = ${after.ownership} and (
            google_create_time < ${after.at}::text::timestamptz
            or (google_create_time = ${after.at}::text::timestamptz and id > ${after.id}::uuid)
            or google_create_time is null
          )))`
    const rows = await sql<(MediaListItem & { cursorAt: string | null })[]>`
      select id::text as id, google_media_name as "googleMediaName",
        ownership, media_format as "mediaFormat", category, source_url as "sourceUrl",
        google_url as "googleUrl", thumbnail_url as "thumbnailUrl", description,
        attribution, dimensions, insights, google_hash as "googleHash",
        google_create_time as "createTime",
        to_char(google_create_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorAt"
      from gbp_media_item
      where location_id = ${locationId} and deleted_at is null
      ${categoryFilter}
      ${ownershipFilter}
      ${keyset}
      order by ownership, google_create_time desc nulls last, id
      limit ${pageSize + 1}
    `
    const page = rows.slice(0, pageSize)
    const last = page.at(-1)
    const nextCursor =
      rows.length > pageSize && last
        ? encodeMediaCursor({
            version: 1,
            locationId,
            category: filters.category ?? null,
            ownershipFilter: filters.ownership ?? null,
            ownership: last.ownership,
            at: last.cursorAt,
            id: last.id,
          })
        : null
    const items = page.map((row): MediaListItem => {
      // The cursor's copy of the create time is not part of the row contract.
      const { cursorAt, ...item } = row
      void cursorAt
      return item
    })
    return { items, total, nextCursor }
  })
}

async function mediaCacheStatus(sql: TransactionSql, locationId: string) {
  const [row] = await sql<{ count: number; observedAt: string | null }[]>`
    select
      count(*)::integer as count,
      max(observed_at)::text as "observedAt"
    from gbp_media_item
    where location_id = ${locationId} and deleted_at is null
  `
  return { count: row?.count ?? 0, observedAt: row?.observedAt ?? null }
}

function shouldSyncMediaCache(input: {
  refresh: boolean
  count: number
  observedAt: string | null
}): boolean {
  if (input.refresh) return true
  if (input.count === 0) return true
  if (!input.observedAt) return true
  const age = Date.now() - new Date(input.observedAt).getTime()
  return !Number.isFinite(age) || age > MEDIA_CACHE_TTL_MS
}

export async function loadMedia(
  organisationId: string,
  session: Session,
  locationId: string,
  options: {
    cursor?: string
    pageSize?: number
    refresh?: boolean
    category?: GoogleMediaCategory
    ownership?: MediaOwnershipFilter
  } = {}
) {
  const pageSize = Math.min(
    MAX_MEDIA_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize ?? DEFAULT_MEDIA_PAGE_SIZE))
  )
  const refresh = Boolean(options.refresh)
  const category = options.category
  const ownership = options.ownership

  const { linked, cache, unresolvedCreates } = await withTenant(
    organisationId,
    async (sql) => ({
      linked: await loadLinkedLocation(sql, session, locationId, {
        notLinked: NOT_LINKED,
      }),
      cache: await mediaCacheStatus(sql, locationId),
      unresolvedCreates: await loadUnresolvedCreates(sql, locationId),
    })
  )

  // Only the first page may re-read Google: loading more pages the cache
  // the first page read, so the rows below a cursor do not move under it.
  if (
    !options.cursor &&
    shouldSyncMediaCache({
      refresh,
      count: cache.count,
      observedAt: cache.observedAt,
    })
  ) {
    const token = await linked.accessToken()
    const list = (customer: boolean) =>
      googleMediaItems(
        token,
        { ...mediaTarget(linked), customer },
        mediaTransport(linked)
      )
    const [merchant, customer] = await Promise.all([list(false), list(true)])
    await cacheMedia(
      organisationId,
      locationId,
      linked.externalLocationId,
      merchant,
      customer
    )
  }

  const env = getServerEnv()
  const { items, total, nextCursor } = await readMediaPage(
    organisationId,
    locationId,
    options.cursor,
    pageSize,
    { category, ownership }
  )
  return {
    canPublish: linked.canPublish,
    writesEnabled: gbpWritesEnabled(env, "media"),
    categories: GOOGLE_MEDIA_CATEGORIES,
    items,
    total,
    pageSize,
    nextCursor,
    category: category ?? null,
    ownership: ownership ?? null,
    unresolvedCreates,
  }
}

// ---------------------------------------------------------------------------
// Writes (gbp_media_mutation through lib/server/gbp-write)
// ---------------------------------------------------------------------------

/**
 * gbp_media_mutation as an AttemptStore. Its CHECK constraint only knows
 * started/succeeded/failed/ambiguous (plus needs_resolution, 0093, which only
 * this module writes), so the in-flight vocabulary maps onto `started`; the
 * table has no validated_at / http-status / response-hash columns.
 */
const mediaAttemptRows = attemptStore({
  table: "gbp_media_mutation",
  statuses: {
    validating: "started",
    validated: "started",
    publishing: "started",
  },
  columns: {
    errorCode: "last_error_code",
    response: "google_response",
    startedAt: "started_at",
  },
})

/**
 * The media attempt store, with two create rules on top of the shared one:
 *
 * - start: the unresolved-create guard runs in the transaction that inserts
 *   the attempt, under a transaction lock on (location, content), so two
 *   creates of the same content cannot both pass it and both be sent.
 * - settle: a person's verdict (`resolution`, resolveMediaCreate) is final
 *   for the request it raced. A failure settles nothing over it; a success
 *   over `abandoned` is refused with a conflict, because the content is
 *   already unblocked and Google says the photo is there.
 */
const mediaAttempts: typeof mediaAttemptRows = {
  ...mediaAttemptRows,
  async start(sql, input) {
    const {
      operation,
      location_id: locationId,
      content_sha256: content,
    } = input.intent
    if (
      operation === "create" &&
      typeof locationId === "string" &&
      typeof content === "string"
    ) {
      await sql`
        select pg_advisory_xact_lock(
          hashtext(${`gbp_media_create:${locationId}:${content}`})
        )
      `
      await requireNoUnresolvedCreate(sql, locationId, content)
    }
    return mediaAttemptRows.start(sql, input)
  },
  async settle(sql, input) {
    const [row] = await sql<{ resolution: string | null }[]>`
      select resolution from gbp_media_mutation where id = ${input.id} for update
    `
    if (row?.resolution && input.expectedStatus === undefined) {
      if (input.status !== "succeeded") return false
      if (row.resolution === "abandoned") {
        throw new ApiError(
          409,
          "media_resolution_conflict",
          "This was marked as not added while it was still being sent, and Google has now added it. Check the listing’s photos before adding it again.",
          { details: { attemptId: input.id } }
        )
      }
    }
    return mediaAttemptRows.settle(sql, input)
  },
}

type MediaOperation = "create" | "update" | "delete"

type MediaWriteScope = {
  organisationId: string
  session: Session
  locationId: string
  requestId: string
  /**
   * A token the client mints per user intent and resends unchanged when a
   * response is lost (the `Idempotency-Key` header). With it, a retry finds
   * the first attempt instead of uploading again; a deliberate second upload
   * carries a new token.
   */
  intentId?: string | null
  /** Recorded on the receipt: the approval the write went out under (a bulk batch). */
  approvalRef?: string | null
}

type MediaWriteResult = {
  id: string
  status: string
  idempotent: boolean
  operation?: OperationSummary
}

const MEDIA_PAUSED = {
  status: 503,
  code: "media_paused",
  message: "Google media writes are paused.",
}

/** Capability + kill switch (503 media_paused), then the publish grant (403). */
function requireMediaWrite(linked: LinkedLocation) {
  requireGbpWrite(getServerEnv(), "media", MEDIA_PAUSED)
  requirePublishGrant(linked, {
    code: "publish_not_allowed",
    message: "You cannot publish for this location.",
  })
}

async function linkedForWrite(
  sql: TransactionSql,
  session: Session,
  locationId: string
) {
  const linked = await loadLinkedLocation(sql, session, locationId, {
    notLinked: NOT_LINKED,
  })
  requireMediaWrite(linked)
  return linked
}

type StoredMediaItem = {
  id: string
  googleMediaName: string
  ownership: string
  googleHash: string
}

/** Merchant-owned cached item or 404 / 409 (customer media is read-only). */
async function storedMerchantMedia(
  sql: TransactionSql,
  locationId: string,
  mediaId: string
): Promise<StoredMediaItem> {
  const [item] = await sql<StoredMediaItem[]>`
    select id::text as id, google_media_name as "googleMediaName", ownership, google_hash as "googleHash"
    from gbp_media_item where id = ${mediaId} and location_id = ${locationId} and deleted_at is null`
  if (!item) throw new ApiError(404, "media_not_found", "Media item not found.")
  if (item.ownership !== "merchant")
    throw new ApiError(
      409,
      "customer_media_read_only",
      "Customer media is read-only."
    )
  return item
}

/** Context + gates + the cached item, with the client's hash pinned (409 media_stale). */
async function mutableMediaItem(
  input: {
    organisationId: string
    session: Session
    locationId: string
    mediaId: string
    expectedGoogleHash: string
  },
  staleMessage: string
) {
  return withTenant(input.organisationId, async (sql) => {
    const linked = await linkedForWrite(sql, input.session, input.locationId)
    const item = await storedMerchantMedia(sql, input.locationId, input.mediaId)
    if (item.googleHash !== input.expectedGoogleHash) {
      throw new ApiError(409, "media_stale", staleMessage)
    }
    return { linked, item }
  })
}

/** Pre-flight (validate phase): Google must still match the hash the client approved. */
async function requireFreshGoogleMedia(
  linked: LinkedLocation,
  googleMediaName: string,
  expectedGoogleHash: string
) {
  const token = await linked.accessToken()
  const current = await getGoogleMediaItem(
    token,
    googleMediaName,
    mediaTransport(linked)
  )
  if (mediaHash(current) !== expectedGoogleHash) {
    throw new ApiError(
      409,
      "media_stale",
      "Google changed this media item. Refresh first."
    )
  }
}

/**
 * One gbp_media_mutation write through the shared pipeline.
 *
 * - onExisting "replay": the key includes the client's intent id (the
 *   `Idempotency-Key` header) or, without one, the request id, so any
 *   existing row (whatever its status) is returned as idempotent. A client
 *   that retries a lost response under the same intent replays the receipt
 *   instead of uploading and creating the item a second time, and the same
 *   intent with different content is a 409 intent_conflict
 *   (lib/server/mutation-operations.ts). Without an intent every request is
 *   a fresh key, as before. A create's key also carries its content hash.
 *   Content alone is not a key -- it would swallow a deliberate second
 *   upload of the same photo, and under "replay" a settled failure for that
 *   key could never be retried.
 * - onAmbiguous "fail": an ambiguous provider call settles `ambiguous` and
 *   rethrows. An uncertain create reconciles itself against the live media
 *   list first (createMediaItem), and one that cannot is moved on to
 *   `needs_resolution` here.
 */
async function runMediaWrite<TResponse, TReadback = never>(
  scope: MediaWriteScope,
  write: {
    operation: MediaOperation
    mediaItemId: string | null
    expectedGoogleHash: string | null
    /** A create's content (bytes or source URL), for its key and the unresolved-create guard. */
    contentSha256?: string
    payload: unknown
    failureCode: string
    validate?: () => Promise<void>
    mutate: (ctx: { attemptId: string }) => Promise<TResponse>
    readback?: GbpReadback<TResponse, TReadback>
    onSuccess?: (
      sql: TransactionSql,
      ctx: { attemptId: string; readback: TReadback | undefined }
    ) => Promise<void>
    audit?: GbpAuditSpec
  }
): Promise<MediaWriteResult> {
  let attemptId: string | null = null
  let result: GbpWriteResult<TResponse, TReadback>
  try {
    result = await runGbpWrite<TResponse, TReadback>({
      surface: "media",
      paused: MEDIA_PAUSED,
      organisationId: scope.organisationId,
      actorUserId: scope.session.userId,
      requestId: scope.requestId,
      store: mediaAttempts,
      key: idempotencyKey([
        scope.organisationId,
        scope.locationId,
        write.operation,
        write.mediaItemId ?? "new",
        ...(write.contentSha256 ? [write.contentSha256] : []),
        // The caller's explicit intent, else the route's Idempotency-Key.
        scope.intentId
          ? `intent:${scope.intentId}`
          : requestScopedKeyPart(scope.requestId),
      ]),
      intent: {
        location_id: scope.locationId,
        media_item_id: write.mediaItemId,
        operation: write.operation,
        expected_google_hash: write.expectedGoogleHash,
        content_sha256: write.contentSha256 ?? null,
        requested_payload: (sql: TransactionSql) =>
          jsonColumnOrNull(sql, write.payload),
      },
      onExisting: "replay",
      // A worker's intent (a bulk child's claim) records the receipt under
      // it; without one the request's ambient intent applies.
      ...(scope.intentId ? { intentId: scope.intentId } : {}),
      failureCode: write.failureCode,
      operation: {
        surface: "media",
        action: write.operation,
        locationId: scope.locationId,
        targetType: "media_item",
        targetRef: write.mediaItemId,
        payloadHash: idempotencyKey([
          write.operation,
          write.mediaItemId ?? "new",
          write.expectedGoogleHash,
          sha256(JSON.stringify(write.payload ?? null)),
        ]),
        approvalRef: scope.approvalRef ?? null,
      },
      validate: write.validate,
      mutate: (ctx) => {
        attemptId = ctx.attemptId
        return write.mutate(ctx)
      },
      onAmbiguous: "fail",
      readback: write.readback,
      onSuccess: write.onSuccess
        ? (sql, success) =>
            write.onSuccess!(sql, {
              attemptId: success.attemptId,
              readback: success.readback,
            })
        : undefined,
      audit: write.audit,
    })
  } catch (error) {
    if (error instanceof MediaNeedsResolutionError && attemptId) {
      await markNeedsResolution(scope.organisationId, attemptId)
      throw needsResolutionError(attemptId, error.message)
    }
    throw error
  }
  return result.idempotent
    ? {
        id: result.attemptId,
        status: result.rawStatus,
        idempotent: true,
        operation: operationSummary(result),
      }
    : {
        id: result.attemptId,
        status: "succeeded",
        idempotent: false,
        operation: operationSummary(result),
      }
}

// ---------------------------------------------------------------------------
// Creates: upload checkpoints and reconciliation (plan P03-S5)
// ---------------------------------------------------------------------------

/**
 * An uncertain create that no single live media item accounts for. Settled
 * `ambiguous` by the pipeline (it is a GoogleMutationAmbiguousError), then
 * moved on to `needs_resolution` by runMediaWrite.
 */
class MediaNeedsResolutionError extends GoogleMutationAmbiguousError {
  constructor(message: string) {
    super(message)
    this.code = "media_needs_resolution"
  }
}

const NEEDS_RESOLUTION_MESSAGE =
  "Google did not confirm whether this was added, and it is not in the listing’s media yet. Check Google, then mark it as added or not added."

function needsResolutionError(
  attemptId: string,
  message = NEEDS_RESOLUTION_MESSAGE,
  status = 502
): ApiError {
  return new ApiError(status, "media_needs_resolution", message, {
    details: { attemptId },
  })
}

/** Seconds an in-flight create is assumed to still be running (runGbpWrite's grace). */
const CREATE_IN_FLIGHT_GRACE_SECONDS = 120

/**
 * A create whose outcome nobody knows yet: a person must resolve it, or it
 * was sent and then settled `ambiguous` (or stranded in flight) without
 * reconciliation. Only creates that reached `create_sent` can be uncertain;
 * an attempt that stopped before it put nothing on the listing.
 */
function unresolvedCreate(sql: TransactionSql) {
  return sql`(
    operation = 'create'
    and resolution is null
    and (
      status = 'needs_resolution'
      or (status = 'ambiguous' and upload_phase = 'create_sent')
      or (
        status = 'started'
        and upload_phase = 'create_sent'
        and started_at <= now() - make_interval(secs => ${CREATE_IN_FLIGHT_GRACE_SECONDS})
      )
    )
  )`
}

/**
 * Refuses a create while an earlier create of the same content at the same
 * location is unresolved (409 media_needs_resolution) or still being sent
 * (409 media_create_in_progress): sending it again could put the photo on
 * the listing twice. Runs inside the attempt claim (mediaAttempts.start), so
 * a same-intent retry is answered from its receipt before it gets here:
 * settled, or still uncertain while it waits on a person.
 */
async function requireNoUnresolvedCreate(
  sql: TransactionSql,
  locationId: string,
  contentSha256: string
) {
  const [row] = await sql<{ id: string; inFlight: boolean }[]>`
    select id::text as id,
      (status = 'started' and not ${unresolvedCreate(sql)}) as "inFlight"
    from gbp_media_mutation
    where location_id = ${locationId}
      and operation = 'create'
      and content_sha256 = ${contentSha256}
      and (
        ${unresolvedCreate(sql)}
        or (
          status = 'started'
          and started_at > now() - make_interval(secs => ${CREATE_IN_FLIGHT_GRACE_SECONDS})
        )
      )
    order by started_at desc
    limit 1
  `
  if (!row) return
  if (row.inFlight) {
    throw new ApiError(
      409,
      "media_create_in_progress",
      "This photo is still being added to Google. Wait a moment, then refresh.",
      { details: { attemptId: row.id } }
    )
  }
  throw needsResolutionError(
    row.id,
    "An earlier attempt to add this to Google was not confirmed. Check Google and resolve it before adding it again.",
    409
  )
}

/** Records how far an upload got, before the next provider call goes out. */
async function recordUploadPhase(
  organisationId: string,
  attemptId: string,
  phase: Exclude<MediaUploadPhase, "none">,
  dataRef?: string
) {
  await withTenant(organisationId, async (sql) => {
    await sql`
      update gbp_media_mutation
      set upload_phase = ${phase}${dataRef ? sql`, upload_data_ref = ${dataRef}` : sql``}
      where id = ${attemptId} and status = 'started'
    `
  })
}

async function markNeedsResolution(organisationId: string, attemptId: string) {
  await withTenant(organisationId, async (sql) => {
    await sql`
      update gbp_media_mutation
      set status = 'needs_resolution', last_error_code = 'media_needs_resolution'
      where id = ${attemptId} and status = 'ambiguous'
    `
  })
}

type CreateClaimContext = {
  startedAt: Date
  claimedNames: Set<string>
  contested: boolean
}

/**
 * What the other creates at the attempt's location say about the live list
 * (lib/domain/media-reconcile.ts): the item names they hold, so no two
 * attempts claim one item, and whether one of the same format and category
 * overlaps the attempt without a name of its own -- its outcome still open
 * (sent, or from before the checkpoints), or adopted by a person, who
 * records no name. Such a create could account for any candidate.
 */
async function createClaimContext(
  sql: TransactionSql,
  attemptId: string
): Promise<CreateClaimContext | null> {
  const [row] = await sql<
    { startedAt: Date; claimedNames: string[]; contested: boolean }[]
  >`
    select
      m.started_at as "startedAt",
      array(
        select c.google_response->>'name'
        from gbp_media_mutation c
        where c.location_id = m.location_id
          and c.operation = 'create'
          and c.id <> m.id
          and c.google_response ? 'name'
      ) as "claimedNames",
      exists (
        select 1
        from gbp_media_mutation c
        where c.location_id = m.location_id
          and c.operation = 'create'
          and c.id <> m.id
          and not coalesce(c.google_response ? 'name', false)
          and (
            c.resolution = 'adopted'
            or (
              c.resolution is null
              and c.status in ('started', 'ambiguous', 'needs_resolution')
              and (
                c.upload_phase = 'create_sent'
                or (c.upload_phase = 'none' and c.content_sha256 is null)
              )
            )
          )
          and coalesce(c.finished_at, now())
            >= m.started_at - make_interval(secs => ${MEDIA_CREATE_TIME_SKEW_MS / 1000})
          and c.requested_payload->>'mediaFormat'
            is not distinct from m.requested_payload->>'mediaFormat'
          and c.requested_payload->>'category'
            is not distinct from m.requested_payload->>'category'
      ) as "contested"
    from gbp_media_mutation m
    where m.id = ${attemptId}
  `
  if (!row) return null
  return {
    startedAt: row.startedAt,
    claimedNames: new Set(row.claimedNames),
    contested: row.contested,
  }
}

/**
 * The live merchant item an uncertain create made, if exactly one accounts
 * for it. Throws MediaNeedsResolutionError otherwise -- including when Google
 * cannot be listed -- so the create is never repeated blindly.
 */
async function reconcileUncertainCreate(
  linked: LinkedLocation,
  attemptId: string,
  intent: MediaCreateIntent
): Promise<GoogleMediaItem> {
  let items: GoogleMediaItem[]
  try {
    items = await googleMediaItems(
      await linked.accessToken(),
      { ...mediaTarget(linked), customer: false },
      mediaTransport(linked)
    )
  } catch {
    throw new MediaNeedsResolutionError(NEEDS_RESOLUTION_MESSAGE)
  }
  const context = await withTenant(linked.organisationId, (sql) =>
    createClaimContext(sql, attemptId)
  )
  if (!context) throw new MediaNeedsResolutionError(NEEDS_RESOLUTION_MESSAGE)
  const match = matchCreatedMedia(items, intent, context)
  if (match.kind === "match") return match.item
  throw new MediaNeedsResolutionError(NEEDS_RESOLUTION_MESSAGE)
}

/**
 * Anything that went wrong before the create was sent is a plain failure,
 * even a timeout: without a create naming the upload, nothing can be on the
 * listing, so a retry is safe.
 */
function beforeCreateFailure(error: unknown): unknown {
  if (!(error instanceof GoogleMutationAmbiguousError)) return error
  return new ApiError(
    502,
    "media_upload_interrupted",
    "The upload to Google did not finish. Nothing was added; try again."
  )
}

type CreateCheckpoint = (
  phase: Exclude<MediaUploadPhase, "none">,
  dataRef?: string
) => Promise<void>

/**
 * Shared by URL create and byte upload: (upload) -> create -> read back ->
 * audit, with a checkpoint on the attempt before each provider call.
 */
async function createMediaItem(
  scope: MediaWriteScope,
  linked: LinkedLocation,
  create: {
    payload: Record<string, unknown>
    intent: MediaCreateIntent
    contentSha256: string
    failureCode: string
    auditAction: "media.created" | "media.uploaded"
    /**
     * The provider calls. Must call `checkpoint("create_sent")` immediately
     * before the create, and may record earlier phases before it.
     */
    send: (
      token: string,
      checkpoint: CreateCheckpoint
    ) => Promise<GoogleMediaItem>
    /**
     * In the settle transaction of a create that landed (or was adopted):
     * the item as read back, and its attempt.
     */
    afterCreate?: (
      sql: TransactionSql,
      created: { attemptId: string; item: GoogleMediaItem | undefined }
    ) => Promise<void>
  }
): Promise<MediaWriteResult> {
  // Set when the create was adopted from the live list rather than named by
  // Google's answer; the success settle records the adoption.
  let adoptedAttemptId: string | null = null
  return runMediaWrite<GoogleMediaItem, GoogleMediaItem>(scope, {
    operation: "create",
    mediaItemId: null,
    expectedGoogleHash: null,
    contentSha256: create.contentSha256,
    payload: create.payload,
    failureCode: create.failureCode,
    mutate: async ({ attemptId }) => {
      const token = await linked.accessToken()
      let sent = false
      const checkpoint: CreateCheckpoint = async (phase, dataRef) => {
        await recordUploadPhase(scope.organisationId, attemptId, phase, dataRef)
        if (phase === "create_sent") sent = true
      }
      let response: GoogleMediaItem
      try {
        response = await create.send(token, checkpoint)
      } catch (error) {
        if (!sent) throw beforeCreateFailure(error)
        if (!(error instanceof GoogleMutationAmbiguousError)) throw error
        // Sent, and Google's answer was lost: the item may exist now.
        const item = await reconcileUncertainCreate(
          linked,
          attemptId,
          create.intent
        )
        adoptedAttemptId = attemptId
        return item
      }
      // A 2xx without the new item's name may still have created it.
      if (typeof response?.name !== "string") {
        const item = await reconcileUncertainCreate(
          linked,
          attemptId,
          create.intent
        )
        adoptedAttemptId = attemptId
        return item
      }
      return response
    },
    readback: {
      // The created (or adopted) item is read back and stored as
      // google_response. Verify identifies it -- the name Google gave and
      // the requested format -- rather than comparing every field: a create
      // that landed must never settle `failed`, which would invite a
      // duplicate.
      read: async ({ response }) =>
        getGoogleMediaItem(
          await linked.accessToken(),
          createdMediaName(response),
          mediaTransport(linked)
        ),
      verify: ({ readback, response }) =>
        readback.name === response?.name &&
        readback.mediaFormat === create.intent.mediaFormat,
      mismatch: {
        status: 502,
        code: "media_readback_mismatch",
        message: "Google did not return the created media item.",
      },
    },
    onSuccess: async (sql, success) => {
      if (adoptedAttemptId)
        await sql`
          update gbp_media_mutation set resolution = 'adopted', resolved_at = now()
          where id = ${adoptedAttemptId}
        `
      if (create.afterCreate)
        await create.afterCreate(sql, {
          attemptId: success.attemptId,
          item: success.readback,
        })
    },
    audit: {
      action: create.auditAction,
      subjectType: "location",
      subjectId: scope.locationId,
      metadata: create.payload,
    },
  })
}

function createdMediaName(response: GoogleMediaItem | undefined): string {
  const name = response?.name
  if (typeof name !== "string") {
    throw new ApiError(
      502,
      "media_readback_missing",
      "Google did not return the created media name."
    )
  }
  return name
}

/** The content a URL create is keyed on: the URL Google fetches. */
function sourceUrlContentSha(sourceUrl: string): string {
  return sha256(`source_url:${sourceUrl}`)
}

export async function createMedia(input: {
  organisationId: string
  session: Session
  locationId: string
  payload: MediaCreateInput
  requestId: string
  intentId?: string | null
}) {
  const contentSha256 = sourceUrlContentSha(input.payload.sourceUrl)
  const linked = await withTenant(input.organisationId, (sql) =>
    linkedForWrite(sql, input.session, input.locationId)
  )
  return createMediaItem(input, linked, {
    payload: input.payload,
    intent: {
      mediaFormat: input.payload.mediaFormat,
      category: input.payload.category,
      description: input.payload.description,
      sourceUrl: input.payload.sourceUrl,
    },
    contentSha256,
    failureCode: "media_create_failed",
    auditAction: "media.created",
    send: async (token, checkpoint) => {
      await checkpoint("create_sent")
      return createGoogleMediaItem(
        token,
        {
          ...mediaTarget(linked),
          payload: {
            mediaFormat: input.payload.mediaFormat,
            locationAssociation: { category: input.payload.category },
            sourceUrl: input.payload.sourceUrl,
            description: input.payload.description,
          },
        },
        mediaTransport(linked)
      )
    },
  })
}

type MediaUploadFile = {
  name: string
  type: string
  size: number
  bytes: ArrayBuffer
}

function requireUploadableFile(
  mediaFormat: "PHOTO" | "VIDEO",
  file: MediaUploadFile
) {
  const allowedTypes = MEDIA_UPLOAD_TYPES[mediaFormat]
  if (!(allowedTypes as readonly string[]).includes(file.type)) {
    throw new ApiError(
      415,
      "media_type_unsupported",
      mediaFormat === "PHOTO"
        ? "Upload a JPEG or PNG image."
        : "Upload an MP4 or QuickTime video."
    )
  }
  if (file.size < MIN_PHOTO_UPLOAD_BYTES && mediaFormat === "PHOTO") {
    throw new ApiError(
      422,
      "media_file_too_small",
      "Google requires photos to be at least 10 KB."
    )
  }
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    throw new ApiError(
      413,
      "media_file_too_large",
      "Media uploads cannot exceed 75 MB."
    )
  }
}

export async function uploadMedia(input: {
  organisationId: string
  session: Session
  locationId: string
  payload: MediaUploadFields
  file: MediaUploadFile
  requestId: string
  intentId?: string | null
}) {
  requireUploadableFile(input.payload.mediaFormat, input.file)
  const contentSha256 = sha256(Buffer.from(input.file.bytes))
  const linked = await withTenant(input.organisationId, (sql) =>
    linkedForWrite(sql, input.session, input.locationId)
  )
  const requestedPayload = {
    mediaFormat: input.payload.mediaFormat,
    category: input.payload.category,
    description: input.payload.description,
    fileName: input.file.name,
    contentType: input.file.type,
    byteLength: input.file.size,
    sha256: contentSha256,
  }
  return createMediaItem(input, linked, {
    payload: requestedPayload,
    intent: {
      mediaFormat: input.payload.mediaFormat,
      category: input.payload.category,
      description: input.payload.description,
    },
    contentSha256,
    failureCode: "media_upload_failed",
    auditAction: "media.uploaded",
    // Google's media API has no resumable upload here, so an attempt that
    // stops before the create starts again from a new reference; the
    // checkpoints record how far it got, which decides whether it can be
    // uncertain at all.
    send: async (token, checkpoint) => {
      const dataRef = await startGoogleMediaUpload(
        token,
        mediaTarget(linked),
        mediaTransport(linked)
      )
      await checkpoint("data_ref_obtained", dataRef.resourceName)
      await sendGoogleMediaBytes(
        token,
        {
          resourceName: dataRef.resourceName,
          bytes: input.file.bytes,
          contentType: input.file.type,
        },
        mediaTransport(linked)
      )
      await checkpoint("bytes_uploaded")
      await checkpoint("create_sent")
      return createGoogleMediaItem(
        token,
        {
          ...mediaTarget(linked),
          payload: {
            mediaFormat: input.payload.mediaFormat,
            locationAssociation: { category: input.payload.category },
            dataRef,
            description: input.payload.description,
          },
        },
        mediaTransport(linked)
      )
    },
  })
}

/**
 * A new photo from an owned, validated asset (lib/server/assets.ts), for
 * the bulk photos family: the same checkpointed upload, unresolved-create
 * guard, readback, receipt and recovery as `uploadMedia`, keyed on the
 * asset's SHA-256. The bytes were read from the asset's immutable key and
 * re-hashed by the caller; nothing a client declared is trusted here.
 */
export async function uploadMediaFromAsset(input: {
  organisationId: string
  session: Session
  locationId: string
  linked: LinkedLocation
  asset: {
    id: string
    fileName: string
    contentType: string
    sha256: string
    bytes: Uint8Array
  }
  category: GoogleMediaCategory
  description?: string | null
  requestId: string
  intentId: string
  approvalRef: string
  afterCreate?: (
    sql: TransactionSql,
    created: { attemptId: string; item: GoogleMediaItem | undefined }
  ) => Promise<void>
}) {
  requireMediaWrite(input.linked)
  const description = input.description ?? undefined
  const bytes = input.asset.bytes.buffer.slice(
    input.asset.bytes.byteOffset,
    input.asset.bytes.byteOffset + input.asset.bytes.byteLength
  ) as ArrayBuffer
  const requestedPayload = {
    mediaFormat: "PHOTO",
    category: input.category,
    description,
    fileName: input.asset.fileName,
    contentType: input.asset.contentType,
    byteLength: input.asset.bytes.byteLength,
    sha256: input.asset.sha256,
    assetId: input.asset.id,
  }
  const linked = input.linked
  return createMediaItem(input, linked, {
    payload: requestedPayload,
    intent: { mediaFormat: "PHOTO", category: input.category, description },
    contentSha256: input.asset.sha256,
    failureCode: "media_upload_failed",
    auditAction: "media.uploaded",
    afterCreate: input.afterCreate,
    send: async (token, checkpoint) => {
      const dataRef = await startGoogleMediaUpload(
        token,
        mediaTarget(linked),
        mediaTransport(linked)
      )
      await checkpoint("data_ref_obtained", dataRef.resourceName)
      await sendGoogleMediaBytes(
        token,
        {
          resourceName: dataRef.resourceName,
          bytes,
          contentType: input.asset.contentType,
        },
        mediaTransport(linked)
      )
      await checkpoint("bytes_uploaded")
      await checkpoint("create_sent")
      return createGoogleMediaItem(
        token,
        {
          ...mediaTarget(linked),
          payload: {
            mediaFormat: "PHOTO",
            locationAssociation: { category: input.category },
            dataRef,
            description,
          },
        },
        mediaTransport(linked)
      )
    },
  })
}

/** The merchant media item names Google lists for a listing now. */
export async function liveMerchantMediaNames(
  linked: LinkedLocation
): Promise<string[]> {
  const items = await googleMediaItems(
    await linked.accessToken(),
    { ...mediaTarget(linked), customer: false },
    mediaTransport(linked)
  )
  return items.flatMap((item) =>
    typeof item.name === "string" ? [item.name] : []
  )
}

// ---------------------------------------------------------------------------
// Resolution of an unconfirmed create (a person's decision)
// ---------------------------------------------------------------------------

/**
 * The location's creates that need a person: unresolved per
 * `unresolvedCreate`, newest first. Shown on the photos tab with the
 * resolve actions.
 */
async function loadUnresolvedCreates(
  sql: TransactionSql,
  locationId: string
): Promise<MediaUnresolvedCreateWire[]> {
  const rows = await sql<
    {
      attemptId: string
      payload: Record<string, unknown> | null
      startedAt: Date
    }[]
  >`
    select id::text as "attemptId", requested_payload as payload,
      started_at as "startedAt"
    from gbp_media_mutation
    where location_id = ${locationId} and ${unresolvedCreate(sql)}
    order by started_at desc
    limit 20
  `
  const text = (value: unknown) => (typeof value === "string" ? value : null)
  return rows.map((row) => ({
    attemptId: row.attemptId,
    mediaFormat: text(row.payload?.mediaFormat),
    category: text(row.payload?.category),
    description: text(row.payload?.description),
    fileName: text(row.payload?.fileName),
    sourceUrl: text(row.payload?.sourceUrl),
    startedAt: row.startedAt.toISOString(),
  }))
}

/**
 * Records a person's verdict on an unconfirmed create: `adopted` (it is on
 * Google) settles the attempt `succeeded`, `abandoned` (it is not) settles it
 * `failed`, which lets the same content be added again. Nothing is sent to
 * Google, so neither the media kill switch nor a pause applies; the publish
 * grant does. The receipts waiting on the attempt settle with it.
 */
export async function resolveMediaCreate(input: {
  organisationId: string
  session: Session
  locationId: string
  attemptId: string
  resolution: MediaResolution
  requestId: string
}): Promise<MediaWriteResult> {
  return withTenant(input.organisationId, async (sql) => {
    const linked = await loadLinkedLocation(
      sql,
      input.session,
      input.locationId,
      { notLinked: NOT_LINKED }
    )
    requirePublishGrant(linked, {
      code: "publish_not_allowed",
      message: "You cannot publish for this location.",
    })
    const [row] = await sql<{ id: string; status: string }[]>`
      select id::text as id, status
      from gbp_media_mutation
      where id = ${input.attemptId}
        and location_id = ${input.locationId}
        and ${unresolvedCreate(sql)}
      for update
    `
    if (!row) {
      throw new ApiError(
        409,
        "media_resolution_not_pending",
        "This upload no longer needs a decision. Refresh the tab."
      )
    }
    const adopted = input.resolution === "adopted"
    const status = adopted ? "succeeded" : "failed"
    const errorCode = adopted ? null : "media_resolution_abandoned"
    await sql`
      update gbp_media_mutation
      set status = ${status}, resolution = ${input.resolution},
        resolved_by_user_id = ${input.session.userId}, resolved_at = now(),
        last_error_code = ${errorCode}, finished_at = now()
      where id = ${row.id} and status = ${row.status}
    `
    await settleRecoveredOperations(sql, {
      attemptTable: "gbp_media_mutation",
      attemptId: row.id,
      state: adopted ? "confirmed_applied" : "failed",
      errorCode,
      receipt: { attemptId: row.id, attemptStatus: status, rawStatus: status },
    })
    await writeAudit(sql, {
      organisationId: input.organisationId,
      actorUserId: input.session.userId,
      action: "media.create_resolved",
      subjectType: "location",
      subjectId: input.locationId,
      requestId: input.requestId,
      metadata: {
        attemptId: row.id,
        resolution: input.resolution,
        previousStatus: row.status,
      },
    })
    return { id: row.id, status, idempotent: false }
  })
}

export async function updateMedia(input: {
  organisationId: string
  session: Session
  locationId: string
  mediaId: string
  category: GoogleMediaCategory
  expectedGoogleHash: string
  requestId: string
}) {
  const { linked, item } = await mutableMediaItem(
    input,
    "Refresh before overwriting newer Google media changes."
  )
  if (["COVER", "PROFILE"].includes(input.category)) {
    throw new ApiError(
      422,
      "media_category_not_patchable",
      "Google does not allow changing an existing item to Cover or Profile."
    )
  }
  return runMediaWrite<GoogleMediaItem, GoogleMediaItem>(input, {
    operation: "update",
    mediaItemId: item.id,
    expectedGoogleHash: input.expectedGoogleHash,
    payload: { category: input.category },
    failureCode: "media_update_failed",
    validate: () =>
      requireFreshGoogleMedia(
        linked,
        item.googleMediaName,
        input.expectedGoogleHash
      ),
    mutate: async () =>
      patchGoogleMediaItem(
        await linked.accessToken(),
        { name: item.googleMediaName, category: input.category },
        mediaTransport(linked)
      ),
    readback: {
      read: async () =>
        getGoogleMediaItem(
          await linked.accessToken(),
          item.googleMediaName,
          mediaTransport(linked)
        ),
      verify: ({ readback }) => mediaCategoryOf(readback) === input.category,
      mismatch: {
        status: 502,
        code: "media_readback_mismatch",
        message: "Google did not apply the approved category.",
      },
    },
  })
}

export async function removeMedia(input: {
  organisationId: string
  session: Session
  locationId: string
  mediaId: string
  expectedGoogleHash: string
  requestId: string
}) {
  const { linked, item } = await mutableMediaItem(
    input,
    "Refresh before deleting changed media."
  )
  return runMediaWrite<null>(input, {
    operation: "delete",
    mediaItemId: item.id,
    expectedGoogleHash: input.expectedGoogleHash,
    payload: null,
    failureCode: "media_delete_failed",
    validate: () =>
      requireFreshGoogleMedia(
        linked,
        item.googleMediaName,
        input.expectedGoogleHash
      ),
    mutate: async () =>
      deleteGoogleMediaItem(
        await linked.accessToken(),
        item.googleMediaName,
        mediaTransport(linked)
      ),
    audit: {
      action: "media.deleted",
      subjectType: "media_item",
      subjectId: input.mediaId,
      metadata: { googleMediaName: item.googleMediaName },
    },
  })
}

// ---------------------------------------------------------------------------
// Recovery (lib/server/mutation-recovery.ts)
// ---------------------------------------------------------------------------

type MediaRecoveryAttempt = RecoveryAttempt & {
  operation: MediaOperation
  requestedPayload: Record<string, unknown> | null
  googleMediaName: string | null
  uploadPhase: MediaUploadPhase
  /** Set on every create from 0093 on; null marks one from before. */
  contentSha256: string | null
  claimedNames: string[]
  contested: boolean
}

const settleMediaAttempt = storeSettle(mediaAttempts)

/**
 * Reads an uncertain media write back. An update landed when the item holds
 * the requested category; a delete when Google answers 404 for the item.
 *
 * A create is decided by its upload checkpoint (0093). One that stopped
 * before `create_sent` put nothing on the listing (not landed). One that was
 * sent is matched against the live media list (lib/domain/media-reconcile.ts):
 * a single match is adopted, otherwise it is handed to a person as
 * `needs_resolution`. A create from before the checkpoints existed (phase
 * `none`, no `content_sha256`) cannot be placed either way and is handed to a
 * person as before; a later one at `none` stopped before its first call.
 */
export const mediaRecoveryAdapter: RecoveryAdapter<MediaRecoveryAttempt> = {
  surface: "media",
  attemptTable: "gbp_media_mutation",
  async load(sql, attemptId) {
    const [row] = await sql<
      Omit<MediaRecoveryAttempt, "claimedNames" | "contested">[]
    >`
      select
        m.id::text as id,
        m.status as "rawStatus",
        m.started_at as "startedAt",
        m.last_error_code as "errorCode",
        m.operation,
        m.requested_payload as "requestedPayload",
        m.upload_phase as "uploadPhase",
        m.content_sha256 as "contentSha256",
        i.google_media_name as "googleMediaName"
      from gbp_media_mutation m
      left join gbp_media_item i on i.id = m.media_item_id
      where m.id = ${attemptId}
    `
    if (!row) return null
    const claims =
      row.operation === "create"
        ? await createClaimContext(sql, attemptId)
        : null
    return {
      ...row,
      claimedNames: [...(claims?.claimedNames ?? [])],
      contested: claims?.contested ?? false,
    }
  },
  async readback({ attempt, link }) {
    if (attempt.operation === "create") {
      if (attempt.uploadPhase === "none") {
        // From 0093 on, every create records its content before the first
        // provider call, and `none` means it stopped in startUpload: nothing
        // can be on the listing. Only a create from before cannot be placed.
        return attempt.contentSha256
          ? { kind: "not_landed", errorCode: "media_upload_interrupted" }
          : { kind: "unverifiable", errorCode: "media_create_unverifiable" }
      }
      if (attempt.uploadPhase !== "create_sent") {
        return { kind: "not_landed", errorCode: "media_upload_interrupted" }
      }
      const payload = attempt.requestedPayload ?? {}
      const text = (value: unknown) =>
        typeof value === "string" ? value : null
      const items = await googleMediaItems(
        await link.accessToken(),
        { ...mediaTarget(link), customer: false },
        mediaTransport(link)
      )
      const match = matchCreatedMedia(
        items,
        {
          mediaFormat: text(payload.mediaFormat) ?? "",
          category: text(payload.category) ?? "",
          description: text(payload.description),
          sourceUrl: text(payload.sourceUrl),
        },
        {
          startedAt: attempt.startedAt ?? new Date(0),
          claimedNames: new Set(attempt.claimedNames),
          contested: attempt.contested,
        }
      )
      return match.kind === "match"
        ? { kind: "landed", confirmed: true, response: match.item }
        : { kind: "unverifiable", errorCode: "media_needs_resolution" }
    }
    if (!attempt.googleMediaName) {
      return { kind: "unverifiable", errorCode: "target_changed" }
    }
    const token = await link.accessToken()
    if (attempt.operation === "delete") {
      try {
        await getGoogleMediaItem(
          token,
          attempt.googleMediaName,
          mediaTransport(link)
        )
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return { kind: "landed", confirmed: true }
        }
        throw error
      }
      return { kind: "not_landed", errorCode: "media_delete_mismatch" }
    }
    let current: Awaited<ReturnType<typeof getGoogleMediaItem>>
    try {
      current = await getGoogleMediaItem(
        token,
        attempt.googleMediaName,
        mediaTransport(link)
      )
    } catch (error) {
      // The item is gone: whether the update landed first is unknowable,
      // and a retry would read the same 404.
      if (error instanceof ApiError && error.status === 404) {
        return { kind: "unverifiable", errorCode: "target_changed" }
      }
      throw error
    }
    const category = attempt.requestedPayload?.category
    return typeof category === "string" && mediaCategoryOf(current) === category
      ? { kind: "landed", confirmed: true, response: current }
      : { kind: "not_landed", errorCode: "media_readback_mismatch" }
  },
  async settle(sql, input) {
    const written = await settleMediaAttempt(sql, input)
    if (
      written &&
      input.attempt.operation === "create" &&
      input.verdict.kind === "landed"
    ) {
      await sql`
        update gbp_media_mutation set resolution = 'adopted', resolved_at = now()
        where id = ${input.attempt.id}
      `
    }
    return written
  },
  async unverifiable(sql, { attempt, errorCode }) {
    if (errorCode !== "media_needs_resolution") return
    await sql`
      update gbp_media_mutation
      set status = 'needs_resolution', last_error_code = 'media_needs_resolution',
        finished_at = coalesce(finished_at, now())
      where id = ${attempt.id}
        and status = ${attempt.rawStatus}
        and status in ('ambiguous', 'started')
    `
  },
}
