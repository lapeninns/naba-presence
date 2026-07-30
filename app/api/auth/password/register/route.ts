import { NextResponse } from "next/server"

import { registerSchema } from "@/lib/domain/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { getServerEnv } from "@/lib/server/env"
import { apiError, serverRequestId } from "@/lib/server/http"
import { signUpWithPassword } from "@/lib/server/password-auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const input = registerSchema.parse(await request.json())
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    const confirmationUrl = new URL("/auth/confirm", baseUrl)
    confirmationUrl.searchParams.set("flow", "signup")
    if (input.inviteToken) {
      confirmationUrl.searchParams.set("inviteToken", input.inviteToken)
    }
    const result = await signUpWithPassword({
      email: input.email,
      password: input.password,
      displayName: input.displayName,
      redirectTo: confirmationUrl.toString(),
    })
    if (result.identity) {
      await completeEmailAuthentication({
        identity: result.identity,
        inviteToken: input.inviteToken,
        requestId: rid.id,
        clientRequestId: rid.clientId,
      })
      return NextResponse.json({ authenticated: true })
    }
    return NextResponse.json(
      {
        authenticated: false,
        confirmationRequired: result.confirmationRequired,
      },
      { status: 202 }
    )
  } catch (error) {
    return apiError(error)
  }
}
