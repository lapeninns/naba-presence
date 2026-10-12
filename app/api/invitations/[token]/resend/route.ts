import { NextResponse } from "next/server"

import {
  invitationResendParamsSchema,
  type InvitationResentResponse,
} from "@/lib/contracts/invitations"
import type { MemberRole } from "@/lib/contracts/members"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import {
  attemptInvitationDelivery,
  enqueueInvitationDelivery,
  invitationEmailEnabled,
  latestDelivery,
} from "@/lib/server/invitations/delivery"
import { assertRoleChangeAllowed } from "@/lib/server/member-roles"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Emails a pending invitation again (plan P06-6). Owners and admins, while
 * the organisation's `invitation_email` feature is on; an admin cannot
 * resend an owner invitation, as they cannot create one.
 *
 * Refused while an earlier email for it is still queued (409
 * `invitation_email_pending`), once it was accepted or has expired, and over
 * the `invitation_email` abuse limit (429, counted per invitee address, per
 * inviter and per organisation, and spent only by a Resend that queues an
 * email). A Resend is a new delivery with its own
 * idempotency key, sent inline like the first; 202 answers with where it
 * stands, which may still be `pending` (paused, or retrying). It re-sends an
 * access link, so it steps up like creating the invitation (P02-S9).
 */
export const POST = route({
  mfa: "step_up",
  roles: ["owner", "admin"],
  params: invitationResendParamsSchema,
  handler: async ({ session, params, requestId, clientRequestId, tenant }) => {
    const invitationId = params.token
    // One transaction, the invitation locked: a revoke waits for the queued
    // row (and then takes it with the invitation) rather than racing the
    // insert, and concurrent Resends see each other's pending row before
    // either spends the abuse budget.
    const deliveryId = await tenant(async (sql) => {
      if (!(await invitationEmailEnabled(sql, session.organisationId))) {
        throw new ApiError(
          403,
          "invitation_email_unavailable",
          "Emailing invitations is not available for this account yet. Copy the link and send it yourself."
        )
      }
      const [row] = await sql<
        {
          email: string
          role: MemberRole
          expired: boolean
          accepted: boolean
        }[]
      >`
        select
          email,
          role,
          expires_at <= now() as expired,
          accepted_at is not null as accepted
        from invitation
        where id = ${invitationId}
        for update
      `
      if (!row) {
        throw new ApiError(404, "invitation_not_found", "Invitation not found.")
      }
      if (row.accepted) {
        throw new ApiError(
          409,
          "invitation_accepted",
          "This invitation has already been accepted."
        )
      }
      if (row.expired) {
        throw new ApiError(
          409,
          "invitation_expired",
          "This invitation has expired. Revoke it and invite them again."
        )
      }
      assertRoleChangeAllowed(session.role, row.role)
      // Refuses a pending row (409) before counting, and over the limit
      // (429) without queueing.
      const { id } = await enqueueInvitationDelivery(sql, {
        organisationId: session.organisationId,
        invitationId,
        email: row.email,
        requestedBy: session.userId,
        kind: "resend",
      })
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.invitation_resent",
        subjectType: "invitation",
        subjectId: invitationId,
        requestId,
        metadata: { deliveryId: id, clientRequestId },
      })
      return id
    })
    await attemptInvitationDelivery({
      organisationId: session.organisationId,
      deliveryId,
      requestId,
    })
    const delivery = await tenant((sql) => latestDelivery(sql, invitationId))
    if (!delivery) {
      // Revoked between the queue and the read: its rows went with it.
      throw new ApiError(404, "invitation_not_found", "Invitation not found.")
    }
    return NextResponse.json({ delivery } satisfies InvitationResentResponse, {
      status: 202,
    })
  },
})
