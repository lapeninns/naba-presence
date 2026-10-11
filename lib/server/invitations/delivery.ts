import "server-only"

import type { TransactionSql } from "postgres"

import type {
  InvitationDelivery,
  InvitationDeliveryStatus,
} from "@/lib/contracts/invitations"
import type { MemberRole } from "@/lib/contracts/members"
import { checkAbuseBudget } from "@/lib/server/abuse-limits"
import { decryptSecret } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  emptyOutcome,
  runDeliveries,
  type DeliveryOutcome,
} from "@/lib/server/notifications/delivery"
import { sendTenantEmail } from "@/lib/server/notifications/email"
import { renderInvitationEmail } from "@/lib/server/notifications/messages"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { isScopeEnabled } from "@/lib/server/pause-controls"

/**
 * App-sent invitation email (plan P06-6; migration 0104).
 *
 * Behind the organisation's `invitation_email` feature (default off): off,
 * an invitation is a link the inviter copies, as before, and nothing here
 * runs. On, creating an invitation queues one invitation_delivery row and
 * tries it inline; Resend queues another. Every row goes through the shared
 * email driver (lib/server/notifications/delivery.ts): claimed before the
 * send, sent with its own idempotency key, retried with back-off, and a
 * timeout kept uncertain rather than failed.
 *
 * Three switches can stop a send, none of which loses the invitation (its
 * link can always be copied):
 *   - the `invitation_email` pause scope (lib/server/pause-controls.ts):
 *     nothing is claimed, rows stay pending and go out after the pause;
 *   - TENANT_EMAIL_ENABLED=false, and no provider configured: the row is
 *     suppressed with that reason (sendTenantEmail);
 *   - the `invitation_email` abuse limit: a creation over it is suppressed
 *     (`invitation_email_rate_limited`), a Resend answers 429.
 *
 * The email holds the invitation link, which carries the token: it is
 * rendered at send time from the encrypted token and never logged.
 */

export const INVITATION_EMAIL_FEATURE = "invitation_email" as const

/** The suppression reason of a creation over the abuse limit. */
export const INVITATION_EMAIL_RATE_LIMITED = "invitation_email_rate_limited"

/**
 * How long the inline attempt owns a new row before the job tick may claim
 * it: the tick is the fallback for a request that died, not a racer.
 */
const INLINE_GRACE = "2 minutes"

/** The provider call's own timeout (lib/server/notifications/email.ts). */
const SEND_TIMEOUT_MS = 10_000

const MAX_PER_ORGANISATION = 10

export function invitationEmailEnabled(
  sql: TransactionSql,
  organisationId: string
): Promise<boolean> {
  return isOrgFeatureEnabled(sql, organisationId, INVITATION_EMAIL_FEATURE)
}

type DeliveryRow = {
  id: string
  kind: "initial" | "resend"
  status: InvitationDeliveryStatus
  errorCode: string | null
  attempts: number
  sentAt: Date | null
  createdAt: Date
}

