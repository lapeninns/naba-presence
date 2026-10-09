import { NextResponse } from "next/server"
import { z } from "zod"

import { completeEmailAuthentication } from "@/lib/server/email-auth"
import { getServerEnv } from "@/lib/server/env"
import { ApiError, serverRequestId } from "@/lib/server/http"
import { verifyEmailToken } from "@/lib/server/password-auth"

export const runtime = "nodejs"

const querySchema = z.object({
  token_hash: z.string().min(20),
  type: z.enum(["email", "recovery"]),
  inviteToken: z.string().min(1).optional(),
})

export async function GET(request: Request) {
  const rid = serverRequestId(request)
  const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
  try {
    const url = new URL(request.url)
    const input = querySchema.parse({
      token_hash: url.searchParams.get("token_hash"),
      type: url.searchParams.get("type"),
      inviteToken: url.searchParams.get("inviteToken") ?? undefined,
    })
    if (input.type === "recovery") {
      const resetUrl = new URL("/reset-password", baseUrl)
      resetUrl.searchParams.set("token_hash", input.token_hash)
      return NextResponse.redirect(resetUrl)
    }
    const verified = await verifyEmailToken({
      tokenHash: input.token_hash,
      type: "email",
    })
    await completeEmailAuthentication({
      identity: verified.identity,
      inviteToken: input.inviteToken,
      requestId: rid.id,
      clientRequestId: rid.clientId,
    })
    return NextResponse.redirect(new URL("/inbox", baseUrl))
  } catch (error) {
    const signInUrl = new URL("/sign-in", baseUrl)
    signInUrl.searchParams.set("email", "error")
    signInUrl.searchParams.set(
      "status",
      error instanceof ApiError ? error.code : "invalid_email_link"
    )
    return NextResponse.redirect(signInUrl)
  }
}
