import {
  resetPasswordSchema,
  type ResetCompleteResponse,
} from "@/lib/contracts/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
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
    const verified = await verifyEmailToken({
      tokenHash: body.tokenHash,
      type: "recovery",
    })
    await updatePasswordWithToken(verified.accessToken, body.password)
    // An enrolled person still owes their code: the password is changed and
    // their other sessions are ended now, the new session comes after it.
    const result = await completeEmailAuthentication({
      identity: verified.identity,
      requestId,
      clientRequestId,
      passwordReset: true,
      authMethod: "password_reset",
      provider: verified,
    })
    return {
      updated: true,
      authenticated: !result.mfaRequired,
      mfaRequired: result.mfaRequired,
    } satisfies ResetCompleteResponse
  },
})
