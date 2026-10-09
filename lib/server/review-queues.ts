import "server-only"

import type { Fragment, TransactionSql } from "postgres"

import type { ReviewQueue } from "@/lib/contracts/reviews"
import { isManagerialRole } from "@/lib/server/permissions"
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
 * Mirrors `grantsFor`'s canPublish rule in SQL so the queue can be computed
 * in one statement instead of per row.
 */
function canApproveHere(
  sql: TransactionSql,
  session: Pick<Session, "userId" | "role" | "canPublish">
): Fragment {
  if (isManagerialRole(session.role)) return sql`true`
  if (session.role === "viewer") return sql`false`
  return sql`(
    case
      when exists (select 1 from location_member lm where lm.user_id = ${session.userId})
        then coalesce(
          (
            select lm.can_publish
            from location_member lm
            where lm.user_id = ${session.userId}
              and lm.location_id = r.location_id
          ),
          false
        )
      else ${session.canPublish}
    end
  )`
}
