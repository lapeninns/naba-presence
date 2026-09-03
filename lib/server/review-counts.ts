import "server-only"

import type { TransactionSql } from "postgres"

import {
  REVIEW_QUEUES,
  REVIEW_WORKFLOW_STATES,
  type ReviewCounts,
  type ReviewQueue,
  type ReviewWorkflowState,
} from "@/lib/contracts/reviews"
import { requireLocationAccess, visibilityPredicate } from "@/lib/server/permissions"
import { queuePredicate } from "@/lib/server/review-queues"
import type { Session } from "@/lib/server/session"

/**
 * Review counts: THE ONLY implementation.
 *
 * `GET /api/reviews/counts` and the server prefetch both call this, so the
 * badge a page renders on first paint and the badge it renders after a
 * refetch are computed the same way. They previously had separate queries
 * that agreed only by coincidence.
 *
 * Queue counts come from `queuePredicate`, the same fragment the list query
 * filters by, so a rail badge can never promise rows the queue does not hold.
 */
export type ReviewCountsScope = {
  locationId?: string
  clientId?: string
  groupBy?: "client"
}

export function zeroQueues(): Record<ReviewQueue, number> {
  return Object.fromEntries(REVIEW_QUEUES.map((queue) => [queue, 0])) as Record<
    ReviewQueue,
    number
  >
}

export async function readReviewCounts(
  sql: TransactionSql,
  session: Session,
  scope: ReviewCountsScope = {}
): Promise<ReviewCounts> {
  if (scope.locationId) {
    await requireLocationAccess(sql, session, scope.locationId)
  }

  const [settings] = await sql<{ requireTwoPersonApproval: boolean }[]>`
    select require_two_person_approval as "requireTwoPersonApproval"
    from organisation
    where id = ${session.organisationId}
  `
  const options = {
    requireTwoPersonApproval: settings?.requireTwoPersonApproval ?? false,
  }
  const actor = {
    userId: session.userId,
    role: session.role,
    canPublish: session.canPublish,
  }

  const filters = sql`
    r.provider_deleted_at is null
    ${scope.locationId ? sql`and r.location_id = ${scope.locationId}` : sql``}
    ${scope.clientId ? sql`and l.client_id = ${scope.clientId}` : sql``}
    and ${visibilityPredicate(sql, session, sql`r.location_id`)}
  `
  const queueColumns = REVIEW_QUEUES.map(
    (queue) =>
      sql`count(*) filter (where ${queuePredicate(sql, actor, queue, options)})::integer as ${sql(queue)}`
  ).reduce((left, right) => sql`${left}, ${right}`)

  const [totals] = await sql<(Record<ReviewQueue, number> & { total: number })[]>`
    select count(*)::integer as total, ${queueColumns}
    from review r
    join location l on l.id = r.location_id
    where ${filters}
  `

  const statuses = await sql<
    { workflowStatus: ReviewWorkflowState; count: number }[]
  >`
    select r.workflow_status as "workflowStatus", count(*)::integer as count
    from review r
    join location l on l.id = r.location_id
    where ${filters}
    group by r.workflow_status
  `

  const groups = scope.groupBy
    ? await sql<
        (Record<ReviewQueue, number> & {
          clientId: string | null
          clientName: string
        })[]
      >`
        select
          c.id::text as "clientId",
          coalesce(c.name, 'Unassigned locations') as "clientName",
          ${queueColumns}
        from review r
        join location l on l.id = r.location_id
        left join client c on c.id = l.client_id
        where ${filters}
        group by c.id, c.name
        order by lower(coalesce(c.name, 'zzz'))
      `
    : undefined

  const byStatus = Object.fromEntries(
    REVIEW_WORKFLOW_STATES.map((status) => [status, 0])
  ) as Record<ReviewWorkflowState, number>
  for (const row of statuses) byStatus[row.workflowStatus] = row.count

  const byQueue = zeroQueues()
  for (const queue of REVIEW_QUEUES) byQueue[queue] = totals?.[queue] ?? 0

  return {
    total: totals?.total ?? 0,
    byStatus,
    byQueue,
    groups: groups?.map((group) => {
      const counts = zeroQueues()
      for (const queue of REVIEW_QUEUES) counts[queue] = group[queue] ?? 0
      return {
        clientId: group.clientId,
        clientName: group.clientName,
        byQueue: counts,
      }
    }),
  }
}
