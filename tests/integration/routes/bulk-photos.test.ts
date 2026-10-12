import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { assetCreateResponseSchema } from "@/lib/contracts/assets"
import {
  bulkOperationResponseSchema,
  type BulkOperationView,
} from "@/lib/contracts/bulk-listings"
import { jpegBytes, pngBytes, sha256Hex } from "../../helpers/photo-fixtures"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { startStorageStub, type StorageStub } from "../helpers/storage-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
const CRON = { authorization: "Bearer route-harness-cron-secret" }

type Listing = {
  merchant: Array<Record<string, unknown>>
  /** The next create lands on Google but its answer is lost (503). */
  loseCreate?: boolean
}

/** The stub listing a Google path belongs to (`locations/stub-…`). */
const listingOf = (path: string) =>
  /locations\/stub-[^/?:]+/.exec(path)?.[0] ?? ""

/**
 * P09-R7 through real routes, the real job tick and the real Supabase
 * Storage adapter against a local storage stub: owned photo assets
 * (staging upload, byte checks, immutable final key, staging purge) and the
 * bulk photos family, sent through the media upload pipeline with receipts,
 * per-listing Google media names and media recovery.
 */
describeDatabase("bulk photos and private assets", { timeout: 60_000 }, () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let storage: StorageStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const listings = new Map<string, Listing>()
  let created = 0

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    google = await startGoogleStub()
    storage = await startStorageStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      PUBLISH_ENABLED: "true",
      JOBS_ENABLED: "true",
      GBP_MEDIA_ENABLED: "true",
      MEDIA_ASSET_STORAGE: "supabase",
      SUPABASE_URL: storage.baseUrl,
      SUPABASE_SECRET_KEY: storage.secretKey,
      MEDIA_ASSETS_BUCKET: storage.bucket,
    })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await storage.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  beforeEach(() => {
    listings.clear()
    google.reset()
    storage.down = false
    google.respond(
      { method: "POST", pathIncludes: "/media:startUpload" },
      () => ({ status: 200, json: { resourceName: `ref-${randomUUID()}` } })
    )
    google.respond(
      { method: "POST", pathIncludes: "/upload/v1/media/" },
      () => ({ status: 200, json: {} })
    )
    google.respond({ method: "POST", pathEndsWith: "/media" }, (call) => {
      const state = listings.get(listingOf(call.path))
      if (!state) return { status: 404, json: {} }
      created += 1
      const item = {
        ...(call.body as Record<string, unknown>),
        name: `${listingOf(call.path)}/media/photo-${created}`,
        createTime: new Date().toISOString(),
      }
      // A lost answer: Google's list never shows an item that accounts for
      // it, so recovery cannot match it and a person decides.
      if (state.loseCreate) {
        state.loseCreate = false
        return { status: 503, json: {} }
      }
      state.merchant.push(item)
      return { status: 200, json: item }
    })
    google.respond({ method: "GET", pathIncludes: "/media" }, (call) => {
      const state = listings.get(listingOf(call.path))
      if (!state) return { status: 404, json: {} }
      if (call.path.includes("/media/customers"))
        return { status: 200, json: { mediaItems: [] } }
      const item = state.merchant.find((entry) =>
        call.path.split("?")[0].endsWith(String(entry.name))
      )
      if (item) return { status: 200, json: item }
      return { status: 200, json: { mediaItems: state.merchant } }
    })
  })

  const creates = (name?: string) =>
    google.calls.filter(
      (call) =>
        call.method === "POST" &&
        call.path.endsWith("/media") &&
        (!name || call.path.includes(name))
    )
  const tick = async () => {
    const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }

  async function tenant(count: number, options: { feature?: boolean } = {}) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    if (options.feature !== false)
      await admin`
        insert into organisation_feature (organisation_id, feature, enabled, changed_by)
        values (${owner.organisationId}, 'bulk_actions', true, 'test')`
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked: Awaited<ReturnType<typeof seedLinkedLocation>>[] = []
    for (let index = 0; index < count; index += 1) {
      const location = await seedLinkedLocation(admin, {
        organisationId: owner.organisationId,
        ...connection,
      })
      listings.set(location.googleLocationName, { merchant: [] })
      linked.push(location)
    }
    const call = (path: string, body?: unknown, cookie = owner.cookie) =>
      fetch(`${server.baseUrl}/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { cookie, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    /** Steps 1 and 2 of an upload: declare, then PUT the bytes to the signed URL. */
    const stage = async (
      bytes: Uint8Array,
      declared: Partial<{
        contentType: string
        byteLength: number
        sha256: string
      }> = {},
      cookie = owner.cookie
    ) => {
      const response = await call(
        "/assets",
        {
          fileName: "photo.png",
          contentType: "image/png",
          byteLength: bytes.length,
          sha256: sha256Hex(bytes),
          ...declared,
        },
        cookie
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const started = assetCreateResponseSchema.parse(await response.json())
      const put = await fetch(started.upload.url, {
        method: "PUT",
        headers: started.upload.headers,
        body: bytes as BodyInit,
      })
      expect(put.status, await put.clone().text()).toBe(200)
      return started.asset
    }
    const finalise = (id: string, cookie = owner.cookie) =>
      call(`/assets/${id}/finalise`, {}, cookie)
    const readyAsset = async (bytes = pngBytes(800, 600)) => {
      const asset = await stage(bytes, {
        contentType: bytes[0] === 0xff ? "image/jpeg" : "image/png",
      })
      const response = await finalise(asset.id)
      expect(response.status, await response.clone().text()).toBe(200)
      return asset
    }
    const read = async (response: Response) => {
      expect(response.status, await response.clone().text()).toBeLessThan(300)
      return bulkOperationResponseSchema.parse(await response.json()).operation
    }
    const preview = async (items: unknown[], ids = linked) =>
      read(
        await call("/listings/bulk/preview", {
          locationIds: ids.map((entry) => entry.locationId),
          items,
        })
      )
    const run = async (op: BulkOperationView, acknowledgeSkipped = false) => {
      await read(
        await call(`/listings/bulk/${op.id}/approve`, {
          expectedPreviewHash: op.previewHash,
          acknowledgeSkipped,
        })
      )
      expect((await call(`/listings/bulk/${op.id}/execute`, {})).status).toBe(
        202
      )
    }
    const status = async (op: BulkOperationView) =>
      read(await call(`/listings/bulk/${op.id}`))
    const publications = (assetId: string) =>
      admin<
        { locationId: string; status: string; googleMediaName: string | null }[]
      >`
        select location_id::text as "locationId", status,
          google_media_name as "googleMediaName"
        from media_asset_publication where asset_id = ${assetId}
        order by created_at`
    return {
      owner,
      linked,
      call,
      stage,
      finalise,
      readyAsset,
      preview,
      run,
      status,
      publications,
    }
  }

  it("finalises checked bytes once to an immutable key and refuses spoofed or foreign uploads", async () => {
    const t = await tenant(1)
    const bytes = pngBytes(800, 600)
    const asset = await t.stage(bytes)
    expect(asset.status).toBe("staging")
    const staging = `staging/${t.owner.organisationId}/${asset.id}`
    expect(storage.objects.has(staging)).toBe(true)

    // Another organisation cannot finalise (or see) it.
    const other = await tenant(1)
    const foreign = await other.finalise(asset.id)
    expect(foreign.status).toBe(404)
    expect((await foreign.json()).error).toBe("asset_not_found")

    const done = await t.finalise(asset.id)
    expect(done.status, await done.clone().text()).toBe(200)
    expect((await done.json()).asset).toMatchObject({
      status: "ready",
      width: 800,
      height: 600,
      sha256: sha256Hex(bytes),
    })
    const finalKey = `assets/${t.owner.organisationId}/${sha256Hex(bytes)}/${asset.id}`
    expect(
      storage.objects.get(finalKey)?.bytes.equals(Buffer.from(bytes))
    ).toBe(true)
    expect(storage.objects.has(staging)).toBe(false)
    // Finalising again answers with the asset; the content is immutable.
    expect((await t.finalise(asset.id)).status).toBe(200)
    await expect(
      admin`update media_asset set sha256 = ${"0".repeat(64)} where id = ${asset.id}`
    ).rejects.toThrow(/immutable/)

    // A PNG declared as a JPEG is rejected by its bytes.
    const spoof = await t.stage(pngBytes(800, 600, 13_000), {
      contentType: "image/jpeg",
    })
    const refused = await t.finalise(spoof.id)
    expect(refused.status).toBe(422)
    expect((await refused.json()).error).toBe("asset_type_mismatch")
    const [rejected] = await admin<{ status: string; code: string }[]>`
      select status, rejection_code as code from media_asset where id = ${spoof.id}`
    expect(rejected).toEqual({
      status: "rejected",
      code: "asset_type_mismatch",
    })

    // Bytes that are not the declared ones.
    const swapped = await t.stage(jpegBytes(900, 900), {
      contentType: "image/jpeg",
      sha256: "a".repeat(64),
    })
    const mismatch = await t.finalise(swapped.id)
    expect((await mismatch.json()).error).toBe("asset_sha256_mismatch")

    // Without the feature the routes do not exist.
    const dark = await tenant(1, { feature: false })
    const off = await dark.call("/assets", {
      fileName: "a.png",
      contentType: "image/png",
      byteLength: 20_000,
      sha256: "b".repeat(64),
    })
    expect(off.status).toBe(404)
  })

  it("purges staged uploads after 24 hours from storage and the row", async () => {
    const t = await tenant(1)
    const asset = await t.stage(pngBytes(640, 480))
    const ready = await t.readyAsset(jpegBytes(640, 480))
    const staging = `staging/${t.owner.organisationId}/${asset.id}`
    await admin`
      update media_asset set staging_expires_at = now() - interval '1 minute'
      where id in ${admin([asset.id, ready.id])}`
    const response = await fetch(`${server.baseUrl}/api/cron/retention`, {
      method: "POST",
      headers: CRON,
    })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(storage.objects.has(staging)).toBe(false)
    const rows = await admin<{ id: string; status: string; purged: boolean }[]>`
      select id::text as id, status, staging_purged_at is not null as purged
      from media_asset where id in ${admin([asset.id, ready.id])}`
    expect(rows.find((row) => row.id === asset.id)).toMatchObject({
      status: "purged",
      purged: true,
    })
    // A finalised asset keeps its status and its final object.
    expect(rows.find((row) => row.id === ready.id)).toMatchObject({
      status: "ready",
    })
    expect((await t.finalise(asset.id)).status).toBe(409)
  })

  it("adds an owned photo to each listing once, with receipts and per-listing Google names", async () => {
    const t = await tenant(2)
    const bytes = pngBytes(1024, 768)
    const asset = await t.readyAsset(bytes)
    const item = {
      operation: "photos",
      assetId: asset.id,
      category: "INTERIOR",
    }
    const op = await t.preview([item])
    expect(op.children.map((child) => child.eligibility)).toEqual([
      "eligible",
      "eligible",
    ])
    expect(op.children[0].proposedValue).toMatchObject({
      assetId: asset.id,
      sha256: sha256Hex(bytes),
      width: 1024,
      height: 768,
      category: "INTERIOR",
    })
    await t.run(op)
    await tick()
    const done = await t.status(op)
    expect(done.status).toBe("completed")
    expect(done.children.map((child) => child.status)).toEqual([
      "succeeded",
      "succeeded",
    ])
    expect(creates()).toHaveLength(2)
    const uploads = google.calls.filter((call) =>
      call.path.includes("/upload/v1/media/")
    )
    expect(uploads).toHaveLength(2)
    const pubs = await t.publications(asset.id)
    expect(pubs.map((row) => row.status)).toEqual(["published", "published"])
    for (const [index, location] of t.linked.entries()) {
      const pub = pubs.find((row) => row.locationId === location.locationId)!
      expect(pub.googleMediaName).toContain(location.googleLocationName)
      const receiptId = done.children.find(
        (child) => child.locationId === t.linked[index].locationId
      )!.mutationOperationId!
      const [receipt] = await admin<
        { surface: string; state: string; approvalRef: string }[]
      >`
        select surface, state, approval_ref as "approvalRef"
        from mutation_operation where id = ${receiptId}`
      expect(receipt).toEqual({
        surface: "media",
        state: "confirmed_applied",
        approvalRef: `bulk_listing_operation:${op.id}`,
      })
    }

    // The same asset again: already on both listings.
    const again = await t.preview([item])
    expect(again.children.map((child) => child.skipReason)).toEqual([
      "already_applied",
      "already_applied",
    ])
    // Deleted on Google since: it may be added again, as a new photo.
    listings.get(t.linked[0].googleLocationName)!.merchant.length = 0
    const readd = await t.preview([item], [t.linked[0]])
    expect(readd.children[0]).toMatchObject({ eligibility: "eligible" })
    await t.run(readd)
    await tick()
    expect((await t.status(readd)).children[0].status).toBe("succeeded")
    const after = await t.publications(asset.id)
    expect(after.map((row) => row.status).sort()).toEqual([
      "published",
      "published",
      "removed",
    ])
  })

  it("skips another organisation's or an unfinished asset and refuses more than 10 photos", async () => {
    const t = await tenant(1)
    const other = await tenant(1)
    const foreign = await other.readyAsset()
    const staged = await t.stage(pngBytes(500, 500))
    const op = await t.preview([
      { operation: "photos", assetId: foreign.id, category: "INTERIOR" },
      { operation: "photos", assetId: staged.id, category: "EXTERIOR" },
    ])
    expect(op.children.map((child) => child.skipReason)).toEqual([
      "asset_not_found",
      "asset_not_ready",
    ])
    const tooMany = await t.call("/listings/bulk/preview", {
      locationIds: [t.linked[0].locationId],
      items: Array.from({ length: 11 }, () => ({
        operation: "photos",
        assetId: randomUUID(),
        category: "INTERIOR",
      })),
    })
    expect(tooMany.status).toBe(400)
    expect(creates()).toHaveLength(0)
  })

  it("waits on a person for an unconfirmed create, never sending it twice, then records the photo", async () => {
    const t = await tenant(1)
    const name = t.linked[0].googleLocationName
    const asset = await t.readyAsset()
    listings.get(name)!.loseCreate = true
    const op = await t.preview([
      { operation: "photos", assetId: asset.id, category: "INTERIOR" },
    ])
    await t.run(op)
    await tick()
    const pending = await t.status(op)
    expect(pending.children[0]).toMatchObject({
      status: "ambiguous",
      confirmationState: "unresolved",
    })
    expect(creates(name)).toHaveLength(1)
    const [pub] = await t.publications(asset.id)
    expect(pub.status).toBe("pending")
    // Another batch for the same asset and listing waits on it.
    const blocked = await t.preview([
      { operation: "photos", assetId: asset.id, category: "INTERIOR" },
    ])
    expect(blocked.children[0].skipReason).toBe("photo_publication_pending")
    // A retry of the child is refused by the unresolved-create guard.
    const retry = await t.call(`/listings/bulk/${op.id}/retry`, {})
    expect(retry.status, await retry.clone().text()).toBeLessThan(300)
    await tick()
    expect(creates(name)).toHaveLength(1)

    // A person checks Google and says it is there.
    const [attempt] = await admin<{ id: string }[]>`
      select id::text as id from gbp_media_mutation
      where organisation_id = ${t.owner.organisationId}
        and status = 'needs_resolution'`
    const resolve = await fetch(
      `${server.baseUrl}/api/locations/${t.linked[0].locationId}/media/resolutions/${attempt.id}`,
      {
        method: "POST",
        headers: { cookie: t.owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          resolution: "adopted",
          confirmation: "resolve_google_media",
        }),
      }
    )
    expect(resolve.status, await resolve.clone().text()).toBe(200)
    await tick()
    const settled = await t.status(op)
    expect(settled.children[0].status).toBe("succeeded")
    expect((await t.publications(asset.id))[0].status).toBe("published")
    expect(creates(name)).toHaveLength(1)
  })

  it("defers while storage is down and refuses unknown families in the tables", async () => {
    const t = await tenant(1)
    const asset = await t.readyAsset()
    const op = await t.preview([
      { operation: "photos", assetId: asset.id, category: "INTERIOR" },
    ])
    await t.run(op)
    storage.down = true
    await tick()
    const waiting = await t.status(op)
    expect(waiting.children[0]).toMatchObject({
      status: "queued",
      resultCode: "asset_storage_unavailable",
    })
    expect(creates()).toHaveLength(0)
    storage.down = false
    await admin`update bulk_listing_child set next_attempt_at = now() where operation_id = ${op.id}`
    await tick()
    expect((await t.status(op)).children[0].status).toBe("succeeded")
    await expect(
      admin`update bulk_listing_child set resource_key = 'photos_x' where operation_id = ${op.id}`
    ).rejects.toThrow(/resource_key_check/)
  })
})
