import {
  openCustomerPortal,
  refuseSupportSession,
} from "@/lib/server/billing/checkout"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * A Stripe Customer Portal session for the organisation's own customer
 * (plan P07-S5): payment methods and invoices. Owner only, exempt from
 * read-only enforcement.
 */
export const POST = route({
  roles: ["owner"],
  // Plan P07-S5: money moves, so an owner steps up first (P02-S9).
  mfa: "step_up",
  entitlement: "exempt",
  handler: async ({ session, requestId, tenant }) => {
    refuseSupportSession(session)
    return openCustomerPortal({
      tenant,
      organisationId: session.organisationId,
      userId: session.userId,
      requestId,
    })
  },
})
