import {
  resetPasswordSchema,
  type ResetCompleteResponse,
} from "@/lib/contracts/auth"
import { assertPasswordNotBreached } from "@/lib/server/breached-password"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { isMfaEnabled } from "@/lib/server/mfa"
import {
  updatePasswordWithToken,
  verifyEmailToken,
} from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  auth: "public",
  origin: "same",
  body: resetPasswordSchema,
  limits: ({ body }) => ({ scope: "reset_complete", token: body.tokenHash }),
  handler: async ({ body, requestId, clientRequestId }) => {
    // Before the link is spent, so a refused password leaves it usable for
    // a second try. This also covers the MFA-deferred reset, whose password
    // is set later from the ticket.
    await assertPasswordNotBreached(body.password)
    const verified = await verifyEmailToken({
      tokenHash: body.tokenHash,
      type: "recovery",
    })
    // An enrolled person's new password waits for their code: the provider
    // sets a password for a user with factors only at aal2, and a mailbox
    // alone must not change the credential or end the owner's sessions.
    // The password travels in the ticket (encrypted) and the verify route
    // sets it; nothing changes if the code never comes.
    const deferred = isMfaEnabled() && verified.factors.length > 0
    if (!deferred) {
      await updatePasswordWithToken(verified.accessToken, body.password)
    }
    const result = await completeEmailAuthentication({
      identity: verified.identity,
      requestId,
      clientRequestId,
      passwordReset: true,
      authMethod: "password_reset",
      provider: verified,
      newPassword: deferred ? body.password : undefined,
    })
    return {
      updated: !result.mfaRequired,
      authenticated: !result.mfaRequired,
      mfaRequired: result.mfaRequired,
    } satisfies ResetCompleteResponse
  },
})
