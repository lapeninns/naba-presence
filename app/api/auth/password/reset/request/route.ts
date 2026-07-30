import { NextResponse } from "next/server"

import { resetRequestSchema } from "@/lib/domain/auth"
import { getServerEnv } from "@/lib/server/env"
import { apiError } from "@/lib/server/http"
import { requestPasswordReset } from "@/lib/server/password-auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const input = resetRequestSchema.parse(await request.json())
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    const resetUrl = new URL("/auth/confirm", baseUrl)
    resetUrl.searchParams.set("flow", "recovery")
    await requestPasswordReset(
      input.email,
      resetUrl.toString()
    )
    return NextResponse.json(
      {
        accepted: true,
        message:
          "If an account exists for that email, a reset link has been sent.",
      },
      { status: 202 }
    )
  } catch (error) {
    return apiError(error)
  }
}
