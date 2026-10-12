import "server-only"

import type {
  BulkPhotoCurrent,
  BulkPhotoInput,
  BulkPhotoProposed,
} from "@/lib/domain/bulk-photos"
import { loadAsset, readAssetBytes } from "@/lib/server/assets"
import {
  bulkIntentId,
  outcomeOfAnsweredWrite,
  outcomeOfThrownWrite,
  receiptFor,
  reconcileFromReceipt,
} from "@/lib/server/bulk-families/shared"
import type {
  BulkFamily,
  DispatchOutcome,
} from "@/lib/server/bulk-families/types"
import type { TransactionSql } from "postgres"

import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import {
  liveMerchantMediaNames,
  uploadMediaFromAsset,
} from "@/lib/server/media"
import { assetStorage } from "@/lib/server/storage/asset-storage"

type Publication = {
  id: string
  status: "pending" | "published"
  childId: string | null
  childStatus: string | null
  googleMediaName: string | null
}

const livePublication = (
  organisationId: string,
  assetId: string,
  locationId: string
) =>
  withTenant(organisationId, async (sql) => {
    const [row] = await sql<Publication[]>`
      select p.id::text as id, p.status, p.bulk_listing_child_id::text as "childId",
        c.status as "childStatus", p.google_media_name as "googleMediaName"
      from media_asset_publication p
      left join bulk_listing_child c on c.id = p.bulk_listing_child_id
      where p.asset_id = ${assetId} and p.location_id = ${locationId}
        and p.status in ('pending', 'published')`
    return row ?? null
  })

/** A child whose publication may still land: its write is out or unresolved. */
const STILL_OPEN = new Set(["queued", "running", "ambiguous"])

/**
 * Photos (lib/domain/bulk-photos.ts): one owned asset added to each
 * listing as a new photo, through the media editor's own upload pipeline
 * (`uploadMediaFromAsset`): checkpointed upload, the unresolved-create
 * guard on the asset's SHA-256, readback, a receipt and media recovery.
 *
 * The preview freezes the asset's finalised SHA-256, type, size and
 * dimensions; dispatch sends only bytes read from the asset's immutable key
 * that still hash to it. Each listing's Google media name is recorded on
 * the asset's publication there (media_asset_publication), so the same
 * asset is never added to a listing twice: a listing that already shows it
 * is `already_applied`.
 */
