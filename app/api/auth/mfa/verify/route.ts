import { mfaVerifySchema, type MfaVerifyResponse } from "@/lib/contracts/auth"
import { clientIpFromRequest, takeAbuseBudget } from "@/lib/server/abuse-limits"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { ApiError } from "@/lib/server/http"
import {
  clearMfaTicketCookie,
  consumeTicket,
  discardTicket,
  MFA_MAX_ATTEMPTS,
  parseProviderAssurance,
  readMfaTicketCookie,
  requireMfaEnabled,
  signInCompletionSchema,
  takeTicketAttempt,
  ticketExpiredError,
  verifiedAssurance,
  type PendingTicket,
} from "@/lib/server/mfa"
import {
  challengeAndVerifyFactor,
  type ProviderFactor,
} from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"
import {
  createSession,
  getSession,
  setSessionCookie,
  type Session,
} from "@/lib/server/session"

export const runtime = "nodejs"

/**
 * Checks a TOTP code against the pending ticket in the cookie
 * (lib/server/mfa.ts) and completes what the ticket was opened for:
 *
 * - `sign_in`: the deferred sign-in (password, reset, emailed link,
 *   invitation) finishes with an aal2 session.
 * - `enroll`: the new factor is verified, and the enrolling session is
 *   replaced by an aal2 one (a fresh token, as for any privilege change).
 *
 * Public, because a sign-in has no session yet; an enroll ticket is honoured
 * only for the session it was opened in.
 */
export const POST = route({
  auth: "public",
  origin: "same",
  body: mfaVerifySchema,
  handler: async ({ request, body, requestId, clientRequestId }) => {
    requireMfaEnabled()
    const ticket = await readMfaTicketCookie()
    if (!ticket) throw ticketExpiredError()
    const session = await getSession()
    await takeAbuseBudget("mfa_verify", {
      ip: clientIpFromRequest(request),
      token: ticket,
      user: session?.userId ?? null,
    })
    const pending = await takeTicketAttempt(ticket)
    if (!pending) {
      await clearMfaTicketCookie()
      throw ticketExpiredError()
    }
    if (pending.purpose === "enroll") {
      if (
        !session ||
        session.sessionId !== pending.sessionId ||
        session.userId !== pending.userId
      ) {
        throw ticketExpiredError()
      }
    }
    const factorId = chooseFactor(pending, body.factorId)

    let verified: { accessToken: string; factors: ProviderFactor[] }
    try {
      verified = await challengeAndVerifyFactor({
        accessToken: pending.providerToken,
        factorId,
        code: body.code,
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_code_invalid") {
        const attemptsRemaining = Math.max(
          0,
          MFA_MAX_ATTEMPTS - pending.attempts
        )
        if (attemptsRemaining === 0) {
          await discardTicket(ticket)
          await clearMfaTicketCookie()
          throw ticketExpiredError()
        }
        throw new ApiError(400, error.code, error.message, {
          fieldErrors: { code: error.message },
          details: { attemptsRemaining },
        })
      }
      throw error
    }
    // Fail closed: a verification the provider did not raise to aal2 is not
    // one, whatever it answered.
    if (parseProviderAssurance(verified.accessToken).aal !== "aal2") {
      throw new ApiError(
        503,
        "mfa_assurance_unconfirmed",
        "Two-step verification is temporarily unavailable."
      )
    }
    // Exactly one request completes a ticket.
    if (!(await consumeTicket(ticket))) throw ticketExpiredError()
    await clearMfaTicketCookie()

    if (pending.purpose === "enroll" && session) {
      await completeEnrollment({
        session,
        factorId,
        factorCount: verified.factors.length,
        requestId,
        clientRequestId,
      })
      return { verified: true, purpose: "enroll" } satisfies MfaVerifyResponse
    }

    const completion = signInCompletionSchema.parse(pending.completion)
    await completeEmailAuthentication({
      identity: completion.identity,
      inviteTokenHash: completion.inviteTokenHash,
      passwordReset: completion.passwordReset,
      authMethod: completion.authMethod,
      requestId,
      clientRequestId,
      provider: {
        accessToken: verified.accessToken,
        factors: verified.factors,
      },
      assurance: verifiedAssurance({
        factorId,
        authMethod: completion.authMethod,
      }),
    })
    return { verified: true, purpose: "sign_in" } satisfies MfaVerifyResponse
  },
})

/** Cancels a pending sign-in or enrollment ("use a different account"). */
export const DELETE = route({
  auth: "public",
  origin: "same",
  handler: async () => {
    const ticket = await readMfaTicketCookie()
    if (ticket) await discardTicket(ticket)
    await clearMfaTicketCookie()
    return new Response(null, { status: 204 })
  },
})

function chooseFactor(pending: PendingTicket, requested?: string): string {
  if (pending.purpose === "enroll") {
    if (!pending.factorId) throw ticketExpiredError()
    return pending.factorId
  }
  if (requested) {
    if (!pending.factors.some((factor) => factor.id === requested)) {
      throw new ApiError(
        400,
        "mfa_factor_unknown",
        "Choose one of your authenticator apps."
      )
    }
    return requested
  }
  const first = pending.factors[0]
  if (!first) throw ticketExpiredError()
  return first.id
}

async function completeEnrollment(input: {
  session: Session
  factorId: string
  factorCount: number
  requestId: string
  clientRequestId: string | null
}) {
  const { session } = input
  const token = await withTenant(session.organisationId, async (sql) => {
    await sql`select set_config('app.user_id', ${session.userId}, true)`
    await sql`
      update app_user
      set mfa_factor_count = ${Math.min(Math.max(input.factorCount, 1), 10)}
      where id = ${session.userId}
    `
    const token = await createSession(
      sql,
      session.userId,
      session.organisationId,
      {
        assurance: verifiedAssurance({
          factorId: input.factorId,
          authMethod: session.authMethod ?? "mfa_enroll",
        }),
      }
    )
    await sql`delete from app_session where id = ${session.sessionId}`
    await writeAudit(sql, {
      organisationId: session.organisationId,
      actorUserId: session.userId,
      action: "user.mfa_enrolled",
      subjectType: "user",
      subjectId: session.userId,
      requestId: input.requestId,
      metadata: {
        factorId: input.factorId,
        factorCount: input.factorCount,
        clientRequestId: input.clientRequestId,
      },
    })
    return token
  })
  await setSessionCookie(token)
}
