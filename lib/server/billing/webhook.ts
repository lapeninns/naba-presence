import "server-only"

import Stripe from "stripe"

import { isHandledEventType } from "@/lib/server/billing/process-events"
import type { BillingEnvironment } from "@/lib/server/billing/stripe"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"

/**
 * Verification and receipt of Stripe webhook events (plan P07-S4).
 *
 * The signature is checked on the raw body exactly as received (the SDK's
 * constructEvent, with its default five-minute timestamp tolerance), so
 * nothing may parse or re-serialise the body first. An event from the other
 * Stripe mode, or a Connect event for another account, is refused: this
 * deployment bills in one environment on its own account.
 */

/** Stripe events are small; anything larger is not one of ours. */
export const MAX_WEBHOOK_BODY_BYTES = 512 * 1024

export type VerifiedBillingEvent = {
  id: string
  type: string
  livemode: boolean
  accountId: string | null
  customerId: string | null
  createdAt: Date
  payloadHash: string
}

function customerOf(object: unknown): string | null {
  if (!object || typeof object !== "object") return null
  const record = object as {
    object?: unknown
    id?: unknown
    customer?: unknown
  }
  if (record.object === "customer" && typeof record.id === "string") {
    return record.id
  }
  const customer = record.customer
  if (typeof customer === "string") return customer
  if (customer && typeof customer === "object") {
    const id = (customer as { id?: unknown }).id
    return typeof id === "string" ? id : null
  }
  return null
}

const CUSTOMER_ID = /^cus_[A-Za-z0-9]{1,250}$/
const EVENT_ID = /^evt_[A-Za-z0-9_]{1,250}$/

/**
 * The verified event's routing facts. Throws 400 for a missing or invalid
 * signature, a body that is not a Stripe event, or the wrong mode.
 */
export function verifyStripeWebhook(
  body: string,
  signature: string | null,
  config: { webhookSecret: string; environment: BillingEnvironment }
): VerifiedBillingEvent {
  if (!signature) {
    throw new ApiError(
      400,
      "invalid_signature",
      "The event signature is missing."
    )
  }
  let event: Stripe.Event
  try {
    event = Stripe.webhooks.constructEvent(
      body,
      signature,
      config.webhookSecret
    )
  } catch {
    throw new ApiError(
      400,
      "invalid_signature",
      "The event signature is not valid."
    )
  }
  if (typeof event.id !== "string" || !EVENT_ID.test(event.id)) {
    throw new ApiError(
      400,
      "invalid_webhook_event",
      "The event could not be read."
    )
  }
  if (event.livemode !== (config.environment === "live")) {
    throw new ApiError(
      400,
      "livemode_mismatch",
      "The event belongs to the other Stripe mode."
    )
  }
  const accountId =
    "account" in event && typeof event.account === "string"
      ? event.account
      : null
  if (accountId) {
    throw new ApiError(
      400,
      "unexpected_account",
      "The event belongs to another Stripe account."
    )
  }
  const customer = customerOf(event.data?.object)
  return {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    accountId,
    customerId: customer && CUSTOMER_ID.test(customer) ? customer : null,
    createdAt: new Date(event.created * 1000),
    payloadHash: sha256(body),
  }
}

/**
 * Writes the receipt. Idempotent on the Stripe event id: a redelivery
 * returns `inserted: false` and changes nothing. The caller answers 200
 * only after this resolves, so an acknowledged event is always stored.
 */
export async function recordBillingEvent(
  event: VerifiedBillingEvent
): Promise<{ id: string; inserted: boolean; status: string }> {
  // Platform-level write through the SECURITY DEFINER function (0225): the
  // event's organisation is not known until the processor resolves it.
  const [row] = await getDatabase()<
    { id: string; inserted: boolean; status: string }[]
  >`
    select id::text as id, inserted, status
    from record_billing_event(
      ${event.id},
      ${event.type},
      ${event.livemode},
      ${event.accountId},
      ${event.customerId},
      ${event.payloadHash},
      ${event.createdAt},
      ${isHandledEventType(event.type)}
    )
  `
  if (!row) throw new Error("billing event receipt was not written")
  return row
}
