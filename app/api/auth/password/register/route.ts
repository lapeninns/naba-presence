import { NextResponse } from "next/server"

import { registerSchema, type RegisterResponse } from "@/lib/contracts/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { getServerEnv } from "@/lib/server/env"
import { isMfaEnabled } from "@/lib/server/mfa"
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
      // An invited person joins as the organisation is; without the
      // registration choice every new owner gets a business.
      workspaceMode:
        body.inviteToken ||
        !getServerEnv().REGISTRATION_WORKSPACE_CHOICE_ENABLED
          ? undefined
          : body.workspaceMode,
      redirectTo: confirmationUrl.toString(),
    })
    // Sign-up returns no token to challenge a factor with. A brand-new
    // account has none; an identity that already has one gets the same
    // answer as any address that needs confirming (no session, and nothing
    // that says an enrolled account exists) and signs in instead.
    if (result.identity && !(isMfaEnabled() && result.factors.length > 0)) {
      await completeEmailAuthentication({
        identity: result.identity,
        inviteToken: body.inviteToken,
        requestId,
        clientRequestId,
        authMethod: "password",
        provider: { accessToken: null, factors: result.factors },
      })
      return { authenticated: true } satisfies RegisterResponse
    }
    return NextResponse.json(
      {
        authenticated: false,
        // An existing (enrolled) identity reads exactly like an address
        // the provider refused as taken (password-auth.ts).
        confirmationRequired: result.identity ? true : result.confirmationRequired,
      } satisfies RegisterResponse,
      { status: 202 }
    )
  },
})
