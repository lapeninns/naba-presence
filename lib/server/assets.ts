import "server-only"

import type { TransactionSql } from "postgres"

import type { AssetCreateRequest, AssetView } from "@/lib/contracts/assets"
import { ASSET_STATUSES } from "@/lib/contracts/assets"
import {
  ASSET_PHOTO_MAX_BYTES,
  checkPhotoBytes,
} from "@/lib/domain/media-sniff"
import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import type { Session } from "@/lib/server/session"
import {
  assetStorage,
  finalKey,
  requireAssetStorage,
  stagingKey,
  type AssetStorage,
} from "@/lib/server/storage/asset-storage"

/**
 * Owned photo assets (plan P09-R7): photos the organisation uploads once
 * and bulk changes add to many listings. Every asset lives in the private
 * bucket (lib/server/storage); this module is its only door and checks the
 * tenant itself, since every row is read under the tenant's RLS
 * (`withTenant`): another organisation's asset id is simply not found.
 *
 * Assets serve bulk photos only, so they ship behind the same org feature
 * (`bulk_actions`), and every route fails closed while storage is not
 * configured (503 asset_storage_unavailable).
 */

const NOT_FOUND = () =>
  new ApiError(404, "asset_not_found", "The photo was not found.")
const FEATURE_DISABLED = () =>
  new ApiError(
    404,
    "feature_disabled",
    "Bulk changes are not available for this workspace."
  )

async function requireAssetAccess(sql: TransactionSql, session: Session) {
  if (!(await isOrgFeatureEnabled(sql, session.organisationId, "bulk_actions")))
    throw FEATURE_DISABLED()
  if (session.role === "viewer")
    throw new ApiError(403, "forbidden", "Viewers cannot add photos.")
}

type AssetRow = {
  id: string
  status: (typeof ASSET_STATUSES)[number]
  fileName: string
  declaredContentType: string
  declaredByteLength: number
  declaredSha256: string
  stagingKey: string
  finalKey: string | null
  sha256: string | null
  contentType: string | null
  byteLength: number | null
  width: number | null
  height: number | null
  rejectionCode: string | null
  stagingExpiresAt: Date
  stagingPurgedAt: Date | null
  finalisedAt: Date | null
  createdAt: Date
}

const assetColumns = (sql: TransactionSql) => sql`
  id::text as id, status, file_name as "fileName",
  declared_content_type as "declaredContentType",
  declared_byte_length as "declaredByteLength",
  declared_sha256 as "declaredSha256", staging_key as "stagingKey",
  final_key as "finalKey", sha256, content_type as "contentType",
  byte_length as "byteLength", width, height,
  rejection_code as "rejectionCode", staging_expires_at as "stagingExpiresAt",
  staging_purged_at as "stagingPurgedAt", finalised_at as "finalisedAt",
  created_at as "createdAt"`

function view(row: AssetRow): AssetView {
  return {
    id: row.id,
    status: row.status,
    mediaFormat: "PHOTO",
    fileName: row.fileName,
    contentType: row.contentType ?? row.declaredContentType,
    byteLength: row.byteLength ?? row.declaredByteLength,
    sha256: row.sha256 ?? row.declaredSha256,
    width: row.width,
    height: row.height,
    rejectionCode: row.rejectionCode,
    stagingExpiresAt: row.stagingExpiresAt.toISOString(),
    finalisedAt: row.finalisedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Starts an upload: a staging asset and a signed URL for its one staging
 * object. What the client declares is only recorded here; finalise checks
 * the bytes against it.
 */
export async function createAsset(
  session: Session,
  input: AssetCreateRequest,
  requestId: string
) {
  const storage = requireAssetStorage()
  const asset = await withTenant(session.organisationId, async (sql) => {
    await requireAssetAccess(sql, session)
    const [row] = await sql<AssetRow[]>`
      with id as (select gen_random_uuid() as id)
      insert into media_asset (
        id, organisation_id, created_by, file_name, declared_content_type,
        declared_byte_length, declared_sha256, staging_key
      )
      select id.id, ${session.organisationId}, ${session.userId}, ${input.fileName},
        ${input.contentType}, ${input.byteLength}, ${input.sha256},
        'staging/' || ${session.organisationId}::text || '/' || id.id::text
      from id
      returning ${assetColumns(sql)}`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "asset.upload_started",
      subjectType: "media_asset",
      subjectId: row.id,
      requestId,
      metadata: {
        contentType: input.contentType,
        byteLength: input.byteLength,
        sha256: input.sha256,
      },
    })
    return row
  })
  // The key is the app's own (organisation and asset id), never the client's.
  if (asset.stagingKey !== stagingKey(session.organisationId, asset.id))
    throw new ApiError(500, "asset_key_invalid", "The upload could not start.")
  const upload = await storage.signedUpload(asset.stagingKey, {
    contentType: input.contentType,
  })
  return { asset: view(asset), upload }
}

