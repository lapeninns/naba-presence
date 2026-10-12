import { planChangeInputSchema } from "@/lib/contracts/billing"
import { changePlan } from "@/lib/server/billing/subscription-changes"
import { refuseSupportSession } from "@/lib/server/billing/checkout"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Schedules a plan change for the next billing boundary without proration
 * (plan P07-S5); the current plan drops a scheduled change. Owner only,
 * exempt from read-only enforcement. A downgrade below the linked locations
 * answers 409 `location_limit_exceeded`.
 */
export const POST = route({
  roles: ["owner"],
  entitlement: "exempt",
  body: planChangeInputSchema,
  handler: async ({ session, body, requestId, tenant }) => {
    refuseSupportSession(session)
    // INTEGRATION: mfa step_up — stream A's step-up check goes here.
    return changePlan({
      tenant,
      organisationId: session.organisationId,
      userId: session.userId,
      planId: body.planId,
      requestId,
    })
  },
})
