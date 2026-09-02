import { metrics } from "@opentelemetry/api"
import { NextResponse } from "next/server"
import { z } from "zod"

import { parsePubSubNotification } from "@/lib/domain/pubsub-payload"
import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import { verifyPubSubRequest } from "@/lib/server/pubsub"
import { linkedLocations, syncLinkedLocation } from "@/lib/server/reviews"
import { route } from "@/lib/server/route"
import { settleWebhookEvent } from "@/lib/server/webhooks"

export const runtime = "nodejs"
export const maxDuration = 60

const envelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1),
    messageId: z.string().min(1),
    publishTime: z.string().optional(),
    attributes: z.record(z.string(), z.string()).optional(),
  }),
  subscription: z.string().optional(),
})

const discardedCounter = metrics
  .getMeter("nabapresence.webhook")
  .createCounter("nabapresence.webhook.discarded", {
    description: "Permanently malformed webhook deliveries acknowledged",
  })

function discarded(reason: string) {
  discardedCounter.add(1, { reason })
  log.warn("nabapresence.webhook.discarded", { reason })
  return NextResponse.json({ status: "discarded" })
}

// Google Pub/Sub push endpoint: there is no session or cron token, the
// caller is authenticated by its OIDC token in `verifyPubSubRequest`.
export const POST = route({
  auth: "public",
  handler: async ({ request }) => {
    const env = getServerEnv()
    if (!env.WEBHOOKS_ENABLED || !env.SYNC_ENABLED) {
      throw new ApiError(
        503,
        "webhooks_paused",
        "Notification processing is paused."
      )
    }
    await verifyPubSubRequest(request, env)
    let envelope: z.infer<typeof envelopeSchema>
    let decoded: string
    let payload: Record<string, unknown>
    let notification: ReturnType<typeof parsePubSubNotification>
    try {
      envelope = envelopeSchema.parse(await request.json())
      decoded = Buffer.from(envelope.message.data, "base64").toString("utf8")
      payload = JSON.parse(decoded) as Record<string, unknown>
      notification = parsePubSubNotification(payload)
    } catch {
      return discarded("invalid_payload")
    }
    const locationName = notification.locationName
    if (!locationName) {
      return discarded("unresolvable_location")
    }
    // Documented cross-tenant routing read: webhook_route is the content-free
    // table that maps a Google location name to its organisation.
    const [webhookRoute] = await getDatabase()<
      {
        organisation_id: string
        external_location_id: string
      }[]
    >`
      select
        organisation_id::text as organisation_id,
        external_location_id::text as external_location_id
      from webhook_route
      where google_location_name = ${locationName}
      limit 1
    `
    if (!webhookRoute) {
      return {
        status: "ignored",
        reason: "unknown_location",
      }
    }
    const prepared = await withTenant(
      webhookRoute.organisation_id,
      async (sql) => {
        const [event] = await sql<
          { id: string; status: string; retryCount: number }[]
        >`
          insert into processed_webhook_event (
            organisation_id,
            external_location_id,
            provider,
            external_event_id,
            event_type,
            payload_hash,
            payload,
            payload_expires_at,
            status
          )
          values (
            ${webhookRoute.organisation_id},
            ${webhookRoute.external_location_id},
            'google_pubsub',
            ${envelope.message.messageId},
            ${notification.type},
            ${sha256(decoded)},
            ${sql.json(JSON.parse(JSON.stringify(payload)))},
            now() + interval '30 days',
            'received'
          )
          on conflict (provider, external_event_id) do update
          set external_event_id = excluded.external_event_id
          returning
            id::text as id,
            status,
            retry_count as "retryCount"
        `
        if (event.status === "processed") {
          return { terminal: { status: "duplicate" } } as const
        }
        // The sync below runs outside this transaction, so take a lease: a
        // crash in between would otherwise strand the row at 'processing'
        // with nothing able to reclaim it (0029, reclaim_expired_jobs).
        await sql`
          update processed_webhook_event
          set
            status = 'processing',
            processed_at = null,
            next_attempt_at = null,
            last_error_code = null,
            lease_expires_at = now() + interval '15 minutes'
          where id = ${event.id}
        `
        const [location] = await linkedLocations(sql, [
          webhookRoute.external_location_id,
        ])
        if (!location) {
          await sql`
            update processed_webhook_event
            set status = 'ignored', processed_at = now()
            where provider = 'google_pubsub'
              and external_event_id = ${envelope.message.messageId}
          `
          return {
            terminal: {
              status: "ignored",
              reason: "unlinked_location",
            },
          } as const
        }
        return { terminal: null, eventId: event.id } as const
      }
    )
    if (prepared.terminal) {
      return prepared.terminal
    }
    const sync = await syncLinkedLocation({
      organisationId: webhookRoute.organisation_id,
      externalLocationId: webhookRoute.external_location_id,
      type: "notification",
      maxPages: 1,
    })
    const status = await withTenant(webhookRoute.organisation_id, (sql) =>
      settleWebhookEvent(sql, prepared.eventId, sync)
    )
    return { status, sync }
  },
})
