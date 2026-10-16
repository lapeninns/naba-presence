import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import type { ReviewQueue } from "@/lib/contracts/reviews"
import { publishPredicate } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

/**
 * Queue membership: THE ONLY implementation.
 *
 * The old inbox mapped a queue to a list of workflow states in the browser
 * (`QUEUE_STATUS_MAP` in lib/inbox/url-state.ts) while the counts endpoint
 * grouped by status on the server. The two agreed by coincidence, and any
 * queue that needed more than a status — "awaiting MY approval" needs to know
 * who requested it and who may publish — could not be expressed at all.
 *
 * Both the list query and the counts query call this, so a row is in a queue
 * for exactly one reason and the badge can never disagree with the list.
 *
 * Every fragment assumes `review r` is in scope, and `review_reply rr` where
 * a reply is involved.
 */
export function queuePredicate(
  sql: TransactionSql,
  session: Pick<Session, "userId" | "role" | "canPublish">,
  queue: ReviewQueue,
  options: { requireTwoPersonApproval: boolean }
): Fragment {
  switch (queue) {
    case "all":
      return sql`true`

    // Still needs a human to produce a reply. Excludes rows a person has
    // deliberately marked reviewed: a five-star review with no text needs no
    // reply, and before triage the only way to clear it was to publish
    // something.
    case "needs_reply":
      return sql`(
        r.workflow_status in ('new', 'drafted', 'verified', 'rejected')
        and r.triaged_at is null
      )`

    // The presentation aggregate behind the Inbox's "Approval" control: every
    // reply parked for approval, whoever it is waiting on. Deliberately the
    // plain status test rather than `my OR others`, because those two are
    // defined as a partition of exactly this set — one predicate, so the
    // count, the list and the two narrower queues can never disagree.
    case "approval":
      return sql`r.workflow_status = 'awaiting_approval'`

    // Waiting on THIS user. Two-person approval means the person who asked
    // for approval cannot also give it, so their own requests move to
    // "awaiting others" for them and stay actionable for everyone else.
    case "awaiting_my_approval":
      return sql`(
        r.workflow_status = 'awaiting_approval'
        and ${canApproveHere(sql, session)}
        and ${
          options.requireTwoPersonApproval
            ? sql`coalesce(
                (
                  select rr.approval_requested_by
                  from review_reply rr
                  where rr.review_id = r.id
                  order by rr.updated_at desc
                  limit 1
                ) <> ${session.userId},
                true
              )`
            : sql`true`
        }
      )`

    case "awaiting_others":
      return sql`(
        r.workflow_status = 'awaiting_approval'
        and not (${queuePredicate(sql, session, "awaiting_my_approval", options)})
      )`

    // A publish is in flight. Transient, and nobody can act on it, so it is
    // its own queue rather than noise inside Needs reply.
    case "publishing":
      return sql`r.workflow_status = 'publish_requested'`

    case "failed":
      return sql`r.workflow_status = 'failed'`

    // Everything settled: published, or triaged as needing nothing.
    case "done":
      return sql`(r.workflow_status = 'published' or r.triaged_at is not null)`
  }
}

/**
 * Whether the session could approve a reply for the review's location at all.
 * `publishPredicate` is grantsFor's canPublish rule in SQL, so the queue can
 * be computed in one statement instead of per row.
 */
function canApproveHere(
  sql: TransactionSql,
  session: Pick<Session, "userId" | "role" | "canPublish">
): Fragment {
  return publishPredicate(sql, session, sql`r.location_id`)
}

/**
 * Replies parked for approval that THIS person could actually approve: the
 * `awaiting_my_approval` queue (publish permission here, not the person who
 * asked) minus, under two-person approval, the parked draft's own author.
 * That is the approval route's rule (review-approval.ts refuses the author
 * with `second_approver_required`), and the list row's `canApprove`
 * (reviews-query.ts). The parked draft is resolved as they resolve it: the
 * reply's `pending_draft_id`, else the newest verified draft for a reply
 * parked before that column existed.
 *
 * Only the badge and title count this. The queue itself keeps the author in
 * "awaiting my approval" on purpose: they can still open it and reject.
 */
export function approvablePredicate(
  sql: TransactionSql,
  session: Pick<Session, "userId" | "role" | "canPublish">,
  options: { requireTwoPersonApproval: boolean }
): Fragment {
  return sql`(
    ${queuePredicate(sql, session, "awaiting_my_approval", options)}
    and ${
      options.requireTwoPersonApproval
        ? sql`not coalesce(
            (
              select pd.created_by = ${session.userId}
              from review_reply rr
              join draft pd
                on pd.id = coalesce(
                  rr.pending_draft_id,
                  (
                    select vd.id
                    from draft vd
                    where vd.review_id = r.id
                      and vd.verification_status in ('pass', 'warn')
                    order by vd.created_at desc
                    limit 1
                  )
                )
              where rr.review_id = r.id
              order by rr.updated_at desc
              limit 1
            ),
            false
          )`
        : sql`true`
    }
  )`
}
