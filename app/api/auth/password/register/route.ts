import { NextResponse } from "next/server"

import { registerSchema, type RegisterResponse } from "@/lib/contracts/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { getServerEnv } from "@/lib/server/env"
import { signUpWithPassword } from "@/lib/server/password-auth"
import { requireRegistrationInvitation } from "@/lib/server/registration"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  auth: "public",
  origin: "same",
  body: registerSchema,
  limits: ({ body }) => ({ scope: "register", email: body.email }),
  handler: async ({ request, body, requestId, clientRequestId }) => {
    await requireRegistrationInvitation(body.email, body.inviteToken)
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    const confirmationUrl = new URL("/auth/confirm", baseUrl)
    confirmationUrl.searchParams.set("flow", "signup")
    if (body.inviteToken) {
      confirmationUrl.searchParams.set("inviteToken", body.inviteToken)
    }
    const result = await signUpWithPassword({
      email: body.email,
      password: body.password,
      displayName: body.displayName,
      redirectTo: confirmationUrl.toString(),
    })
    if (result.identity) {
      // Sign-up returns no token to challenge a factor with. A brand-new
      // account has none; one that does (an existing identity) gets no
      // session here and signs in instead (completeEmailAuthentication
      // refuses with mfa_required while MFA is on).
      const completed = await completeEmailAuthentication({
        identity: result.identity,
        inviteToken: body.inviteToken,
        requestId,
        clientRequestId,
        authMethod: "password",
        provider: { accessToken: null, factors: result.factors },
      })
      if (!completed.mfaRequired) {
        return { authenticated: true } satisfies RegisterResponse
      }
    }
    return NextResponse.json(
      {
        authenticated: false,
        confirmationRequired: result.confirmationRequired,
      } satisfies RegisterResponse,
      { status: 202 }
    )
  },
})
