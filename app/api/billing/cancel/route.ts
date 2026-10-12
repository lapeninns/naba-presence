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
  entitlement: "exempt",
  body: cancelInputSchema,
  handler: async ({ session, body, requestId, tenant }) => {
    refuseSupportSession(session)
    // INTEGRATION: mfa step_up — stream A's step-up check goes here.
    return setCancelAtPeriodEnd({
      tenant,
      organisationId: session.organisationId,
      userId: session.userId,
      cancelAtPeriodEnd: body.cancelAtPeriodEnd,
      requestId,
    })
  },
})
