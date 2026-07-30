import { NextResponse } from "next/server"

import { loginSchema } from "@/lib/domain/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { apiError, serverRequestId } from "@/lib/server/http"
import { signInWithPassword } from "@/lib/server/password-auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const input = loginSchema.parse(await request.json())
    const identity = await signInWithPassword(input.email, input.password)
    await completeEmailAuthentication({
      identity,
      inviteToken: input.inviteToken,
      requestId: rid.id,
      clientRequestId: rid.clientId,
    })
    return NextResponse.json({ authenticated: true })
  } catch (error) {
    return apiError(error)
  }
}
