import { NextResponse } from "next/server"

import {
  resetRequestSchema,
  type ResetRequestResponse,
} from "@/lib/contracts/auth"
import { getServerEnv } from "@/lib/server/env"
import { requestPasswordReset } from "@/lib/server/password-auth"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const POST = route({
  auth: "public",
  body: resetRequestSchema,
  handler: async ({ request, body }) => {
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    const resetUrl = new URL("/auth/confirm", baseUrl)
    resetUrl.searchParams.set("flow", "recovery")
    await requestPasswordReset(body.email, resetUrl.toString())
    return NextResponse.json(
      {
        accepted: true,
        message:
          "If an account exists for that email, a reset link has been sent.",
      } satisfies ResetRequestResponse,
      { status: 202 }
    )
  },
})
