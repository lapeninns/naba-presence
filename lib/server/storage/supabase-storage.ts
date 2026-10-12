import "server-only"

import { ApiError } from "@/lib/server/http"
import type { AssetStorage } from "@/lib/server/storage/asset-storage"

/**
 * Supabase Storage over its REST API (no client library): a PRIVATE bucket,
 * reached with the server-only secret key. The tenant check is the app's
 * (lib/server/assets.ts); the bucket has no public read and no row-level
 * policies the app relies on.
 *
 *   POST   /storage/v1/object/upload/sign/<bucket>/<key>  signed upload URL
 *   PUT    /storage/v1/object/upload/sign/<bucket>/<key>?token=  (browser)
 *   GET    /storage/v1/object/<bucket>/<key>              read
 *   POST   /storage/v1/object/<bucket>/<key>  x-upsert: false  write once
 *   DELETE /storage/v1/object/<bucket>  { prefixes }      remove
 */
export function supabaseAssetStorage(config: {
  url: string
  secretKey: string
  bucket: string
  timeoutMs: number
}): AssetStorage {
  const base = `${config.url.replace(/\/+$/, "")}/storage/v1`
  const headers = (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${config.secretKey}`,
    apikey: config.secretKey,
    ...extra,
  })
  const objectPath = (key: string) =>
    `${encodeURIComponent(config.bucket)}/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`
  const call = async (path: string, init: RequestInit) => {
    try {
      return await fetch(`${base}${path}`, {
        ...init,
        signal: AbortSignal.timeout(config.timeoutMs),
        cache: "no-store",
      })
    } catch {
      throw unavailable()
    }
  }
  const unavailable = () =>
    new ApiError(
      503,
      "asset_storage_unavailable",
      "Photo storage did not answer. Try again shortly.",
      { retryable: true }
    )
  /** Supabase reports some statuses in the body (`statusCode: "409"`) under a 400. */
  const bodyStatus = async (response: Response) => {
    const text = await response.text().catch(() => "")
    try {
      const parsed = JSON.parse(text) as {
        statusCode?: unknown
        error?: unknown
      }
      return {
        statusCode: String(parsed.statusCode ?? response.status),
        error: String(parsed.error ?? ""),
      }
    } catch {
      return { statusCode: String(response.status), error: text }
    }
  }
  return {
    async signedUpload(key, options) {
      const response = await call(`/object/upload/sign/${objectPath(key)}`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: "{}",
      })
      if (!response.ok) throw unavailable()
      const body = (await response.json().catch(() => null)) as {
        url?: unknown
      } | null
      if (typeof body?.url !== "string" || !body.url.startsWith("/"))
        throw unavailable()
      return {
        url: `${base}${body.url}`,
        method: "PUT",
        headers: { "content-type": options.contentType, "x-upsert": "false" },
      }
    },
    async read(key, maxBytes) {
      const response = await call(`/object/${objectPath(key)}`, {
        method: "GET",
        headers: headers(),
      })
      if (response.status === 404) return null
      if (response.status === 400) {
        const status = await bodyStatus(response)
        if (status.statusCode === "404" || /not.?found/i.test(status.error))
          return null
        throw unavailable()
      }
      if (!response.ok) throw unavailable()
      const declared = Number(response.headers.get("content-length") ?? "")
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined)
        throw tooLarge()
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > maxBytes) throw tooLarge()
      return bytes
    },
    async writeOnce(key, bytes, contentType) {
      const response = await call(`/object/${objectPath(key)}`, {
        method: "POST",
        headers: headers({
          "content-type": contentType,
          "x-upsert": "false",
          "cache-control": "max-age=31536000, immutable",
        }),
        body: bytes as BodyInit,
      })
      if (response.ok) return "written"
      if (response.status === 409) return "exists"
      if (response.status === 400) {
        const status = await bodyStatus(response)
        if (
          status.statusCode === "409" ||
          /duplicate|exists/i.test(status.error)
        )
          return "exists"
      }
      throw unavailable()
    },
    async remove(keys) {
      if (!keys.length) return
      const response = await call(
        `/object/${encodeURIComponent(config.bucket)}`,
        {
          method: "DELETE",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({ prefixes: keys }),
        }
      )
      if (!response.ok) throw unavailable()
    },
  }
}

const tooLarge = () =>
  new ApiError(
    413,
    "asset_too_large",
    "The file is larger than a photo may be."
  )