export function serialiseDelivery(row: DeliveryRow): InvitationDelivery {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    errorCode: row.errorCode,
    attempts: row.attempts,
    sentAt: row.sentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The columns of a delivery as the API shows it. */
export const DELIVERY_COLUMNS = `
  d.id::text as id,
  d.kind,
  d.status,
  d.last_error_code as "errorCode",
  d.attempts,
  d.sent_at as "sentAt",
  d.created_at as "createdAt"
`

/** The latest delivery of one invitation, or null. */
export async function latestDelivery(
  sql: TransactionSql,
  invitationId: string
): Promise<InvitationDelivery | null> {
  const [row] = await sql<DeliveryRow[]>`
    select ${sql.unsafe(DELIVERY_COLUMNS)}
    from invitation_delivery d
    where d.invitation_id = ${invitationId}
    order by d.created_at desc, d.id desc
    limit 1
  `
  return row ? serialiseDelivery(row) : null
}

/**
 * Queues one invitation email, inside the caller's tenant transaction. At
 * most one row per invitation is pending (0104): a second is refused with
 * 409 `invitation_email_pending`.
 */
export async function enqueueInvitationDelivery(
  sql: TransactionSql,
  input: {
    organisationId: string
    invitationId: string
    requestedBy: string
    kind: "initial" | "resend"
  }
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into invitation_delivery (
      organisation_id, invitation_id, requested_by, kind, next_attempt_at
    )
    values (
      ${input.organisationId},
      ${input.invitationId},
      ${input.requestedBy},
      ${input.kind},
      now() + ${INLINE_GRACE}::interval
    )
    on conflict (invitation_id) where status = 'pending' do nothing
    returning id::text as id
  `
  if (!row) {
    throw new ApiError(
      409,
      "invitation_email_pending",
      "An email for this invitation is still being sent. Wait a moment before resending."
    )
  }
  return row.id
}

/**
 * Settles a still-pending row as not sent, for a reason decided before any
 * send (the abuse limit on creation).
 */
async function suppressPending(
  organisationId: string,
  deliveryId: string,
  reason: string
) {
  await withTenant(
    organisationId,
    (sql) => sql`
      update invitation_delivery
      set status = 'suppressed', last_error_code = ${reason},
          next_attempt_at = null
      where id = ${deliveryId}
        and status = 'pending'
    `
  )
}

/**
 * The inline attempt after a row was queued: counts the abuse limit when
 * `limit` names the recipient (creation), then sends the row now. Never
 * throws: the invitation already exists, and a row this could not settle is
 * the job tick's after INLINE_GRACE.
 */
export async function attemptInvitationDelivery(input: {
  organisationId: string
  deliveryId: string
  limit?: { email: string; userId: string }
  requestId?: string
}): Promise<void> {
  try {
    if (input.limit) {
      const decision = await checkAbuseBudget("invitation_email", {
        email: input.limit.email,
        user: input.limit.userId,
        organisation: input.organisationId,
      })
      if (!decision.allowed) {
        await suppressPending(
          input.organisationId,
          input.deliveryId,
          INVITATION_EMAIL_RATE_LIMITED
        )
        return
      }
    }
    await deliverInvitationEmails(input.organisationId, {
      deliveryId: input.deliveryId,
    })
  } catch (error) {
    log.error("invitations.delivery_inline_failed", {
      requestId: input.requestId,
      organisationId: input.organisationId,
      deliveryId: input.deliveryId,
      error,
    })
  }
}

type ClaimedInvitationDelivery = {
  id: string
  attempts: number
  createdAt: Date
  mayHaveSent: boolean
  invitationId: string
  email: string
  role: MemberRole
  tokenCiphertext: Buffer
  expiresAt: Date
  acceptedAt: Date | null
  organisationName: string
  timeZone: string | null
}

/**
 * Sends one organisation's due invitation email through the shared driver,
 * or only `deliveryId` (the inline attempt, which does not wait for the row
 * to fall due). Paused by the `invitation_email` scope.
 *
 * Rechecked at send: an invitation accepted or expired since it was queued
 * is suppressed, and a revoked one has taken its rows with it.
 */
export async function deliverInvitationEmails(
  organisationId: string,
  options: { deliveryId?: string; limit?: number } = {}
): Promise<DeliveryOutcome & { paused: boolean }> {
  const limit = options.deliveryId ? 1 : (options.limit ?? MAX_PER_ORGANISATION)
  return runDeliveries<ClaimedInvitationDelivery>({
    name: "invitation_delivery",
    scopes: ["invitation_email"],
    claim: () =>
      withTenant(
        organisationId,
        (sql) => sql<ClaimedInvitationDelivery[]>`
          with due as (
            select d.id
            from invitation_delivery d
            where d.status = 'pending'
              ${
                options.deliveryId
                  ? sql`and d.id = ${options.deliveryId}`
                  : sql`and d.next_attempt_at <= now()`
              }
            order by d.next_attempt_at
            limit ${limit}
            for update skip locked
          ),
          claimed as (
            update invitation_delivery d
            set attempts = d.attempts + 1,
                next_attempt_at = now() + interval '10 minutes'
            from due
            where d.id = due.id
            returning d.id, d.attempts, d.created_at, d.may_have_sent, d.invitation_id
          )
          select
            c.id::text as id,
            c.attempts,
            c.created_at as "createdAt",
            c.may_have_sent as "mayHaveSent",
            c.invitation_id::text as "invitationId",
            i.email,
            i.role,
            i.token_ciphertext as "tokenCiphertext",
            i.expires_at as "expiresAt",
            i.accepted_at as "acceptedAt",
            o.name as "organisationName",
            o.default_timezone as "timeZone"
          from claimed c
          join invitation i on i.id = c.invitation_id
          join organisation o on o.id = i.organisation_id
        `
      ),
    send: async (delivery) => {
      if (delivery.acceptedAt) {
        return { status: "suppressed", reason: "invitation_accepted" }
      }
      if (delivery.expiresAt.getTime() <= Date.now()) {
        return { status: "suppressed", reason: "invitation_expired" }
      }
      const appUrl = getServerEnv().NEXTAUTH_URL
      if (!appUrl) {
        return { status: "suppressed", reason: "app_url_not_configured" }
      }
      let token: string
      try {
        token = decryptSecret(delivery.tokenCiphertext)
      } catch {
        // A retired key: the link can't be rebuilt, so neither email nor
        // Copy link works; a new invitation is the way out.
        return {
          status: "failed",
          code: "invitation_token_unreadable",
          retryable: false,
        }
      }
      const inviteUrl = new URL(`/invite/${token}`, appUrl).toString()
      return sendTenantEmail(
        {
          to: delivery.email,
          ...renderInvitationEmail({
            organisationName: delivery.organisationName,
            role: delivery.role,
            inviteUrl,
            expiresAt: delivery.expiresAt,
            timeZone: delivery.timeZone ?? undefined,
          }),
        },
        { idempotencyKey: `invitation-delivery/${delivery.id}` }
      )
    },
    settle: (delivery, settlement) =>
      withTenant(
        organisationId,
        (sql) => sql`
          update invitation_delivery
          set
            status = ${settlement.status},
            last_error_code = ${settlement.errorCode},
            may_have_sent = may_have_sent or ${settlement.mayHaveSent},
            provider_message_id = ${settlement.providerMessageId},
            sent_at = ${settlement.status === "sent" ? sql`now()` : null},
            next_attempt_at = ${
              settlement.retryInMinutes === null
                ? null
                : sql`now() + (${settlement.retryInMinutes} * interval '1 minute')`
            }
          where id = ${delivery.id}
            and status = 'pending'
        `
      ).then(() => undefined),
    // Ids only: never the address or the link.
    logContext: (delivery) => ({
      organisationId,
      invitationId: delivery.invitationId,
    }),
  })
}

export type InvitationDeliveryTickSummary = DeliveryOutcome & {
  organisations: number
  paused: boolean
  errors: number
}

/**
 * The job tick's drain (lib/server/jobs.ts runDueJobs): the organisations
 * with invitation email due, oldest first, each sent inside its own tenant
 * transaction. An organisation starts only with one provider call's worth of
 * budget left, and claims no more rows than the rest of the budget could
 * send; a row claimed and not reached is due again in ten minutes.
 */
export async function runDueInvitationDeliveries(options: {
  budgetMs: number
  requestId: string
}): Promise<InvitationDeliveryTickSummary> {
  const summary: InvitationDeliveryTickSummary = {
    ...emptyOutcome(),
    organisations: 0,
    paused: false,
    errors: 0,
  }
  if (!(await isScopeEnabled("invitation_email"))) {
    return { ...summary, paused: true }
  }
  const deadline = Date.now() + Math.max(0, options.budgetMs)
  if (Date.now() + SEND_TIMEOUT_MS > deadline) return summary
  const organisations = await getDatabase()<{ organisationId: string }[]>`
    select organisation_id::text as "organisationId"
    from invitation_delivery_due_organisations(${25})
  `
  for (const { organisationId } of organisations) {
    const remaining = deadline - Date.now()
    if (remaining < SEND_TIMEOUT_MS) break
    try {
      const outcome = await deliverInvitationEmails(organisationId, {
        limit: Math.min(
          MAX_PER_ORGANISATION,
          Math.max(1, Math.floor(remaining / SEND_TIMEOUT_MS))
        ),
      })
      if (outcome.paused) return { ...summary, paused: true }
      summary.organisations += 1
      summary.sent += outcome.sent
      summary.suppressed += outcome.suppressed
      summary.failed += outcome.failed
      summary.uncertain += outcome.uncertain
    } catch (error) {
      summary.errors += 1
      log.error("invitations.delivery_organisation_failed", {
        requestId: options.requestId,
        organisationId,
        error,
      })
    }
  }
  return summary
}