export const photosFamily: BulkFamily<BulkPhotoInput> = {
  operations: ["photos"],
  resourceKey: "media",
  writeSurface: "media",
  accountLock: false,
  async plan(input, linked, reads) {
    const loaded = await reads.once(`asset:${input.assetId}`, () =>
      loadAsset(linked.organisationId, input.assetId)
    )
    if (!loaded) return { eligible: false, reason: "asset_not_found" }
    if (!("asset" in loaded))
      return { eligible: false, reason: "asset_not_ready" }
    if (!assetStorage())
      return { eligible: false, reason: "asset_storage_unavailable" }
    const asset = loaded.asset
    const publication = await livePublication(
      linked.organisationId,
      asset.id,
      linked.locationId
    )
    let previousMediaName: string | null = null
    if (publication?.status === "pending")
      return { eligible: false, reason: "photo_publication_pending" }
    if (publication?.status === "published") {
      // A person may have adopted it without a name: it is there.
      if (!publication.googleMediaName)
        return { eligible: false, reason: "already_applied" }
      const live = await reads.once("media:merchant_names", () =>
        liveMerchantMediaNames(linked)
      )
      if (live.includes(publication.googleMediaName))
        return { eligible: false, reason: "already_applied" }
      // Deleted on Google since: adding it again is a new photo.
      previousMediaName = publication.googleMediaName
    }
    const current: BulkPhotoCurrent = { previousMediaName }
    const proposed: BulkPhotoProposed = {
      assetId: asset.id,
      sha256: asset.sha256,
      contentType: asset.contentType,
      byteLength: asset.byteLength,
      width: asset.width,
      height: asset.height,
      fileName: asset.fileName,
      category: input.category,
      description: input.description ?? null,
    }
    return { eligible: true, current, proposed, updateMask: ["media"] }
  },
  async dispatch(context) {
    if (!context.stillOpen()) return { kind: "expired" }
    const { organisationId, childId, locationId } = context
    const proposed = context.proposed as BulkPhotoProposed
    const current = context.current as BulkPhotoCurrent
    const loaded = await loadAsset(organisationId, proposed.assetId)
    if (
      !loaded ||
      !("asset" in loaded) ||
      loaded.asset.sha256 !== proposed.sha256
    )
      return { kind: "conflict", code: "asset_changed" }
    const asset = loaded.asset
    // Claim the asset's publication at this listing for this child: one
    // pending or published row per (asset, listing), under its row lock.
    const claim = await withTenant(organisationId, async (sql) => {
      const [live] = await sql<Publication[]>`
        select p.id::text as id, p.status, p.bulk_listing_child_id::text as "childId",
          c.status as "childStatus", p.google_media_name as "googleMediaName"
        from media_asset_publication p
        left join bulk_listing_child c on c.id = p.bulk_listing_child_id
        where p.asset_id = ${asset.id} and p.location_id = ${locationId}
          and p.status in ('pending', 'published')
        for update of p`
      if (live?.childId === childId)
        return live.status === "published" ? "done" : "reclaimed"
      if (live?.status === "published") {
        // The one the preview saw gone from Google is superseded; any other
        // was added after the preview.
        if (
          !current.previousMediaName ||
          live.googleMediaName !== current.previousMediaName
        )
          return "added_since"
        await sql`update media_asset_publication set status = 'removed' where id = ${live.id}`
      } else if (live) {
        if (live.childStatus && STILL_OPEN.has(live.childStatus))
          return "pending_elsewhere"
        // A pending row whose child settled without sending (or vanished).
        await sql`update media_asset_publication set status = 'failed' where id = ${live.id}`
      }
      await sql`
        insert into media_asset_publication (
          organisation_id, asset_id, location_id, bulk_listing_child_id, category
        ) values (
          ${organisationId}, ${asset.id}, ${locationId}, ${childId}, ${proposed.category}
        )`
      return "send"
    })
    // A re-claimed child (a retry, a crashed tick) whose earlier claim
    // already sent a create: that create is settled from its own receipt
    // and never sent again. A media create left unresolved there waits for
    // recovery or a person; only one that did not apply is sent afresh.
    if (claim === "done" || claim === "reclaimed") {
      const earlier = await earlierReceipt(context)
      if (claim === "done")
        return {
          kind: "succeeded",
          confirmation: "confirmed",
          ...(earlier ? { operationId: earlier.id } : {}),
        }
      if (earlier) {
        const settled = reconcileFromReceipt(earlier)
        if (settled?.kind === "succeeded") {
          await withTenant(organisationId, (sql) =>
            publishFromReceipt(sql, childId, earlier.id)
          )
          return { ...settled, operationId: earlier.id }
        }
        if (!settled)
          return {
            kind: "ambiguous",
            code: "media_create_unresolved",
            operationId: earlier.id,
          }
      }
    }
    if (claim === "added_since")
      return { kind: "conflict", code: "photo_already_added" }
    if (claim === "pending_elsewhere")
      return { kind: "conflict", code: "photo_publication_pending" }
    const failPublication = () =>
      withTenant(
        organisationId,
        (sql) => sql`
          update media_asset_publication set status = 'failed'
          where bulk_listing_child_id = ${childId} and status = 'pending'`
      )
    let bytes: Uint8Array
    try {
      bytes = await readAssetBytes(asset)
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "asset_storage_unavailable"
      )
        return { kind: "deferred", code: error.code }
      await failPublication()
      return {
        kind: "failed",
        code: error instanceof ApiError ? error.code : "asset_integrity_failed",
      }
    }
    if (!context.stillOpen()) return { kind: "expired" }
    let outcome: DispatchOutcome
    try {
      await uploadMediaFromAsset({
        organisationId,
        session: context.session,
        locationId,
        linked: context.linked,
        asset: {
          id: asset.id,
          fileName: asset.fileName,
          contentType: asset.contentType,
          sha256: asset.sha256,
          bytes,
        },
        category: proposed.category,
        description: proposed.description,
        requestId: context.requestId,
        intentId: context.intentId,
        approvalRef: context.approvalRef,
        // In the settle transaction of the create: the listing's own
        // Google media name for this asset.
        afterCreate: async (sql, created) => {
          const name =
            typeof created.item?.name === "string" ? created.item.name : null
          await sql`
            update media_asset_publication set status = 'published',
              google_media_name = ${name}, gbp_media_mutation_id = ${created.attemptId},
              published_at = now()
            where bulk_listing_child_id = ${childId} and status = 'pending'`
        },
      })
      const receipt = await receiptFor(organisationId, context.intentId)
      outcome = receipt
        ? outcomeOfAnsweredWrite(receipt.state)
        : { kind: "succeeded", confirmation: "unrecorded" }
    } catch (error) {
      outcome = await outcomeOfThrownWrite(
        organisationId,
        context.intentId,
        error
      )
    }
    if (outcome.kind === "failed") await failPublication()
    return {
      ...outcome,
      observed: { previousMediaName: current.previousMediaName },
    }
  },
  reconcile: reconcileFromReceipt,
  async afterReconcile(sql, child, verdict) {
    if (verdict.kind === "failed") {
      await sql`
        update media_asset_publication set status = 'failed'
        where bulk_listing_child_id = ${child.childId} and status = 'pending'`
      return
    }
    const [row] = await sql<{ operationId: string | null }[]>`
      select mutation_operation_id::text as "operationId"
      from bulk_listing_child where id = ${child.childId}`
    if (row?.operationId)
      await publishFromReceipt(sql, child.childId, row.operationId)
  },
}

/**
 * The latest receipt an earlier claim of this child recorded, if any
 * (`bulkIntentId(childId, n)` for each earlier claim n).
 */
async function earlierReceipt(context: {
  organisationId: string
  childId: string
  attempt: number
}) {
  const intents = Array.from(
    { length: Math.max(0, context.attempt - 1) },
    (_, n) => bulkIntentId(context.childId, n + 1)
  )
  if (!intents.length) return null
  const [row] = await withTenant(
    context.organisationId,
    (sql) => sql<
      {
        id: string
        state: OperationOutcome
        errorCode: string | null
        attemptStatus: string | null
      }[]
    >`
      select id::text as id, state, error_code as "errorCode",
        receipt->>'attemptStatus' as "attemptStatus"
      from mutation_operation
      where organisation_id = ${context.organisationId}
        and intent_id in ${sql(intents)}
      order by created_at desc
      limit 1`
  )
  return row ?? null
}

/**
 * Records the photo on the listing from a settled media receipt: the
 * attempt's read-back item names it (a person's adoption records no name).
 */
async function publishFromReceipt(
  sql: TransactionSql,
  childId: string,
  operationId: string
) {
  await sql`
    update media_asset_publication p set status = 'published',
      gbp_media_mutation_id = m.id,
      google_media_name = m.google_response->>'name',
      published_at = now()
    from mutation_operation o
    join gbp_media_mutation m on m.id = o.attempt_id and o.attempt_table = 'gbp_media_mutation'
    where o.id = ${operationId} and p.bulk_listing_child_id = ${childId}
      and p.status = 'pending'`
}