type FinaliseResult =
  { kind: "ready"; asset: AssetView } | { kind: "rejected"; code: string }

const REJECTION_MESSAGE: Record<string, string> = {
  asset_type_unsupported: "The file is not a JPEG or PNG photo.",
  asset_type_mismatch: "The file is not the type it was declared as.",
  asset_size_mismatch: "The uploaded file is not the size that was declared.",
  asset_too_small: "Google requires photos to be at least 10 KB.",
  asset_too_large: "Photos can be at most 5 MB.",
  asset_dimensions_too_small:
    "Google requires photos to be at least 250 × 250 pixels.",
  asset_dimensions_invalid: "The photo’s dimensions could not be read.",
  asset_sha256_mismatch:
    "The uploaded file is not the one that was declared. Upload it again.",
}

/**
 * Checks the staged bytes and makes the asset `ready`: the bytes the server
 * read and hashed (never what the client declared) are written once to the
 * asset's immutable key, `assets/<org>/<sha256>/<id>`. A failed check
 * rejects the asset for good (422); upload the file again as a new asset.
 * Runs under the asset's row lock, so two finalises cannot interleave, and
 * a finalised asset answers with itself.
 */
export async function finaliseAsset(
  session: Session,
  assetId: string,
  requestId: string
): Promise<AssetView> {
  const storage = requireAssetStorage()
  const result = await withTenant(
    session.organisationId,
    async (sql): Promise<FinaliseResult> => {
      await requireAssetAccess(sql, session)
      const [row] = await sql<(AssetRow & { expired: boolean })[]>`
        select ${assetColumns(sql)}, staging_expires_at <= now() as expired
        from media_asset where id = ${assetId} for update`
      if (!row) throw NOT_FOUND()
      if (row.status === "ready") return { kind: "ready", asset: view(row) }
      if (row.status !== "staging")
        throw new ApiError(
          409,
          "asset_not_staging",
          "This upload can no longer be finished. Upload the photo again."
        )
      if (row.expired)
        throw new ApiError(
          409,
          "asset_staging_expired",
          "This upload expired. Upload the photo again."
        )
      const reject = async (code: string) => {
        await sql`
          update media_asset set status = 'rejected', rejection_code = ${code},
            updated_at = now()
          where id = ${row.id}`
        await writeAudit(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          action: "asset.rejected",
          subjectType: "media_asset",
          subjectId: row.id,
          requestId,
          metadata: { code },
        })
        await removeStaging(sql, storage, row)
        return { kind: "rejected" as const, code }
      }
      let bytes: Uint8Array | null
      try {
        bytes = await storage.read(row.stagingKey, ASSET_PHOTO_MAX_BYTES)
      } catch (error) {
        if (error instanceof ApiError && error.code === "asset_too_large")
          return reject("asset_too_large")
        throw error
      }
      if (!bytes)
        throw new ApiError(
          409,
          "asset_not_uploaded",
          "The photo has not been uploaded yet."
        )
      const digest = sha256(Buffer.from(bytes))
      const check = checkPhotoBytes(bytes, digest, {
        contentType: row.declaredContentType,
        byteLength: row.declaredByteLength,
        sha256: row.declaredSha256,
      })
      if (!check.ok) return reject(check.code)
      const key = finalKey(session.organisationId, digest, row.id)
      const written = await storage.writeOnce(
        key,
        bytes,
        check.image.contentType
      )
      if (written === "exists") {
        // Only a finalise of this asset writes this key; an earlier one that
        // stopped after the write left exactly these bytes, or it is refused.
        const existing = await storage.read(key, ASSET_PHOTO_MAX_BYTES)
        if (!existing || sha256(Buffer.from(existing)) !== digest)
          throw new ApiError(
            500,
            "asset_final_conflict",
            "The photo could not be stored. Upload it again."
          )
      }
      const [ready] = await sql<AssetRow[]>`
        update media_asset set status = 'ready', final_key = ${key},
          sha256 = ${digest}, content_type = ${check.image.contentType},
          byte_length = ${bytes.length}, width = ${check.image.width},
          height = ${check.image.height}, finalised_at = now(), updated_at = now()
        where id = ${row.id}
        returning ${assetColumns(sql)}`
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "asset.finalised",
        subjectType: "media_asset",
        subjectId: row.id,
        requestId,
        metadata: {
          sha256: digest,
          contentType: check.image.contentType,
          byteLength: bytes.length,
          width: check.image.width,
          height: check.image.height,
        },
      })
      await removeStaging(sql, storage, row)
      return { kind: "ready", asset: view(ready) }
    }
  )
  if (result.kind === "rejected")
    throw new ApiError(
      422,
      result.code,
      REJECTION_MESSAGE[result.code] ?? "The photo was not accepted."
    )
  return result.asset
}

