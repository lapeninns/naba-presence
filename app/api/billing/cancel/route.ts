import { cancelInputSchema } from "@/lib/contracts/billing"
import { setCancelAtPeriodEnd } from "@/lib/server/billing/subscription-changes"
import { refuseSupportSession } from "@/lib/server/billing/checkout"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Cancels the subscription at the period end, or resumes it (plan P07-S5).
 * Sets the flag only: access continues to the period end. Owner only,
 * exempt from read-only enforcement.
 */
export const POST = route({
  roles: ["owner"],
  // Plan P07-S5: money moves, so an owner steps up first (P02-S9).
  mfa: "step_up",
  entitlement: "exempt",
  body: cancelInputSchema,
  handler: async ({ session, body, requestId, tenant }) => {
    refuseSupportSession(session)
    return setCancelAtPeriodEnd({
      tenant,
      organisationId: session.organisationId,
      userId: session.userId,
      cancelAtPeriodEnd: body.cancelAtPeriodEnd,
      requestId,
    })
  },
})
