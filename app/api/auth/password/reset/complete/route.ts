import { resetPasswordSchema } from "@/lib/domain/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import {
  updatePasswordWithToken,
  verifyEmailToken,
} from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  auth: "public",
  body: resetPasswordSchema,
  handler: async ({ body, requestId, clientRequestId }) => {
    const verified = await verifyEmailToken({
      tokenHash: body.tokenHash,
      type: "recovery",
    })
    await updatePasswordWithToken(verified.accessToken, body.password)
    await completeEmailAuthentication({
      identity: verified.identity,
      requestId,
      clientRequestId,
    })
    return { updated: true, authenticated: true }
  },
})
