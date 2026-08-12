import "server-only"

import type { TransactionSql } from "postgres"
import { z } from "zod"

import {
  GOOGLE_MEDIA_CATEGORIES,
  type GoogleMediaCategory,
} from "@/lib/domain/google-contract"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import {
  connectionAccessToken,
  createGoogleMediaItem,
  deleteGoogleMediaItem,
  getGoogleMediaItem,
  googleMediaItems,
  GoogleMutationAmbiguousError,
  patchGoogleMediaItem,
  uploadGoogleMediaBytes,
} from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { canPublishLocation, requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"
import {
  DEFAULT_MEDIA_PAGE_SIZE,
  MAX_MEDIA_PAGE_SIZE,
} from "@/lib/media-page"

export const mediaCreateSchema = z.object({
  mediaFormat: z.enum(["PHOTO", "VIDEO"]),
  category: z.enum(GOOGLE_MEDIA_CATEGORIES),
  sourceUrl: z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol)),
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

type MediaContext = {
  externalLocationId: string
  connectionId: string
  accountName: string
  googleLocationName: string
  canPublish: boolean
}

function mediaHash(item: Record<string, unknown>) {
  return sha256(JSON.stringify({
    category: (item.locationAssociation as Record<string, unknown> | undefined)?.category ?? null,
    description: item.description ?? null,
    googleUrl: item.googleUrl ?? null,
    mediaFormat: item.mediaFormat ?? null,
    sourceUrl: item.sourceUrl ?? null,
  }))
}

async function context(
  sql: TransactionSql,
  session: Session,
  locationId: string
): Promise<MediaContext> {
  await requireLocationAccess(sql, session, locationId)
  const [row] = await sql<Omit<MediaContext, "canPublish">[]>`
    select
      el.id::text as "externalLocationId",
      el.google_connection_id::text as "connectionId",
      el.google_account_name as "accountName",
      el.google_location_name as "googleLocationName"
    from location_link ll
    join external_location el on el.id = ll.external_location_id
    where ll.location_id = ${locationId} and ll.is_active = true
    limit 1
  `
  if (!row) throw new ApiError(409, "google_location_not_linked", "Link this location to Google first.")
  return { ...row, canPublish: await canPublishLocation(sql, session, locationId) }
}

async function cacheMedia(
  organisationId: string,
  locationId: string,
  linked: MediaContext,
  merchant: Array<Record<string, unknown>>,
  customer: Array<Record<string, unknown>>
) {
  return withTenant(organisationId, async (sql) => {
    await sql`update gbp_media_item set deleted_at = now() where location_id = ${locationId} and deleted_at is null`
    for (const [ownership, items] of [["merchant", merchant], ["customer", customer]] as const) {
      for (const item of items) {
        if (typeof item.name !== "string" || typeof item.mediaFormat !== "string") continue
        const association = item.locationAssociation && typeof item.locationAssociation === "object"
          ? item.locationAssociation as Record<string, unknown>
          : null
        await sql`
          insert into gbp_media_item (
            organisation_id, location_id, external_location_id, google_media_name,
            ownership, media_format, category, source_url, google_url,
            thumbnail_url, description, attribution, dimensions, insights,
            google_hash, google_create_time, observed_at, deleted_at, payload_expires_at
          ) values (
            ${organisationId}, ${locationId}, ${linked.externalLocationId}, ${item.name},
            ${ownership}, ${item.mediaFormat}, ${typeof association?.category === "string" ? association.category : null},
            ${typeof item.sourceUrl === "string" ? item.sourceUrl : null},
            ${typeof item.googleUrl === "string" ? item.googleUrl : null},
            ${typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null},
            ${typeof item.description === "string" ? item.description : null},
            ${item.attribution ? sql.json(JSON.parse(JSON.stringify(item.attribution))) : null},
            ${item.dimensions ? sql.json(JSON.parse(JSON.stringify(item.dimensions))) : null},
            ${item.insights ? sql.json(JSON.parse(JSON.stringify(item.insights))) : null},
            ${mediaHash(item)}, ${typeof item.createTime === "string" ? item.createTime : null}, now(), null,
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

async function mediaCacheStatus(organisationId: string, locationId: string) {
  return withTenant(organisationId, async (sql) => {
    const [row] = await sql<{ count: number; observedAt: string | null }[]>`
      select
        count(*)::integer as count,
        max(observed_at)::text as "observedAt"
      from gbp_media_item
      where location_id = ${locationId} and deleted_at is null
    `
    return { count: row?.count ?? 0, observedAt: row?.observedAt ?? null }
  })
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

  const linked = await withTenant(organisationId, (sql) => context(sql, session, locationId))
  const cache = await mediaCacheStatus(organisationId, locationId)

  if (shouldSyncMediaCache({ refresh, count: cache.count, observedAt: cache.observedAt })) {
    const token = await connectionAccessToken(
      getDatabase(),
      organisationId,
      linked.connectionId
    )
    const [merchant, customer] = await Promise.all([
      googleMediaItems(
        token,
        {
          accountName: linked.accountName,
          locationName: linked.googleLocationName,
          customer: false,
        },
        { connectionKey: linked.connectionId }
      ),
      googleMediaItems(
        token,
        {
          accountName: linked.accountName,
          locationName: linked.googleLocationName,
          customer: true,
        },
        { connectionKey: linked.connectionId }
      ),
    ])
    await cacheMedia(organisationId, locationId, linked, merchant, customer)
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
    writesEnabled: env.PUBLISH_ENABLED,
    categories: GOOGLE_MEDIA_CATEGORIES,
    items,
    total,
    page,
    pageSize,
    category: category ?? null,
    ownership: ownership ?? null,
  }
}

function requireWrite(linked: MediaContext) {
  const env = getServerEnv()
  if (!env.PUBLISH_ENABLED) throw new ApiError(503, "media_paused", "Google media writes are paused.")
  if (!linked.canPublish) throw new ApiError(403, "publish_not_allowed", "You cannot publish for this location.")
}

async function mutation(
  organisationId: string,
  session: Session,
  locationId: string,
  operation: "create" | "update" | "delete",
  requestId: string,
  mediaItemId: string | null,
  expectedHash: string | null,
  payload: unknown
) {
  const key = `${locationId}:${operation}:${mediaItemId ?? "new"}:${requestId}`
  return withTenant(organisationId, async (sql) => {
    const [old] = await sql<{ id: string; status: string }[]>`select id::text as id, status from gbp_media_mutation where idempotency_key = ${key}`
    if (old) return { ...old, idempotent: true }
    const [created] = await sql<{ id: string; status: string }[]>`
      insert into gbp_media_mutation (organisation_id, location_id, media_item_id, actor_user_id, operation, status, idempotency_key, expected_google_hash, requested_payload)
      values (${organisationId}, ${locationId}, ${mediaItemId}, ${session.userId}, ${operation}, 'started', ${key}, ${expectedHash}, ${payload ? sql.json(JSON.parse(JSON.stringify(payload))) : null})
      returning id::text as id, status`
    return { ...created, idempotent: false }
  })
}

async function settle(organisationId: string, id: string, status: string, response?: unknown, errorCode?: string) {
  await withTenant(organisationId, (sql) => sql`
    update gbp_media_mutation set status = ${status}, google_response = ${response ? sql.json(JSON.parse(JSON.stringify(response))) : null}, last_error_code = ${errorCode ?? null}, finished_at = now() where id = ${id}`)
}

async function stored(organisationId: string, locationId: string, id: string) {
  const [item] = await withTenant(organisationId, (sql) => sql<Array<{ id: string; googleMediaName: string; ownership: string; category: GoogleMediaCategory; googleHash: string }>>`
    select id::text as id, google_media_name as "googleMediaName", ownership, category, google_hash as "googleHash"
    from gbp_media_item where id = ${id} and location_id = ${locationId} and deleted_at is null`)
  if (!item) throw new ApiError(404, "media_not_found", "Media item not found.")
  if (item.ownership !== "merchant") throw new ApiError(409, "customer_media_read_only", "Customer media is read-only.")
  return item
}

export async function createMedia(input: { organisationId: string; session: Session; locationId: string; payload: z.infer<typeof mediaCreateSchema>; requestId: string }) {
  const linked = await withTenant(input.organisationId, (sql) => context(sql, input.session, input.locationId))
  requireWrite(linked)
  const attempt = await mutation(input.organisationId, input.session, input.locationId, "create", input.requestId, null, null, input.payload)
  if (attempt.idempotent) return attempt
  try {
    const token = await connectionAccessToken(getDatabase(), input.organisationId, linked.connectionId)
    const response = await createGoogleMediaItem(token, {
      accountName: linked.accountName, locationName: linked.googleLocationName,
      payload: { mediaFormat: input.payload.mediaFormat, locationAssociation: { category: input.payload.category }, sourceUrl: input.payload.sourceUrl, description: input.payload.description },
    }, { connectionKey: linked.connectionId })
    if (typeof response.name !== "string") throw new ApiError(502, "media_readback_missing", "Google did not return the created media name.")
    const readback = await getGoogleMediaItem(token, response.name, { connectionKey: linked.connectionId })
    await settle(input.organisationId, attempt.id, "succeeded", readback)
    await withTenant(input.organisationId, (sql) => writeAudit(sql, { organisationId: input.organisationId, actorUserId: input.session.userId, action: "media.created", subjectType: "location", subjectId: input.locationId, requestId: input.requestId, metadata: input.payload }))
    return { id: attempt.id, status: "succeeded", idempotent: false }
  } catch (error) {
    await settle(input.organisationId, attempt.id, error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed", null, error && typeof error === "object" && "code" in error ? String(error.code) : "media_create_failed")
    throw error
  }
}

export async function uploadMedia(input: {
  organisationId: string
  session: Session
  locationId: string
  payload: z.infer<typeof mediaUploadFieldsSchema>
  file: { name: string; type: string; size: number; bytes: ArrayBuffer }
  requestId: string
}) {
  const linked = await withTenant(input.organisationId, (sql) =>
    context(sql, input.session, input.locationId)
  )
  requireWrite(linked)
  const allowedTypes = MEDIA_UPLOAD_TYPES[input.payload.mediaFormat]
  if (!(allowedTypes as readonly string[]).includes(input.file.type)) {
    throw new ApiError(
      415,
      "media_type_unsupported",
      input.payload.mediaFormat === "PHOTO"
        ? "Upload a JPEG or PNG image."
        : "Upload an MP4 or QuickTime video."
    )
  }
  if (input.file.size < 10_240 && input.payload.mediaFormat === "PHOTO") {
    throw new ApiError(
      422,
      "media_file_too_small",
      "Google requires photos to be at least 10 KB."
    )
  }
  if (input.file.size > MAX_MEDIA_UPLOAD_BYTES) {
    throw new ApiError(
      413,
      "media_file_too_large",
      "Media uploads cannot exceed 75 MB."
    )
  }
  const requestedPayload = {
    mediaFormat: input.payload.mediaFormat,
    category: input.payload.category,
    description: input.payload.description,
    fileName: input.file.name,
    contentType: input.file.type,
    byteLength: input.file.size,
    sha256: sha256(Buffer.from(input.file.bytes)),
  }
  const attempt = await mutation(
    input.organisationId,
    input.session,
    input.locationId,
    "create",
    input.requestId,
    null,
    null,
    requestedPayload
  )
  if (attempt.idempotent) return attempt
  try {
    const token = await connectionAccessToken(
      getDatabase(),
      input.organisationId,
      linked.connectionId
    )
    const dataRef = await uploadGoogleMediaBytes(
      token,
      {
        accountName: linked.accountName,
        locationName: linked.googleLocationName,
        bytes: input.file.bytes,
        contentType: input.file.type,
      },
      { connectionKey: linked.connectionId }
    )
    const response = await createGoogleMediaItem(
      token,
      {
        accountName: linked.accountName,
        locationName: linked.googleLocationName,
        payload: {
          mediaFormat: input.payload.mediaFormat,
          locationAssociation: { category: input.payload.category },
          dataRef,
          description: input.payload.description,
        },
      },
      { connectionKey: linked.connectionId }
    )
    if (typeof response.name !== "string") {
      throw new ApiError(
        502,
        "media_readback_missing",
        "Google did not return the created media name."
      )
    }
    const readback = await getGoogleMediaItem(token, response.name, {
      connectionKey: linked.connectionId,
    })
    await settle(input.organisationId, attempt.id, "succeeded", readback)
    await withTenant(input.organisationId, (sql) =>
      writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.session.userId,
        action: "media.uploaded",
        subjectType: "location",
        subjectId: input.locationId,
        requestId: input.requestId,
        metadata: requestedPayload,
      })
    )
    return { id: attempt.id, status: "succeeded", idempotent: false }
  } catch (error) {
    await settle(
      input.organisationId,
      attempt.id,
      error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed",
      null,
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "media_upload_failed"
    )
    throw error
  }
}

export async function updateMedia(input: { organisationId: string; session: Session; locationId: string; mediaId: string; category: GoogleMediaCategory; expectedGoogleHash: string; requestId: string }) {
  const linked = await withTenant(input.organisationId, (sql) => context(sql, input.session, input.locationId)); requireWrite(linked)
  const item = await stored(input.organisationId, input.locationId, input.mediaId)
  if (item.googleHash !== input.expectedGoogleHash) throw new ApiError(409, "media_stale", "Refresh before overwriting newer Google media changes.")
  if (["COVER", "PROFILE"].includes(input.category)) throw new ApiError(422, "media_category_not_patchable", "Google does not allow changing an existing item to Cover or Profile.")
  const attempt = await mutation(input.organisationId, input.session, input.locationId, "update", input.requestId, item.id, input.expectedGoogleHash, { category: input.category })
  if (attempt.idempotent) return attempt
  try {
    const token = await connectionAccessToken(getDatabase(), input.organisationId, linked.connectionId)
    const current = await getGoogleMediaItem(token, item.googleMediaName, { connectionKey: linked.connectionId })
    if (mediaHash(current) !== input.expectedGoogleHash) throw new ApiError(409, "media_stale", "Google changed this media item. Refresh first.")
    await patchGoogleMediaItem(token, { name: item.googleMediaName, category: input.category }, { connectionKey: linked.connectionId })
    const readback = await getGoogleMediaItem(token, item.googleMediaName, { connectionKey: linked.connectionId })
    if ((readback.locationAssociation as Record<string, unknown> | undefined)?.category !== input.category) throw new ApiError(502, "media_readback_mismatch", "Google did not apply the approved category.")
    await settle(input.organisationId, attempt.id, "succeeded", readback)
    return { id: attempt.id, status: "succeeded", idempotent: false }
  } catch (error) { await settle(input.organisationId, attempt.id, error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed"); throw error }
}

export async function removeMedia(input: { organisationId: string; session: Session; locationId: string; mediaId: string; expectedGoogleHash: string; requestId: string }) {
  const linked = await withTenant(input.organisationId, (sql) => context(sql, input.session, input.locationId)); requireWrite(linked)
  const item = await stored(input.organisationId, input.locationId, input.mediaId)
  if (item.googleHash !== input.expectedGoogleHash) throw new ApiError(409, "media_stale", "Refresh before deleting changed media.")
  const attempt = await mutation(input.organisationId, input.session, input.locationId, "delete", input.requestId, item.id, input.expectedGoogleHash, null)
  if (attempt.idempotent) return attempt
  try {
    const token = await connectionAccessToken(getDatabase(), input.organisationId, linked.connectionId)
    const current = await getGoogleMediaItem(token, item.googleMediaName, { connectionKey: linked.connectionId })
    if (mediaHash(current) !== input.expectedGoogleHash) throw new ApiError(409, "media_stale", "Google changed this media item. Refresh first.")
    await deleteGoogleMediaItem(token, item.googleMediaName, { connectionKey: linked.connectionId })
    await settle(input.organisationId, attempt.id, "succeeded")
    await withTenant(input.organisationId, (sql) => writeAudit(sql, { organisationId: input.organisationId, actorUserId: input.session.userId, action: "media.deleted", subjectType: "media_item", subjectId: input.mediaId, requestId: input.requestId, metadata: { googleMediaName: item.googleMediaName } }))
    return { id: attempt.id, status: "succeeded", idempotent: false }
  } catch (error) { await settle(input.organisationId, attempt.id, error instanceof GoogleMutationAmbiguousError ? "ambiguous" : "failed"); throw error }
}
