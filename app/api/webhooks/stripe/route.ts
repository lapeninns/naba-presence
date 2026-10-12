import { NextResponse } from "next/server"

import { requireBillingConfig } from "@/lib/server/billing/stripe"
import {
  MAX_WEBHOOK_BODY_BYTES,
  recordBillingEvent,
  verifyStripeWebhook,
} from "@/lib/server/billing/webhook"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Stripe webhook receiver (plan P07-S4). Public by necessity; authenticity
 * is the Stripe-Signature over the raw body. It verifies, writes the receipt
 * (billing_event) and only then answers 200: the event is processed later
 * by the job tick (lib/server/billing/process-events.ts), which fetches the
 * current subscription from Stripe rather than trusting this payload.
 *
 * Billing disabled or misconfigured answers 503 so Stripe keeps retrying
 * (for up to three days) instead of the event being lost. The operator
 * `billing` pause scope does not stop receipts, only their processing.
 */
export const POST = route({
  auth: "public",
  origin: "any",
  handler: async ({ request }) => {
    const config = requireBillingConfig()
    const declared = Number(request.headers.get("content-length") ?? 0)
    if (declared > MAX_WEBHOOK_BODY_BYTES) {
      throw new ApiError(413, "payload_too_large", "The event is too large.")
    }
    const body = await request.text()
    if (Buffer.byteLength(body) > MAX_WEBHOOK_BODY_BYTES) {
      throw new ApiError(413, "payload_too_large", "The event is too large.")
    }
    const event = verifyStripeWebhook(
      body,
      request.headers.get("stripe-signature"),
      config
    )
    const receipt = await recordBillingEvent(event)
    if (!receipt.inserted) {
      log.info("billing.webhook_duplicate", {
        eventId: event.id,
        status: receipt.status,
      })
    }
    return NextResponse.json({ received: true, duplicate: !receipt.inserted })
  },
})
