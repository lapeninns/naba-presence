import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import { linkedLocations, syncLinkedLocation } from "@/lib/server/reviews"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({ eventId: z.uuid() })

export async function POST(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    const input = inputSchema.parse(await request.json())
    const result = await withTenant(session.organisationId, async (sql) => {
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
      const sync = await syncLinkedLocation(
        sql,
        session.organisationId,
        location,
        { type: "notification", maxPages: 1 }
      )
      const failed = "error" in sync
      await sql`
        update processed_webhook_event
        set
          status = ${failed ? "failed" : "processed"},
          processed_at = now(),
          retry_count = retry_count + 1,
          next_attempt_at = ${
            failed
              ? new Date(
                  Date.now() +
                    Math.min(3_600_000, 30_000 * 2 ** event.retryCount)
                )
              : null
          }
        where id = ${event.id}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: failed ? "webhook.replay.failed" : "webhook.replay.completed",
        subjectType: "webhook_event",
        subjectId: event.id,
        requestId: requestId(request),
        metadata: { sync },
      })
      return { status: failed ? "failed" : "processed", sync }
    })
    return NextResponse.json(result, {
      status: result.status === "failed" ? 502 : 200,
    })
  } catch (error) {
    return apiError(error)
  }
}
