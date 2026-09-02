import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"

import {
  GOOGLE_MEDIA_CATEGORIES,
  type GoogleMediaCategory,
} from "@/lib/domain/google-contract"
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
  type LinkedLocation,
} from "@/lib/server/gbp-write"
import {
  createGoogleMediaItem,
  deleteGoogleMediaItem,
  getGoogleMediaItem,
  googleMediaItems,
  patchGoogleMediaItem,
  uploadGoogleMediaBytes,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"
import { DEFAULT_MEDIA_PAGE_SIZE, MAX_MEDIA_PAGE_SIZE } from "@/lib/media-page"

export const mediaCreateSchema = z.object({
  mediaFormat: z.enum(["PHOTO", "VIDEO"]),
  category: z.enum(GOOGLE_MEDIA_CATEGORIES),
  sourceUrl: z
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
  description: z.string().trim().max(1500).optional(),
})

const MEDIA_UPLOAD_TYPES = {
  PHOTO: ["image/jpeg", "image/png"],
  VIDEO: ["video/mp4", "video/quicktime"],
} as const

export const MAX_MEDIA_UPLOAD_BYTES = 75 * 1024 * 1024

export const mediaUploadFieldsSchema = z.object({
  mediaFormat: z.enum(["PHOTO", "VIDEO"]),
  category: z.enum(GOOGLE_MEDIA_CATEGORIES),
  description: z.string().trim().max(1500).optional(),
  confirmation: z.literal("create_google_media"),
})

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

type MediaListItem = {
  id: string
  googleMediaName: string
  ownership: string
  mediaFormat: string
  category: string | null
  sourceUrl: string | null
  googleUrl: string | null
  thumbnailUrl: string | null
  description: string | null
  attribution: unknown
  dimensions: unknown
  insights: unknown
  googleHash: string
  createTime: string | null
}

export type MediaOwnershipFilter = "merchant" | "customer"

async function readMediaPage(
  organisationId: string,
  locationId: string,
  page: number,
  pageSize: number,
  filters: {
    category?: GoogleMediaCategory
    ownership?: MediaOwnershipFilter
  } = {}
): Promise<{ items: MediaListItem[]; total: number }> {
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
    const offset = (page - 1) * pageSize
    const items = await sql<MediaListItem[]>`
      select id::text as id, google_media_name as "googleMediaName",
        ownership, media_format as "mediaFormat", category, source_url as "sourceUrl",
        google_url as "googleUrl", thumbnail_url as "thumbnailUrl", description,
        attribution, dimensions, insights, google_hash as "googleHash",
        google_create_time as "createTime"
      from gbp_media_item
      where location_id = ${locationId} and deleted_at is null
      ${categoryFilter}
      ${ownershipFilter}
      order by ownership, google_create_time desc nulls last
      limit ${pageSize} offset ${offset}
    `
    return { items, total }
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
    page?: number
    pageSize?: number
    refresh?: boolean
    category?: GoogleMediaCategory
    ownership?: MediaOwnershipFilter
  } = {}
) {
  const page = Math.max(1, Math.floor(options.page ?? 1))
  const pageSize = Math.min(
    MAX_MEDIA_PAGE_SIZE,
    Math.max(1, Math.floor(options.pageSize ?? DEFAULT_MEDIA_PAGE_SIZE))
  )
  const refresh = Boolean(options.refresh)
  const category = options.category
  const ownership = options.ownership

  const { linked, cache } = await withTenant(organisationId, async (sql) => ({
    linked: await loadLinkedLocation(sql, session, locationId, {
      notLinked: NOT_LINKED,
    }),
    cache: await mediaCacheStatus(sql, locationId),
  }))

  if (
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
  const { items, total } = await readMediaPage(
    organisationId,
    locationId,
    page,
    pageSize,
    { category, ownership }
  )
  return {
    canPublish: linked.canPublish,
    writesEnabled: gbpWritesEnabled(env, "media"),
    categories: GOOGLE_MEDIA_CATEGORIES,
    items,
    total,
    page,
    pageSize,
    category: category ?? null,
    ownership: ownership ?? null,
  }
}

// ---------------------------------------------------------------------------
// Writes (gbp_media_mutation through lib/server/gbp-write)
// ---------------------------------------------------------------------------

/**
 * gbp_media_mutation as an AttemptStore. Its CHECK constraint only knows
 * started/succeeded/failed/ambiguous, so the in-flight vocabulary maps onto
 * `started`; the table has no validated_at / http-status / response-hash
 * columns.
 */
const mediaAttempts = attemptStore({
  table: "gbp_media_mutation",
  statuses: {
    validating: "started",
    validated: "started",
    publishing: "started",
  },
  columns: { errorCode: "last_error_code", response: "google_response" },
})

type MediaOperation = "create" | "update" | "delete"

type MediaWriteScope = {
  organisationId: string
  session: Session
  locationId: string
  requestId: string
}

type MediaWriteResult = { id: string; status: string; idempotent: boolean }

/** Capability + kill switch (503 media_paused), then the publish grant (403). */
function requireMediaWrite(linked: LinkedLocation) {
  requireGbpWrite(getServerEnv(), "media", {
    status: 503,
    code: "media_paused",
    message: "Google media writes are paused.",
  })
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
 * - onExisting "replay": the key includes the request id, so any existing row
 *   (whatever its status) is returned as idempotent -- media's behaviour today.
 * - onAmbiguous "fail": an ambiguous provider call settles `ambiguous` and
 *   rethrows; there is no list-based recovery for media (unchanged). The
 *   caller retries with a fresh request id after refreshing the cache.
 */
async function runMediaWrite<TResponse, TReadback = never>(
  scope: MediaWriteScope,
  write: {
    operation: MediaOperation
    mediaItemId: string | null
    expectedGoogleHash: string | null
    payload: unknown
    failureCode: string
    validate?: () => Promise<void>
    mutate: () => Promise<TResponse>
    readback?: GbpReadback<TResponse, TReadback>
    audit?: GbpAuditSpec
  }
): Promise<MediaWriteResult> {
  const result = await runGbpWrite<TResponse, TReadback>({
    organisationId: scope.organisationId,
    actorUserId: scope.session.userId,
    requestId: scope.requestId,
    store: mediaAttempts,
    key: idempotencyKey([
      scope.organisationId,
      scope.locationId,
      write.operation,
      write.mediaItemId ?? "new",
      scope.requestId,
    ]),
    intent: {
      location_id: scope.locationId,
      media_item_id: write.mediaItemId,
      operation: write.operation,
      expected_google_hash: write.expectedGoogleHash,
      requested_payload: (sql: TransactionSql) =>
        jsonColumnOrNull(sql, write.payload),
    },
    onExisting: "replay",
    failureCode: write.failureCode,
    validate: write.validate,
    mutate: write.mutate,
    onAmbiguous: "fail",
    readback: write.readback,
    audit: write.audit,
  })
  return result.idempotent
    ? { id: result.attemptId, status: result.rawStatus, idempotent: true }
    : { id: result.attemptId, status: "succeeded", idempotent: false }
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

/** Shared by URL create and byte upload: create -> read back -> audit. */
async function createMediaItem(
  scope: MediaWriteScope,
  linked: LinkedLocation,
  create: {
    payload: Record<string, unknown>
    failureCode: string
    auditAction: "media.created" | "media.uploaded"
    call: (token: string) => Promise<GoogleMediaItem>
  }
): Promise<MediaWriteResult> {
  return runMediaWrite<GoogleMediaItem, GoogleMediaItem>(scope, {
    operation: "create",
    mediaItemId: null,
    expectedGoogleHash: null,
    payload: create.payload,
    failureCode: create.failureCode,
    mutate: async () => {
      const response = await create.call(await linked.accessToken())
      createdMediaName(response)
      return response
    },
    readback: {
      // The created item is read back and stored as google_response; no
      // field comparison is made for creates (unchanged behaviour).
      read: async ({ response }) =>
        getGoogleMediaItem(
          await linked.accessToken(),
          createdMediaName(response),
          mediaTransport(linked)
        ),
      verify: () => true,
    },
    audit: {
      action: create.auditAction,
      subjectType: "location",
      subjectId: scope.locationId,
      metadata: create.payload,
    },
  })
}

export async function createMedia(input: {
  organisationId: string
  session: Session
  locationId: string
  payload: z.infer<typeof mediaCreateSchema>
  requestId: string
}) {
  const linked = await withTenant(input.organisationId, (sql) =>
    linkedForWrite(sql, input.session, input.locationId)
  )
  return createMediaItem(input, linked, {
    payload: input.payload,
    failureCode: "media_create_failed",
    auditAction: "media.created",
    call: (token) =>
      createGoogleMediaItem(
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
      ),
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
  if (file.size < 10_240 && mediaFormat === "PHOTO") {
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
  payload: z.infer<typeof mediaUploadFieldsSchema>
  file: MediaUploadFile
  requestId: string
}) {
  const linked = await withTenant(input.organisationId, (sql) =>
    linkedForWrite(sql, input.session, input.locationId)
  )
  requireUploadableFile(input.payload.mediaFormat, input.file)
  const requestedPayload = {
    mediaFormat: input.payload.mediaFormat,
    category: input.payload.category,
    description: input.payload.description,
    fileName: input.file.name,
    contentType: input.file.type,
    byteLength: input.file.size,
    sha256: sha256(Buffer.from(input.file.bytes)),
  }
  return createMediaItem(input, linked, {
    payload: requestedPayload,
    failureCode: "media_upload_failed",
    auditAction: "media.uploaded",
    // TODO(gbp-write): the helper has no upload/multipart phase; the byte
    // upload runs inside `mutate` so a failed upload settles the attempt
    // as failed (as before). A resumable-upload phase would let the helper
    // record the dataRef between upload and create.
    call: async (token) => {
      const dataRef = await uploadGoogleMediaBytes(
        token,
        {
          ...mediaTarget(linked),
          bytes: input.file.bytes,
          contentType: input.file.type,
        },
        mediaTransport(linked)
      )
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
