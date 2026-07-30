import { NextResponse } from "next/server"

import { resetPasswordSchema } from "@/lib/domain/auth"
import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { apiError, serverRequestId } from "@/lib/server/http"
import {
  updatePasswordWithToken,
  verifyEmailToken,
} from "@/lib/server/password-auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const input = resetPasswordSchema.parse(await request.json())
    const verified = await verifyEmailToken({
      tokenHash: input.tokenHash,
      type: "recovery",
    })
    await updatePasswordWithToken(verified.accessToken, input.password)
    await completeEmailAuthentication({
      identity: verified.identity,
      requestId: rid.id,
      clientRequestId: rid.clientId,
    })
    return NextResponse.json({ updated: true, authenticated: true })
  } catch (error) {
    return apiError(error)
  }
}
