import { NextResponse } from "next/server"

import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { emailWebhookEventSchema, verifyEmailWebhook } from "@/lib/server/notifications/webhook"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Resend delivery events. Public by necessity; authenticity is the Svix
 * signature. Each event is recorded once by its signed id, so a replay is
 * harmless, and a delivery's state only moves forward in precedence, so an
 * out-of-order callback cannot undo a later one. Opens and clicks are not
 * tracked: delivery is not proof anyone read the message.
 */
export const POST = route({
  auth: "public",
  handler: async ({ request }) => {
    const secret = getServerEnv().EMAIL_WEBHOOK_SECRET
    if (!secret) throw new ApiError(404, "not_found", "Not found.")
    const body = await request.text()
    const eventId = verifyEmailWebhook(secret, request.headers, body)
    let json: unknown = null
    try { json = JSON.parse(body) } catch { json = null }
    const parsed = emailWebhookEventSchema.safeParse(json)
    if (!parsed.success) throw new ApiError(400, "invalid_webhook_event", "The delivery event could not be read.")
    const [row] = await getDatabase()<{ outcome: string }[]>`
      select record_email_delivery_event(${parsed.data.data.email_id}, ${eventId}, ${parsed.data.type}, ${parsed.data.created_at}::timestamptz) as outcome`
    return NextResponse.json({ accepted: true, outcome: row?.outcome ?? "unknown_message" }, { status: 202 })
  },
})
