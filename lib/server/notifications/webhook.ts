import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

import { ApiError } from "@/lib/server/http"

/** Signature timestamps older or newer than this are refused, so a captured request cannot be replayed later. */
export const WEBHOOK_TOLERANCE_SECONDS = 300

const invalid = () => new ApiError(400, "invalid_webhook_signature", "The delivery webhook signature is not valid.")

/**
 * Verifies a Resend (Svix) webhook: HMAC-SHA256 over `id.timestamp.body`
 * with the base64 secret after its `whsec_` prefix, compared in constant time
 * against each `v1,` signature offered.
 */
export function verifyEmailWebhook(secret: string, headers: Headers, body: string, now = Date.now()) {
  const id = headers.get("svix-id"), timestamp = headers.get("svix-timestamp"), signatures = headers.get("svix-signature")
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) throw invalid()
  if (Math.abs(now / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) throw invalid()
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64")
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest()
  const matches = signatures.split(" ").some((entry) => {
    const [version, value] = entry.split(",")
    if (version !== "v1" || !value) return false
    const offered = Buffer.from(value, "base64")
    return offered.length === expected.length && timingSafeEqual(offered, expected)
  })
  if (!matches) throw invalid()
  return id
}

export const emailWebhookEventSchema = z.object({
  type: z.string().min(1).max(100),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({ email_id: z.string().min(1).max(200) }).loose(),
}).loose()
