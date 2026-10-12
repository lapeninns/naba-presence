import { loginSchema, type LoginResponse } from "@/lib/contracts/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { signInWithPassword } from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  auth: "public",
  origin: "same",
  body: loginSchema,
  limits: ({ body }) => ({ scope: "login", email: body.email }),
  handler: async ({ body, requestId, clientRequestId }) => {
    const signedIn = await signInWithPassword(body.email, body.password)
    const result = await completeEmailAuthentication({
      identity: signedIn.identity,
      inviteToken: body.inviteToken,
      requestId,
      clientRequestId,
      authMethod: "password",
      provider: signedIn,
    })
    return {
      authenticated: !result.mfaRequired,
      mfaRequired: result.mfaRequired,
    } satisfies LoginResponse
  },
})
