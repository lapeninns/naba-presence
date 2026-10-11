import type { MfaFactorsResponse } from "@/lib/contracts/auth"
import {
  readMfaTicketCookie,
  readPendingTicket,
  requireMfaEnabled,
  ticketExpiredError,
} from "@/lib/server/mfa"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * The factors a pending sign-in may be answered with (primary and backup),
 * for the code screen to offer. Public: the person has no session yet; the
 * ticket cookie is the only credential, and nothing secret is returned.
 */
export const GET = route({
  auth: "public",
  handler: async () => {
    requireMfaEnabled()
    const ticket = await readMfaTicketCookie()
    const pending = ticket ? await readPendingTicket(ticket) : null
    if (!pending || pending.purpose !== "sign_in") throw ticketExpiredError()
    return {
      factors: pending.factors,
      expiresAt: pending.expiresAt.toISOString(),
    } satisfies MfaFactorsResponse
  },
})
