import { NextResponse } from "next/server"

import { registerSchema, type RegisterResponse } from "@/lib/contracts/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { getServerEnv } from "@/lib/server/env"
import { signUpWithPassword } from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  auth: "public",
  body: registerSchema,
  handler: async ({ request, body, requestId, clientRequestId }) => {
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
      await completeEmailAuthentication({
        identity: result.identity,
        inviteToken: body.inviteToken,
        requestId,
        clientRequestId,
      })
      return { authenticated: true } satisfies RegisterResponse
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
