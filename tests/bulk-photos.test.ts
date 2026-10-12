import { randomUUID } from "node:crypto"

import { afterEach, describe, expect, it, vi } from "vitest"

import { describeChildChange } from "@/components/bulk/bulk-change-summary"
import type { BulkChild } from "@/lib/contracts/bulk-listings"
import { assetCreateRequestSchema } from "@/lib/contracts/assets"
import {
  bulkChangeListSchema,
  bulkChangeParts,
  bulkResourceKey,
} from "@/lib/domain/bulk-merge"
import { bulkPhotoInputSchema } from "@/lib/domain/bulk-photos"
import { photosFamily } from "@/lib/server/bulk-families/photos"
import {
  finalKey,
  memoryAssetStorage,
  stagingKey,
} from "@/lib/server/storage/asset-storage"
import { supabaseAssetStorage } from "@/lib/server/storage/supabase-storage"

const photo = (assetId = randomUUID()) => ({
  operation: "photos" as const,
  assetId,
  category: "INTERIOR" as const,
})

describe("bulk photos family (P09-R7)", () => {
  it("takes one asset and a non-slot category per change", () => {
    expect(bulkPhotoInputSchema.safeParse(photo()).success).toBe(true)
    expect(
      bulkPhotoInputSchema.safeParse({ ...photo(), category: "COVER" }).success
    ).toBe(false)
    expect(
      bulkPhotoInputSchema.safeParse({ ...photo(), assetId: "x" }).success
    ).toBe(false)
    expect(
      bulkPhotoInputSchema.safeParse({ ...photo(), sourceUrl: "https://a" })
        .success
    ).toBe(false)
  })

  it("allows at most 10 new photos per listing and each asset once", () => {
    const ten = Array.from({ length: 10 }, () => photo())
    expect(bulkChangeListSchema.safeParse(ten).success).toBe(true)
    const eleven = bulkChangeListSchema.safeParse([...ten, photo()])
    expect(eleven.success).toBe(false)
    expect(eleven.error?.issues[0]?.message).toMatch(/at most 10 new photos/)
    const same = photo()
    expect(bulkChangeListSchema.safeParse([same, { ...same }]).success).toBe(
      false
    )
    expect(bulkChangeParts(same)).toEqual([`photos:${same.assetId}`])
    expect(bulkResourceKey("photos")).toBe("media")
    expect(photosFamily.writeSurface).toBe("media")
  })

  it("settles from the receipt, never re-sending", () => {
    expect(
      photosFamily.reconcile({
        state: "confirmed_applied",
        errorCode: null,
        attemptStatus: "succeeded",
      })
    ).toEqual({ kind: "succeeded", confirmation: "confirmed" })
    expect(
      photosFamily.reconcile({
        state: "uncertain",
        errorCode: "media_needs_resolution",
        attemptStatus: "needs_resolution",
      })
    ).toBeNull()
    expect(
      photosFamily.reconcile({
        state: "failed",
        errorCode: "media_resolution_abandoned",
        attemptStatus: "failed",
      })
    ).toEqual({
      kind: "failed",
      code: "recovered_not_applied:media_resolution_abandoned",
    })
  })

  it("shows the approver the frozen asset per listing", () => {
    const child = {
      operation: "photos",
      eligibility: "eligible",
      currentValue: { previousMediaName: null },
      proposedValue: {
        fileName: "bar.jpg",
        category: "FOOD_AND_DRINK",
        width: 1200,
        height: 800,
        description: null,
      },
      updateMask: ["media"],
      input: photo(),
    } as unknown as BulkChild
    expect(describeChildChange(child)).toEqual([
      {
        label: "New photo (Food and drink)",
        current: "Not on this listing",
        proposed: "bar.jpg, 1200 × 800",
      },
    ])
  })

  it("declares uploads as photos of 10 KB to 5 MB with a SHA-256", () => {
    const ok = {
      fileName: "a.png",
      contentType: "image/png",
      byteLength: 20_000,
      sha256: "A".repeat(64),
    }
    expect(assetCreateRequestSchema.parse(ok).sha256).toBe("a".repeat(64))
    for (const bad of [
      { ...ok, contentType: "image/svg+xml" },
      { ...ok, byteLength: 9_000 },
      { ...ok, byteLength: 6 * 1024 * 1024 },
      { ...ok, sha256: "x" },
      { ...ok, key: "assets/other" },
    ])
      expect(assetCreateRequestSchema.safeParse(bad).success).toBe(false)
  })
})

