import { checkoutInputSchema } from "@/lib/contracts/billing"
import {
  refuseSupportSession,
  startCheckout,
} from "@/lib/server/billing/checkout"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Starts a subscription through Stripe Checkout (plan P07-S5): owner only,
 * a plan from the server's catalog allowlist, the organisation's own Stripe
 * customer, a 14-day card-required trial for a first subscription, one open
 * session per organisation. Exempt from read-only enforcement: a read-only
 * organisation subscribing is how it comes back. Nothing is granted here;
 * the webhook processor applies the subscription once Stripe reports it.
 */
export const POST = route({
  roles: ["owner"],
  entitlement: "exempt",
  body: checkoutInputSchema,
  handler: async ({ session, body, requestId, tenant }) => {
    refuseSupportSession(session)
    // INTEGRATION: mfa step_up — stream A's step-up check goes here.
    return startCheckout({
      tenant,
      actor: {
        organisationId: session.organisationId,
        organisationName: session.organisationName,
        userId: session.userId,
        email: session.email,
      },
      planId: body.planId,
      requestId,
    })
  },
})
