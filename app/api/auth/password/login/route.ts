import { loginSchema } from "@/lib/domain/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { signInWithPassword } from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  auth: "public",
  body: loginSchema,
  handler: async ({ body, requestId, clientRequestId }) => {
    const identity = await signInWithPassword(body.email, body.password)
    await completeEmailAuthentication({
      identity,
      inviteToken: body.inviteToken,
      requestId,
      clientRequestId,
    })
    return { authenticated: true }
  },
})
