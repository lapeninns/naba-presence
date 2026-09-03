import { NextResponse } from "next/server"
import { webhookReplaySchema } from "@/lib/contracts/operations"
import { writeAudit } from "@/lib/server/audit"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { linkedLocations } from "@/lib/server/reviews"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  roles: ["owner", "admin"],
  handler: async ({ request, session, requestId, clientRequestId, tenant }) => {
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    // The kill switch must win over validation, so the body is parsed here
    // rather than through the wrapper's `body` option.
    const input = webhookReplaySchema.parse(await request.json())
    const result = await tenant(async (sql) => {
      // Claim and schedule rather than sync inline. `claim_due_jobs` is the
      // only actor that runs a webhook sync, so a replay that synced here
      // would race a tick over the same row and each would overwrite the
      // other's settlement. `retry_count` resets because a dead-lettered row
      // sits at the ceiling, and the runner would otherwise re-dead-letter it
      // without ever retrying.
      const [event] = await sql<
        { id: string; externalLocationId: string | null }[]
      >`
        update processed_webhook_event
        set
          status = 'failed',
          retry_count = 0,
          processed_at = null,
          last_error_code = null,
          lease_expires_at = null,
          next_attempt_at = now()
        where id = ${input.eventId}
          and status in ('failed', 'dead')
        returning
          id::text as id,
          external_location_id::text as "externalLocationId"
      `
      if (!event) {
        throw new ApiError(
          404,
          "replay_event_not_found",
          "That event cannot be replayed. Only failed and dead-lettered events can be replayed, and one that is already running has to finish first."
        )
      }
      const [location] = event.externalLocationId
        ? await linkedLocations(sql, [event.externalLocationId])
        : []
      if (!location) {
        throw new ApiError(
          409,
          "location_not_linked",
          "The event location is no longer linked. Reconnect the location, then replay the event."
        )
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "webhook.replay.requested",
        subjectType: "webhook_event",
        subjectId: event.id,
        requestId,
        metadata: { clientRequestId },
      })
      return { status: "scheduled", eventId: event.id }
    })
    return NextResponse.json(result, { status: 202 })
  },
})