describe("asset storage adapters", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("builds keys from the organisation and asset only", () => {
    expect(stagingKey("org", "asset")).toBe("staging/org/asset")
    expect(finalKey("org", "f".repeat(64), "asset")).toBe(
      `assets/org/${"f".repeat(64)}/asset`
    )
  })

  it("never overwrites a final key in memory", async () => {
    const storage = memoryAssetStorage()
    const one = new Uint8Array([1])
    expect(await storage.writeOnce("k", one, "image/png")).toBe("written")
    expect(await storage.writeOnce("k", new Uint8Array([2]), "image/png")).toBe(
      "exists"
    )
    expect(await storage.read("k", 10)).toEqual(one)
    await expect(storage.read("k", 0)).rejects.toMatchObject({
      code: "asset_too_large",
    })
  })

  it("talks to Supabase Storage over REST with the server key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const answers: Response[] = [
      Response.json({ url: "/object/upload/sign/media/staging/o/a?token=t" }),
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-length": "3" },
      }),
      Response.json({ statusCode: "404", error: "not_found" }, { status: 400 }),
      Response.json({ Key: "media/k" }),
      Response.json({ statusCode: "409", error: "Duplicate" }, { status: 400 }),
      Response.json([]),
      new Response(new Uint8Array(10), {
        headers: { "content-length": "10" },
      }),
    ]
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return answers.shift()!
    })
    const storage = supabaseAssetStorage({
      url: "https://project.supabase.co/",
      secretKey: "sb_secret_test",
      bucket: "media",
      timeoutMs: 1_000,
    })
    const upload = await storage.signedUpload("staging/o/a", {
      contentType: "image/png",
    })
    expect(upload).toEqual({
      url: "https://project.supabase.co/storage/v1/object/upload/sign/media/staging/o/a?token=t",
      method: "PUT",
      headers: { "content-type": "image/png", "x-upsert": "false" },
    })
    expect(calls[0].url).toBe(
      "https://project.supabase.co/storage/v1/object/upload/sign/media/staging/o/a"
    )
    expect(
      (calls[0].init.headers as Record<string, string>).authorization
    ).toBe("Bearer sb_secret_test")
    expect(await storage.read("staging/o/a", 10)).toEqual(
      new Uint8Array([1, 2, 3])
    )
    expect(await storage.read("missing", 10)).toBeNull()
    expect(await storage.writeOnce("k", new Uint8Array([1]), "image/png")).toBe(
      "written"
    )
    expect((calls[3].init.headers as Record<string, string>)["x-upsert"]).toBe(
      "false"
    )
    expect(await storage.writeOnce("k", new Uint8Array([1]), "image/png")).toBe(
      "exists"
    )
    await storage.remove(["staging/o/a"])
    expect(calls[5].init.method).toBe("DELETE")
    expect(JSON.parse(String(calls[5].init.body))).toEqual({
      prefixes: ["staging/o/a"],
    })
    await expect(storage.read("big", 5)).rejects.toMatchObject({
      code: "asset_too_large",
    })
  })

  it("fails closed when Supabase does not answer", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down")
    })
    const storage = supabaseAssetStorage({
      url: "https://project.supabase.co",
      secretKey: "k",
      bucket: "media",
      timeoutMs: 1_000,
    })
    await expect(storage.read("x", 10)).rejects.toMatchObject({
      status: 503,
      code: "asset_storage_unavailable",
    })
  })
})
