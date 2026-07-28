import { NextResponse } from "next/server"
import type { TransactionSql } from "postgres"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, apiError, requestId } from "@/lib/server/http"
import {
  linkedLocations,
  syncLinkedLocationBatch,
  type LinkedLocation,
} from "@/lib/server/reviews"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const inputSchema = z.object({
  externalLocationIds: z.array(z.uuid()).max(50).optional(),
  maxPagesPerLocation: z.number().int().min(1).max(20).default(10),
})

const cancellationSchema = z.object({
  externalLocationIds: z.array(z.uuid()).min(1).max(50),
})

async function backfillProgress(
  sql: TransactionSql,
  externalLocationIds?: string[]
) {
  const items = await sql<
    {
      externalLocationId: string
      locationName: string
      status: string
      attemptCount: number
      hasMorePages: boolean
      lastErrorCode: string | null
      startedAt: string | Date | null
      finishedAt: string | Date | null
      nextAttemptAt: string | Date | null
    }[]
  >`
    select
      e.id::text as "externalLocationId",
      e.title as "locationName",
      coalesce(sc.status, 'not_started') as status,
      coalesce(sc.attempt_count, 0)::integer as "attemptCount",
      (sc.page_token is not null) as "hasMorePages",
      sc.last_error_code as "lastErrorCode",
      sc.started_at as "startedAt",
      sc.finished_at as "finishedAt",
      sc.next_attempt_at as "nextAttemptAt"
    from external_location e
    left join sync_checkpoint sc
      on sc.external_location_id = e.id
     and sc.sync_type = 'backfill'
    where ${
      externalLocationIds?.length
        ? sql`e.id in ${sql(externalLocationIds)}`
        : sql`true`
    }
    order by lower(e.title)
  `
  const counts = Object.fromEntries(
    [
      "not_started",
      "pending",
      "running",
      "succeeded",
      "failed",
      "cancelled",
    ].map((status) => [
      status,
      items.filter((item) => item.status === status).length,
    ])
  )
  return { items, counts, total: items.length }
}

export async function GET(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const externalLocationId = new URL(request.url).searchParams.get(
      "external_location_id"
    )
    const ids = externalLocationId
      ? z.array(z.uuid()).parse([externalLocationId])
      : undefined
    const progress = await withTenant(session.organisationId, (sql) =>
      backfillProgress(sql, ids)
    )
    return NextResponse.json({ progress })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    if (!getServerEnv().SYNC_ENABLED) {
      throw new ApiError(503, "sync_paused", "Review sync is paused.")
    }
    const input = inputSchema.parse(await request.json().catch(() => ({})))
    const correlationId = requestId(request)
    const result = await withTenant(session.organisationId, async (sql) => {
      const locations = await linkedLocations(sql, input.externalLocationIds)
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "sync.backfill.started",
        subjectType: "organisation",
        subjectId: session.organisationId,
        requestId: `${correlationId}:started`,
        metadata: {
          externalLocationIds: locations.map(
            (location) => location.externalLocationId
          ),
        },
      })
      const byAccount = new Map<string, LinkedLocation[]>()
      for (const location of locations) {
        const key = `${location.connectionId}:${location.googleAccountName}`
        byAccount.set(key, [...(byAccount.get(key) ?? []), location])
      }
      const results = []
      for (const accountLocations of byAccount.values()) {
        for (let index = 0; index < accountLocations.length; index += 50) {
          const batch = accountLocations.slice(index, index + 50)
          results.push({
            externalLocationIds: batch.map(
              (location) => location.externalLocationId
            ),
            ...(await syncLinkedLocationBatch(
              sql,
              session.organisationId,
              batch,
              input.maxPagesPerLocation
            )),
          })
        }
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: results.some((batch) => "error" in batch)
          ? "sync.backfill.failed"
          : "sync.backfill.completed",
        subjectType: "organisation",
        subjectId: session.organisationId,
        requestId: `${correlationId}:finished`,
        metadata: { locations: results },
      })
      return {
        batches: results,
        progress: await backfillProgress(sql),
      }
    })
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = cancellationSchema.parse(await request.json())
    const correlationId = requestId(request)
    const result = await withTenant(session.organisationId, async (sql) => {
      const running = await sql<{ location_name: string }[]>`
        select e.title as location_name
        from sync_checkpoint sc
        join external_location e on e.id = sc.external_location_id
        where sc.external_location_id in ${sql(input.externalLocationIds)}
          and sc.sync_type = 'backfill'
          and sc.status = 'running'
      `
      if (running.length) {
        throw new ApiError(
          409,
          "backfill_batch_running",
          "Wait for the current API batch to finish before cancelling its continuation."
        )
      }
      const cancelled = await sql<{ externalLocationId: string }[]>`
        update sync_checkpoint
        set
          status = 'cancelled',
          page_token = null,
          next_attempt_at = null,
          finished_at = now()
        where external_location_id in ${sql(input.externalLocationIds)}
          and sync_type = 'backfill'
          and status in ('pending', 'failed')
        returning external_location_id::text as "externalLocationId"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "sync.backfill.cancelled",
        subjectType: "organisation",
        subjectId: session.organisationId,
        requestId: correlationId,
        metadata: {
          requestedExternalLocationIds: input.externalLocationIds,
          cancelledExternalLocationIds: cancelled.map(
            (item) => item.externalLocationId
          ),
        },
      })
      return {
        cancelledExternalLocationIds: cancelled.map(
          (item) => item.externalLocationId
        ),
        progress: await backfillProgress(sql, input.externalLocationIds),
      }
    })
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}
