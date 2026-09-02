import { NextResponse } from "next/server"
import { webhookReplaySchema } from "@/lib/contracts/operations"
import { writeAudit } from "@/lib/server/audit"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { linkedLocations, syncLinkedLocation } from "@/lib/server/reviews"
import { route } from "@/lib/server/route"
import { settleWebhookEvent } from "@/lib/server/webhooks"

export const runtime = "nodejs"
export const maxDuration = 60

export const POST = route({
  roles: ["owner", "admin"],
  handler: async ({ request, session, requestId, clientRequestId, tenant }) => {
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    // The kill switch must win over validation, so the body is parsed here
    // rather than through the wrapper's `body` option.
    const input = webhookReplaySchema.parse(await request.json())
    const event = await tenant(async (sql) => {
      const [event] = await sql<
        {
          id: string
          externalLocationId: string | null
          retryCount: number
        }[]
      >`
        select
          p.id::text as id,
          p.external_location_id::text as "externalLocationId",
          p.retry_count as "retryCount"
        from processed_webhook_event p
        where p.id = ${input.eventId}
          and p.status = 'failed'
        limit 1
      `
      if (!event?.externalLocationId) {
        throw new ApiError(
          404,
          "replay_event_not_found",
          "A replayable failed event was not found."
        )
      }
      const [location] = await linkedLocations(sql, [event.externalLocationId])
      if (!location) {
        throw new ApiError(
          409,
          "location_not_linked",
          "The event location is no longer linked."
        )
      }
      return event
    })
    const sync = await syncLinkedLocation({
      organisationId: session.organisationId,
      externalLocationId: event.externalLocationId!,
      type: "notification",
      maxPages: 1,
    })
    const result = await tenant(async (sql) => {
      await sql`
        update processed_webhook_event
        set
          retry_count = retry_count + 1
        where id = ${event.id}
      `
      const status = await settleWebhookEvent(sql, event.id, sync)
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action:
          status === "failed"
            ? "webhook.replay.failed"
            : "webhook.replay.completed",
        subjectType: "webhook_event",
        subjectId: event.id,
        requestId,
        metadata: { sync, clientRequestId },
      })
      return { status, sync }
    })
    return NextResponse.json(result, {
      status: result.status === "failed" ? 502 : 200,
    })
  },
})
