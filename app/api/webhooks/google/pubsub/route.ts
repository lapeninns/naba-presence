import { NextResponse } from "next/server"
import { z } from "zod"

import { sha256 } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError } from "@/lib/server/http"
import { verifyPubSubRequest } from "@/lib/server/pubsub"
import { linkedLocations, syncLinkedLocation } from "@/lib/server/reviews"

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

function notificationLocation(payload: Record<string, unknown>): string | null {
  const direct = payload.locationName ?? payload.location
  if (typeof direct === "string") {
    const match = direct.match(/locations\/[^/]+/)
    return match?.[0] ?? direct
  }
  const reviewName = payload.reviewName ?? payload.review
  if (typeof reviewName === "string") {
    return reviewName.match(/locations\/[^/]+/)?.[0] ?? null
  }
  return null
}

export async function POST(request: Request) {
  try {
    const env = getServerEnv()
    if (!env.WEBHOOKS_ENABLED || !env.SYNC_ENABLED) {
      throw new ApiError(
        503,
        "webhooks_paused",
        "Notification processing is paused."
      )
    }
    await verifyPubSubRequest(request, env)
    const envelope = envelopeSchema.parse(await request.json())
    const decoded = Buffer.from(envelope.message.data, "base64").toString(
      "utf8"
    )
    const payload = JSON.parse(decoded) as Record<string, unknown>
    const locationName = notificationLocation(payload)
    if (!locationName) {
      throw new ApiError(
        400,
        "invalid_notification",
        "Notification does not identify a Google location."
      )
    }
    const [route] = await getDatabase()<
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
    if (!route) {
      return NextResponse.json({
        status: "ignored",
        reason: "unknown_location",
      })
    }
    const prepared = await withTenant(
      route.organisation_id,
      async (sql) => {
        const [event] = await sql<{ status: string }[]>`
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
            ${route.organisation_id},
            ${route.external_location_id},
            'google_pubsub',
            ${envelope.message.messageId},
            ${String(payload.type ?? payload.notificationType ?? "review_update")},
            ${sha256(decoded)},
            ${sql.json(JSON.parse(JSON.stringify(payload)))},
            now() + interval '30 days',
            'received'
          )
          on conflict (provider, external_event_id) do update
          set external_event_id = excluded.external_event_id
          returning status
        `
        if (event.status === "processed") {
          return { terminal: { status: "duplicate" } } as const
        }
        const [location] = await linkedLocations(sql, [
          route.external_location_id,
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
        return { terminal: null } as const
      }
    )
    if (prepared.terminal) {
      return NextResponse.json(prepared.terminal)
    }
    const sync = await syncLinkedLocation({
      organisationId: route.organisation_id,
      externalLocationId: route.external_location_id,
      type: "notification",
      maxPages: 1,
    })
    const result = await withTenant(
      route.organisation_id,
      async (sql) => {
        if (sync.status === "failed") {
          await sql`
            update processed_webhook_event
            set status = 'failed', processed_at = now()
            where provider = 'google_pubsub'
              and external_event_id = ${envelope.message.messageId}
          `
          return { status: "failed", sync }
        }
        await sql`
          update processed_webhook_event
          set status = 'processed', processed_at = now()
          where provider = 'google_pubsub'
            and external_event_id = ${envelope.message.messageId}
        `
        return { status: "processed", sync }
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}
