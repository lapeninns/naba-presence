import "server-only"

import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { supabaseAssetStorage } from "@/lib/server/storage/supabase-storage"

/**
 * Private object storage for owned media assets (plan P09: photos are
 * immutable assets the organisation owns). Server only: the app holds the
 * one credential, checks the tenant itself (lib/server/assets.ts, under the
 * tenant's RLS), and hands a browser nothing but a signed URL for exactly
 * one staging object.
 *
 * Keys are built by the app only, never taken from a request:
 *   staging/<organisation>/<asset>        what the browser uploaded, unchecked
 *   assets/<organisation>/<sha256>/<asset> the validated bytes, written once
 */
export type AssetStorage = {
  /** A URL the browser PUTs one object's bytes to, valid for a short while. */
  signedUpload(
    key: string,
    options: { contentType: string }
  ): Promise<{ url: string; method: "PUT"; headers: Record<string, string> }>
  /** The object's bytes, or null when it does not exist. Refuses more than `maxBytes`. */
  read(key: string, maxBytes: number): Promise<Uint8Array | null>
  /**
   * Writes the object once: an existing object is never overwritten
   * (`exists`), which is what keeps a final key immutable.
   */
  writeOnce(
    key: string,
    bytes: Uint8Array,
    contentType: string
  ): Promise<"written" | "exists">
  remove(keys: string[]): Promise<void>
}

let override: AssetStorage | null | undefined

/** Unit tests swap in an in-memory store (`memoryAssetStorage`). */
export function setAssetStorageForTests(
  storage: AssetStorage | null | undefined
) {
  override = storage
}

/**
 * The configured store, or null when storage is not set up. Fails closed:
 * only `MEDIA_ASSET_STORAGE=supabase` with the server secret key, the
 * project URL and a bucket name turns it on.
 */
export function assetStorage(): AssetStorage | null {
  if (override !== undefined) return override
  const env = getServerEnv()
  if (env.MEDIA_ASSET_STORAGE !== "supabase") return null
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || !env.MEDIA_ASSETS_BUCKET)
    return null
  return supabaseAssetStorage({
    url: env.SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY,
    bucket: env.MEDIA_ASSETS_BUCKET,
    timeoutMs: env.GOOGLE_TIMEOUT_MS,
  })
}

export const STORAGE_UNAVAILABLE = () =>
  new ApiError(
    503,
    "asset_storage_unavailable",
    "Photo storage is not set up for this workspace yet."
  )

export function requireAssetStorage(): AssetStorage {
  const storage = assetStorage()
  if (!storage) throw STORAGE_UNAVAILABLE()
  return storage
}

export const stagingKey = (organisationId: string, assetId: string) =>
  `staging/${organisationId}/${assetId}`
export const finalKey = (
  organisationId: string,
  sha256: string,
  assetId: string
) => `assets/${organisationId}/${sha256}/${assetId}`

/** An in-memory store for unit tests. `uploads` stands in for the browser's PUT. */
export function memoryAssetStorage() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>()
  const storage: AssetStorage & {
    objects: typeof objects
    put(key: string, bytes: Uint8Array, contentType: string): void
  } = {
    objects,
    put(key, bytes, contentType) {
      objects.set(key, { bytes, contentType })
    },
    async signedUpload(key) {
      return {
        url: `memory://upload/${key}`,
        method: "PUT",
        headers: {},
      }
    },
    async read(key, maxBytes) {
      const object = objects.get(key)
      if (!object) return null
      if (object.bytes.length > maxBytes)
        throw new ApiError(413, "asset_too_large", "The file is too large.")
      return object.bytes
    },
    async writeOnce(key, bytes, contentType) {
      if (objects.has(key)) return "exists"
      objects.set(key, { bytes, contentType })
      return "written"
    },
    async remove(keys) {
      for (const key of keys) objects.delete(key)
    },
  }
  return storage
}