/**
 * Deletes the staged object, best effort: the bytes now live at the final
 * key (or were refused). One left behind is the retention cron's to delete.
 */
async function removeStaging(
  sql: TransactionSql,
  storage: AssetStorage,
  row: Pick<AssetRow, "id" | "stagingKey">
) {
  try {
    await storage.remove([row.stagingKey])
    await sql`update media_asset set staging_purged_at = now() where id = ${row.id}`
  } catch (error) {
    log.warn("asset.staging_remove_failed", { assetId: row.id, error })
  }
}

export async function listAssets(
  session: Session,
  query: { status?: AssetView["status"] }
): Promise<AssetView[]> {
  return withTenant(session.organisationId, async (sql) => {
    await requireAssetAccess(sql, session)
    const rows = await sql<AssetRow[]>`
      select ${assetColumns(sql)} from media_asset
      where ${query.status ? sql`status = ${query.status}` : sql`status <> 'purged'`}
      order by created_at desc
      limit 100`
    return rows.map(view)
  })
}

/** A ready asset as a bulk preview freezes it. */
export type ReadyAsset = {
  id: string
  fileName: string
  finalKey: string
  sha256: string
  contentType: string
  byteLength: number
  width: number
  height: number
}

/** The organisation's asset by id: `ready`, another status, or not found (any other tenant's). */
export async function loadAsset(
  organisationId: string,
  assetId: string
): Promise<{ status: "ready"; asset: ReadyAsset } | { status: string } | null> {
  const [row] = await withTenant(
    organisationId,
    (sql) => sql<AssetRow[]>`
      select ${assetColumns(sql)} from media_asset where id = ${assetId}`
  )
  if (!row) return null
  if (row.status !== "ready") return { status: row.status }
  return {
    status: "ready",
    asset: {
      id: row.id,
      fileName: row.fileName,
      finalKey: row.finalKey!,
      sha256: row.sha256!,
      contentType: row.contentType!,
      byteLength: row.byteLength!,
      width: row.width!,
      height: row.height!,
    },
  }
}

/**
 * A ready asset's bytes from its immutable key, re-hashed: anything but the
 * finalised SHA-256 is refused (`asset_integrity_failed`), so a listing is
 * only ever sent the bytes that were checked.
 */
export async function readAssetBytes(asset: ReadyAsset): Promise<Uint8Array> {
  const storage = requireAssetStorage()
  const bytes = await storage.read(asset.finalKey, ASSET_PHOTO_MAX_BYTES)
  if (!bytes || sha256(Buffer.from(bytes)) !== asset.sha256)
    throw new ApiError(
      500,
      "asset_integrity_failed",
      "The stored photo does not match what was checked."
    )
  return bytes
}

/**
 * Retention (app/api/cron/retention): deletes staged objects 24 hours after
 * the upload started, for every asset still holding one. An asset that was
 * never finalised becomes `purged`; ready and rejected ones keep their
 * status. Rows being finalised right now are skipped (row lock). Returns
 * null when storage is not configured, so nothing is touched.
 */
export async function purgeExpiredStagingAssets(
  organisationId: string,
  limit = 100
): Promise<number | null> {
  const storage = assetStorage()
  if (!storage) return null
  return withTenant(organisationId, async (sql) => {
    const due = await sql<{ id: string; stagingKey: string }[]>`
      select id::text as id, staging_key as "stagingKey" from media_asset
      where staging_purged_at is null and staging_expires_at <= now()
      order by staging_expires_at
      limit ${limit}
      for update skip locked`
    if (!due.length) return 0
    await storage.remove(due.map((row) => row.stagingKey))
    await sql`
      update media_asset set staging_purged_at = now(),
        status = case when status = 'staging' then 'purged' else status end,
        updated_at = now()
      where id in ${sql(due.map((row) => row.id))}`
    return due.length
  })
}
