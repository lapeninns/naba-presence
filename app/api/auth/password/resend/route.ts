import { NextResponse } from "next/server"
import { z } from "zod"

import { emailSchema } from "@/lib/domain/auth"
import { getServerEnv } from "@/lib/server/env"
import { apiError } from "@/lib/server/http"
import { resendConfirmationEmail } from "@/lib/server/password-auth"

export const runtime = "nodejs"

const resendSchema = z.object({ email: emailSchema })

export async function POST(request: Request) {
  try {
    const input = resendSchema.parse(await request.json())
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    const confirmationUrl = new URL("/auth/confirm", baseUrl)
    confirmationUrl.searchParams.set("flow", "signup")
    await resendConfirmationEmail(input.email, confirmationUrl.toString())
    return NextResponse.json({ accepted: true }, { status: 202 })
  } catch (error) {
    return apiError(error)
  }
}
