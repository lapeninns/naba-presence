/**
 * One opaque keyset-cursor codec: base64url(JSON), validated on the way in.
 *
 * Client-safe (no Node `Buffer`), so a list contract can encode and decode the
 * same cursor in the browser and the route. A cursor is a position, never a
 * credential: whatever a route binds into one (a subject fingerprint, a page
 * index) it re-checks against the request that carries it back.
 */
import type { z } from "zod"

/** base64url(text); byte-identical to `Buffer.from(text).toString("base64url")`. */
export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Inverse of `toBase64Url`; throws on input that is not base64url. */
export function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Not base64url.")
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0))
  )
}

export function encodeCursor(value: unknown): string {
  return toBase64Url(JSON.stringify(value))
}

/**
 * Opaque → validated value, or `null` when the cursor is absent, not
 * decodable, or not the shape `schema` describes. Callers map `null` on a
 * supplied cursor to 400 `invalid_cursor`.
 */
export function decodeCursor<Schema extends z.ZodType>(
  value: string | null | undefined,
  schema: Schema
): z.output<Schema> | null {
  if (!value) return null
  try {
    const parsed = schema.safeParse(JSON.parse(fromBase64Url(value)))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
